<?php

namespace App\Http\Controllers\Api\V1;

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

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', "%{$search}%")
                    ->orWhere('course_code', 'ilike', "%{$search}%")
                    ->orWhere('description', 'ilike', "%{$search}%")
                    ->orWhere('scope_department', 'ilike', "%{$search}%");
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
     * POST /api/v1/channels (Workflow 5 — Faculty/Admin only)
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'Access Denied: Students cannot create Course Hub channels (NFR-01_REV).',
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

        $channel = Channel::create([
            'course_code' => strtoupper(trim($validated['course_code'])),
            'name' => $formattedName,
            'description' => $validated['description'] ?? "{$validated['scope_section']} Scoped Course Hub",
            'channel_type' => $validated['channel_type'],
            'scope_college' => $validated['scope_college'] ?? 'CITC',
            'scope_department' => $validated['scope_department'] ?? 'CITC',
            'scope_section' => $validated['scope_section'] ?? 'IT3R2',
            'instructor_name' => $user->name,
            'created_by' => $user->id,
        ]);

        $channel->members()->syncWithoutDetaching([
            $user->id => [
                'can_publish' => true,
                'joined_at' => now(),
            ],
        ]);

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
        $channel = Channel::findOrFail($id);
        $user = $request->user();

        $channel->members()->syncWithoutDetaching([
            $user->id => [
                'can_publish' => $user->canPublishOrManage(),
                'joined_at' => now(),
            ],
        ]);

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
        if (! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'Only Faculty or IT Administrators can modify channel rosters.',
            ], 403);
        }

        $validated = $request->validate([
            'institutional_id' => ['required', 'string'],
            'name' => ['nullable', 'string'],
            'section' => ['nullable', 'string'],
            'action' => ['required', 'in:add,remove'],
        ]);

        $channel = Channel::findOrFail($id);
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

        return response()->json([
            'message' => $validated['action'] === 'add'
                ? 'Member added to channel roster.'
                : 'Member removed from channel roster.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ]);
    }
}
