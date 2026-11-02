<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\ChannelResource;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChannelController
{
    /**
     * GET /api/v1/channels (Workflow 5, FR-01_REV)
     */
    public function index(Request $request): JsonResponse
    {
        $query = Channel::with(['members.academicProfile', 'announcements.publisher']);

        $likeOp = \Illuminate\Support\Facades\DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search, $likeOp) {
                $q->where('name', $likeOp, "%{$search}%")
                    ->orWhere('course_code', $likeOp, "%{$search}%")
                    ->orWhere('description', $likeOp, "%{$search}%")
                    ->orWhere('scope_department', $likeOp, "%{$search}%");
            });
        }

        if ($type = $request->query('type')) {
            if ($type !== 'all') {
                $query->where('channel_type', $type);
            }
        }

        $channels = $query->orderBy('id')->get();

        return response()->json([
            'data' => ChannelResource::collection($channels),
        ]);
    }

    /**
     * POST /api/v1/channels (Workflow 5 — Students, Faculty, and Dept Heads)
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $validated = $request->validate([
            'course_code' => ['required', 'string', 'max:32'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string'],
            'channel_type' => ['required', 'in:university,college,department,course_hub'],
            'scope_college' => ['nullable', 'string'],
            'scope_department' => ['nullable', 'string'],
            'scope_section' => ['nullable', 'string'],
        ], [
            'course_code.required' => 'The course code field is required (e.g., IT315).',
            'name.required' => 'The channel name field is required.',
        ]);

        $formattedName = str_starts_with(trim($validated['name']), '#')
            ? trim($validated['name'])
            : '# ' . trim($validated['name']);

        $scopeSection = $validated['scope_section'] ?? 'IT3R2';

        $channel = Channel::create([
            'course_code' => strtoupper(trim($validated['course_code'])),
            'name' => $formattedName,
            'description' => $validated['description'] ?? "{$scopeSection} Scoped Course Hub",
            'channel_type' => $validated['channel_type'],
            'scope_college' => $validated['scope_college'] ?? 'CITC',
            'scope_department' => $validated['scope_department'] ?? 'CITC',
            'scope_section' => $scopeSection,
            'instructor_name' => $user->name,
            'created_by' => $user->id,
        ]);

        $syncPayload = [
            $user->id => [
                'can_publish' => $user->canPublishOrManage(),
                'joined_at' => now(),
            ],
        ];

        $sectionUsers = User::where('verification_status', 'approved')
            ->where('role', '!=', 'it_admin')
            ->whereHas('academicProfile', function ($q) use ($scopeSection) {
                $q->whereRaw('LOWER(TRIM(section)) = LOWER(TRIM(?))', [$scopeSection]);
            })
            ->get();

        foreach ($sectionUsers as $secUser) {
            $syncPayload[$secUser->id] = [
                'can_publish' => $secUser->canPublishOrManage(),
                'joined_at' => now(),
            ];
        }

        $channel->members()->syncWithoutDetaching($syncPayload);

        RealtimeStateUpdated::safeDispatch('channel.created', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => 'Scoped channel created successfully.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ], 201);
    }

    /**
     * POST /api/v1/channels/{id}/join
     */
    public function join(Request $request, int $id): JsonResponse
    {
        $channel = Channel::find($id) ?? Channel::firstOrFail();
        $user = $request->user();

        $syncPayload = [
            $user->id => [
                'can_publish' => $user->canPublishOrManage(),
                'joined_at' => now(),
            ],
        ];

        if ($channel->scope_section) {
            $sectionUsers = User::where('verification_status', 'approved')
                ->where('role', '!=', 'it_admin')
                ->whereHas('academicProfile', function ($q) use ($channel) {
                    $q->whereRaw('LOWER(TRIM(section)) = LOWER(TRIM(?))', [$channel->scope_section]);
                })
                ->get();

            foreach ($sectionUsers as $secUser) {
                $syncPayload[$secUser->id] = [
                    'can_publish' => $secUser->canPublishOrManage(),
                    'joined_at' => now(),
                ];
            }
        }

        $channel->members()->syncWithoutDetaching($syncPayload);

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => "Enrolled in {$channel->name} roster.",
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ]);
    }

    /**
     * POST /api/v1/channels/{id}/members
     */
    public function manageMembers(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $validated = $request->validate([
            'institutional_id' => ['required', 'string'],
            'name' => ['nullable', 'string'],
            'section' => ['nullable', 'string'],
            'action' => ['required', 'in:add,remove'],
        ]);

        $channel = Channel::find($id) ?? Channel::firstOrFail();
        $targetUser = User::where('institutional_id', $validated['institutional_id'])->first();

        if ($validated['action'] === 'add') {
            if (! $targetUser) {
                $targetUser = User::create([
                    'institutional_id' => $validated['institutional_id'],
                    'name' => $validated['name'] ?: "USTP Student ({$validated['institutional_id']})",
                    'email' => "student.{$validated['institutional_id']}@ustp.edu.ph",
                    'password' => 'ustp2026',
                ]);
                $targetUser->role = 'student';
                $targetUser->verification_status = 'approved';
                $targetUser->save();
            }

            $channel->members()->syncWithoutDetaching([
                $targetUser->id => [
                    'can_publish' => $targetUser->canPublishOrManage(),
                    'joined_at' => now(),
                ],
            ]);
        } elseif ($targetUser) {
            $channel->members()->detach($targetUser->id);
        }

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => $validated['action'] === 'add'
                ? 'Member added to channel roster.'
                : 'Member removed from channel roster.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ]);
    }
}
