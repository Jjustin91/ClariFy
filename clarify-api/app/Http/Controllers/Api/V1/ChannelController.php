<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\ChannelResource;
use App\Models\Announcement;
use App\Models\Channel;
use App\Models\Message;
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

        // Only enroll the creator automatically; other users join via Browse Course Hubs
        $channel->members()->syncWithoutDetaching([
            $user->id => [
                'can_publish' => $user->canPublishOrManage(),
                'joined_at' => now(),
            ],
        ]);

        RealtimeStateUpdated::safeDispatch('channel.created', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => 'Scoped channel created successfully.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ], 201);
    }

    /**
     * Checks if user is a Course Admin for the given channel (all Faculty/Dept Heads or the channel creator).
     */
    private function isCourseAdmin(User $user, Channel $channel): bool
    {
        if (in_array($user->role, ['faculty', 'dept_head'], true)) {
            return true;
        }

        return $channel->created_by !== null && (int) $channel->created_by === (int) $user->id;
    }

    /**
     * PATCH /api/v1/channels/{id} — Edit Course Hub (Course Admins only: Creator or Faculty)
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $channel = Channel::findOrFail($id);

        if (! $this->isCourseAdmin($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can edit this Course Hub.',
            ], 403);
        }

        $validated = $request->validate([
            'course_code' => ['required', 'string', 'max:32'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string'],
            'scope_college' => ['nullable', 'string'],
            'scope_department' => ['nullable', 'string'],
            'scope_section' => ['nullable', 'string'],
        ], [
            'course_code.required' => 'The course code field is required.',
            'name.required' => 'The Course Hub name field is required.',
        ]);

        $formattedName = str_starts_with(trim($validated['name']), '#')
            ? trim($validated['name'])
            : '# ' . trim($validated['name']);

        $scopeSection = $validated['scope_section'] ?? $channel->scope_section ?? 'IT3R2';
        $scopeDepartment = $validated['scope_department'] ?? $channel->scope_department ?? 'CITC';
        $scopeCollege = $validated['scope_college'] ?? $scopeDepartment;

        $channel->update([
            'course_code' => strtoupper(trim($validated['course_code'])),
            'name' => $formattedName,
            'description' => $validated['description'] ?? $channel->description,
            'scope_college' => $scopeCollege,
            'scope_department' => $scopeDepartment,
            'scope_section' => $scopeSection,
        ]);

        // Also update scope metadata on any child sub-channels of this Course Hub
        Channel::where('description', 'like', "[HUB:{$channel->id}]%")
            ->update([
                'course_code' => strtoupper(trim($validated['course_code'])),
                'scope_college' => $scopeCollege,
                'scope_department' => $scopeDepartment,
                'scope_section' => $scopeSection,
            ]);

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => 'Course Hub updated successfully.',
            'data' => new ChannelResource($channel->fresh('members.academicProfile')),
        ]);
    }

    /**
     * DELETE /api/v1/channels/{id} — Delete Course Hub or Sub-Channel (Course Admins only)
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();

        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $channel = Channel::findOrFail($id);

        // If deleting a sub-channel, check parent Course Hub admin status as well
        $isAllowed = $this->isCourseAdmin($user, $channel);
        if (! $isAllowed && preg_match('/^\[HUB:(\d+)\]/', (string) $channel->description, $m)) {
            $parentHub = Channel::find((int) $m[1]);
            if ($parentHub && $this->isCourseAdmin($user, $parentHub)) {
                $isAllowed = true;
            }
        }

        if (! $isAllowed) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can delete this Course Hub.',
            ], 403);
        }

        $channelName = $channel->name;

        // Find any sub-channels belonging to this Course Hub
        $subChannelIds = Channel::where('description', 'like', "[HUB:{$channel->id}]%")
            ->pluck('id')
            ->all();

        $allTargetIds = array_values(array_unique(array_merge([$channel->id], $subChannelIds)));

        Message::whereIn('channel_id', $allTargetIds)->delete();
        Announcement::whereIn('channel_id', $allTargetIds)->delete();
        \Illuminate\Support\Facades\DB::table('channel_user')->whereIn('channel_id', $allTargetIds)->delete();
        Channel::whereIn('id', $allTargetIds)->delete();

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $id, (int) $user->id);

        return response()->json([
            'message' => "Deleted {$channelName} successfully.",
        ]);
    }

    /**
     * POST /api/v1/channels/{id}/join
     */
    public function join(Request $request, int $id): JsonResponse
    {
        $channel = Channel::findOrFail($id);
        $user = $request->user();

        // Enroll only the current user into the selected Course Hub
        $channel->members()->syncWithoutDetaching([
            $user->id => [
                'can_publish' => $user->canPublishOrManage(),
                'joined_at' => now(),
            ],
        ]);

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => "Joined {$channel->name} successfully.",
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ]);
    }

    /**
     * POST /api/v1/channels/{id}/leave
     */
    public function leave(Request $request, int $id): JsonResponse
    {
        $channel = Channel::findOrFail($id);
        $user = $request->user();

        $subChannelIds = Channel::where('description', 'like', "[HUB:{$channel->id}]%")
            ->pluck('id')
            ->all();
        $allTargetIds = array_values(array_unique(array_merge([$channel->id], $subChannelIds)));

        \Illuminate\Support\Facades\DB::table('channel_user')
            ->whereIn('channel_id', $allTargetIds)
            ->where('user_id', $user->id)
            ->delete();

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => "You have left {$channel->name}.",
            'data' => new ChannelResource($channel->fresh('members.academicProfile')),
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

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => $validated['action'] === 'add'
                ? 'Member added to channel roster.'
                : 'Member removed from channel roster.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ]);
    }
}
