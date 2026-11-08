<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\ChannelResource;
use App\Models\Announcement;
use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use App\Policies\ChannelPolicy;
use App\Support\ApiCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ChannelController
{
    /**
     * GET /api/v1/channels (Workflow 5, FR-01_REV)
     * Uses a fixed number of grouped queries (zero N+1 queries per channel) and caches shared channel metadata.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $search = trim((string) $request->query('search', ''));
        $type = (string) $request->query('type', 'course_hub');
        $includeParam = strtolower(trim((string) $request->query('include', '')));
        $includeRoster = in_array('roster', array_map('trim', explode(',', $includeParam)), true);

        $cacheParams = array_filter([
            'search' => $search,
            'type' => $type,
        ], fn ($value) => $value !== '');

        $buildChannelsList = function (bool $withFullRoster) use (
            $request,
            $search,
            $type
        ): array {
            $query = Channel::query();
            if ($withFullRoster) {
                $query->with(['members.academicProfile']);
            }

            $likeOp = DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

            if ($search !== '') {
                $query->where(function ($q) use ($search, $likeOp) {
                    $q->where('name', $likeOp, "%{$search}%")
                        ->orWhere('course_code', $likeOp, "%{$search}%")
                        ->orWhere('description', $likeOp, "%{$search}%")
                        ->orWhere('scope_department', $likeOp, "%{$search}%");
                });
            }

            if ($type !== '' && $type !== 'all') {
                $query->where('channel_type', $type);
            } else {
                $query->where('channel_type', 'course_hub');
            }

            $channels = $query->orderBy('id')->get();
            if ($channels->isEmpty()) {
                return [];
            }

            $channelIds = $channels->pluck('id')->map(fn ($id) => (int) $id)->all();

            // Map parent Course Hub IDs -> child sub-channel IDs in memory from loaded collection + 1 query for any filtered out
            $subChannelsByParent = [];
            $allSubChannels = Channel::whereIn('parent_hub_id', $channelIds)
                ->select(['id', 'parent_hub_id', 'description'])
                ->get();

            foreach ($allSubChannels as $sub) {
                $pid = (int) $sub->parent_hub_id;
                $subChannelsByParent[$pid][] = (int) $sub->id;
            }

            foreach ($channels as $ch) {
                $pid = ChannelPolicy::resolveParentHubId($ch);
                if ($pid !== null) {
                    $subChannelsByParent[$pid][] = (int) $ch->id;
                }
            }

            $allRelevantChannelIds = $channelIds;
            foreach ($subChannelsByParent as $subs) {
                $allRelevantChannelIds = array_merge($allRelevantChannelIds, $subs);
            }
            $allRelevantChannelIds = array_values(array_unique($allRelevantChannelIds));

            // 1. Grouped open Q&A threads count per channel
            $openThreadCounts = Message::query()
                ->selectRaw('channel_id, COUNT(*) as aggregate_count')
                ->whereIn('channel_id', $channelIds)
                ->whereNull('parent_id')
                ->where('is_resolved', false)
                ->where(function ($q) {
                    $q->whereNull('subject_hashtag')
                        ->orWhere('subject_hashtag', '!=', '__CHAT__');
                })
                ->groupBy('channel_id')
                ->pluck('aggregate_count', 'channel_id');

            // 2. Grouped chat messages count per channel (including sub-channels)
            $chatCountsByChannel = Message::query()
                ->selectRaw('channel_id, COUNT(*) as aggregate_count')
                ->whereIn('channel_id', $allRelevantChannelIds)
                ->whereNull('parent_id')
                ->where('subject_hashtag', '__CHAT__')
                ->groupBy('channel_id')
                ->pluck('aggregate_count', 'channel_id');

            // 3. Grouped approved member counts & student counts per channel (when roster is not eager-loaded)
            $memberCountsByChannel = [];
            $studentCountsByChannel = [];
            $facultyByChannel = [];
            if (! $withFullRoster) {
                $countRows = DB::table('channel_user')
                    ->join('users', 'users.id', '=', 'channel_user.user_id')
                    ->whereIn('channel_user.channel_id', $channelIds)
                    ->where('channel_user.approval_status', 'approved')
                    ->where('users.verification_status', 'approved')
                    ->where('users.role', '!=', 'it_admin')
                    ->selectRaw("channel_user.channel_id, COUNT(*) as aggregate_count, SUM(CASE WHEN users.role = 'student' THEN 1 ELSE 0 END) as students_count")
                    ->groupBy('channel_user.channel_id')
                    ->get();

                foreach ($countRows as $row) {
                    $cid = (int) $row->channel_id;
                    $memberCountsByChannel[$cid] = (int) $row->aggregate_count;
                    $studentCountsByChannel[$cid] = (int) $row->students_count;
                }

                $facultyRows = DB::table('channel_user')
                    ->join('users', 'users.id', '=', 'channel_user.user_id')
                    ->whereIn('channel_user.channel_id', $channelIds)
                    ->where('channel_user.approval_status', 'approved')
                    ->where('users.verification_status', 'approved')
                    ->whereIn('users.role', ['faculty', 'dept_head'])
                    ->select(['channel_user.channel_id', 'users.id', 'users.name', 'users.role'])
                    ->orderBy('users.name')
                    ->orderBy('users.id')
                    ->get();

                foreach ($facultyRows as $fRow) {
                    $cid = (int) $fRow->channel_id;
                    $facultyByChannel[$cid][] = [
                        'id' => (int) $fRow->id,
                        'name' => (string) $fRow->name,
                        'role' => (string) $fRow->role,
                    ];
                }

                // Fallback: if a channel has no approved faculty in channel_user, check if its creator is an approved faculty/dept_head
                $creatorIdsToLoad = [];
                foreach ($channels as $ch) {
                    $cid = (int) $ch->id;
                    if (empty($facultyByChannel[$cid]) && ! empty($ch->created_by)) {
                        $creatorIdsToLoad[] = (int) $ch->created_by;
                    }
                }
                if (! empty($creatorIdsToLoad)) {
                    $creatorsById = User::query()
                        ->whereIn('id', array_values(array_unique($creatorIdsToLoad)))
                        ->where('verification_status', 'approved')
                        ->whereIn('role', ['faculty', 'dept_head'])
                        ->get(['id', 'name', 'role'])
                        ->keyBy('id');

                    foreach ($channels as $ch) {
                        $cid = (int) $ch->id;
                        if (empty($facultyByChannel[$cid]) && ! empty($ch->created_by)) {
                            $creator = $creatorsById->get((int) $ch->created_by);
                            if ($creator) {
                                $facultyByChannel[$cid] = [[
                                    'id' => (int) $creator->id,
                                    'name' => (string) $creator->name,
                                    'role' => (string) $creator->role,
                                ]];
                            }
                        }
                    }
                }
            }

            // 4. Latest announcement per channel in 1 query
            $latestAnnIds = Announcement::query()
                ->selectRaw('MAX(id) as max_id')
                ->whereIn('channel_id', $channelIds)
                ->groupBy('channel_id')
                ->pluck('max_id')
                ->all();

            $latestAnnouncementsByChannel = empty($latestAnnIds)
                ? collect()
                : Announcement::with('publisher:id,name')
                    ->whereIn('id', $latestAnnIds)
                    ->get()
                    ->keyBy('channel_id');

            // 5. Latest message per channel in 1 query
            $latestMsgIds = Message::query()
                ->selectRaw('MAX(id) as max_id')
                ->whereIn('channel_id', $allRelevantChannelIds)
                ->groupBy('channel_id')
                ->pluck('max_id')
                ->all();

            $latestMessagesByChannel = empty($latestMsgIds)
                ? collect()
                : Message::with('sender:id,name')
                    ->whereIn('id', $latestMsgIds)
                    ->get()
                    ->keyBy('channel_id');

            foreach ($channels as $ch) {
                $cid = (int) $ch->id;
                $parentHubId = ChannelPolicy::resolveParentHubId($ch);
                $hubChannelIds = [$cid];
                if ($parentHubId === null && ! empty($subChannelsByParent[$cid])) {
                    $hubChannelIds = array_values(array_unique(array_merge($hubChannelIds, $subChannelsByParent[$cid])));
                }

                $totalChatCount = 0;
                $bestLatestMsg = null;
                foreach ($hubChannelIds as $hcid) {
                    $totalChatCount += (int) ($chatCountsByChannel[$hcid] ?? 0);
                    $candidateMsg = $latestMessagesByChannel->get($hcid);
                    if ($candidateMsg && (! $bestLatestMsg || $candidateMsg->id > $bestLatestMsg->id)) {
                        $bestLatestMsg = $candidateMsg;
                    }
                }

                $ch->precomputed_include_roster = $withFullRoster;
                $ch->precomputed_open_threads_count = (int) ($openThreadCounts[$cid] ?? 0);
                $ch->precomputed_chat_messages_count = $totalChatCount;
                if (! $withFullRoster) {
                    $ch->precomputed_members_count = (int) ($memberCountsByChannel[$cid] ?? 0);
                    $ch->precomputed_students_count = (int) ($studentCountsByChannel[$cid] ?? 0);
                    $ch->precomputed_faculty = $facultyByChannel[$cid] ?? [];
                }
                $ch->precomputed_latest_announcement = $latestAnnouncementsByChannel->get($cid);
                $ch->precomputed_latest_message = $bestLatestMsg;
            }

            return ChannelResource::collection($channels)->resolve($request);
        };

        // Never serve rosters/pending_requests from a shared cache key
        if ($includeRoster) {
            $sharedData = $buildChannelsList(true);
        } else {
            $cacheKey = ApiCache::channelsKey(null, $cacheParams);
            $sharedData = Cache::remember(
                $cacheKey,
                ApiCache::CHANNELS_TTL_SECONDS,
                fn (): array => $buildChannelsList(false)
            );
        }

        // Overlay current user's membership state fresh from DB on every request when full roster was not requested
        if ($user && ! $includeRoster && ! empty($sharedData)) {
            $pivots = DB::table('channel_user')
                ->where('user_id', $user->id)
                ->pluck('approval_status', 'channel_id')
                ->all();

            $userProfile = $user->relationLoaded('academicProfile')
                ? $user->academicProfile
                : $user->academicProfile()->first();

            $selfEntry = [
                'id' => $user->id,
                'institutional_id' => $user->institutional_id,
                'name' => $user->name,
                'role' => $user->role,
                'section' => $userProfile?->section ?? 'IT3R2',
                'department' => $userProfile?->department ?? 'CITC',
            ];

            foreach ($sharedData as &$channelItem) {
                $cid = (int) ($channelItem['id'] ?? 0);
                $status = $pivots[$cid] ?? null;
                if ($status === 'approved') {
                    $channelItem['roster'] = [$selfEntry];
                    $channelItem['pending_requests'] = [];
                } elseif ($status === 'pending') {
                    $channelItem['roster'] = [];
                    $channelItem['pending_requests'] = [$selfEntry];
                } else {
                    $channelItem['roster'] = [];
                    $channelItem['pending_requests'] = [];
                }
            }
            unset($channelItem);
        }

        return response()->json([
            'data' => $sharedData,
        ]);
    }

    /**
     * GET /api/v1/channels/{id}/roster
     * Returns a single channel with its full approved roster loaded (and pending_requests for Course Admins only).
     * Never served from a shared cache.
     */
    public function roster(Request $request, int $id): JsonResponse
    {
        $channel = Channel::with('members.academicProfile')->findOrFail($id);
        $user = $request->user();

        if (
            ! $user ||
            (! ChannelPolicy::hasApprovedChannelAccess($user, $channel) &&
             ! ChannelPolicy::isCourseAdmin($user, $channel))
        ) {
            return response()->json([
                'status' => 403,
                'message' => "Access Denied: You are not an approved member of {$channel->name}.",
            ], 403);
        }

        $channel->precomputed_include_roster = true;

        return response()->json([
            'data' => new ChannelResource($channel),
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
            'parent_hub_id' => ['nullable', 'integer', 'exists:channels,id'],
            'course_code' => ['required', 'string', 'max:32'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:1000'],
            'channel_type' => ['required', 'in:university,college,department,course_hub'],
            'scope_college' => ['nullable', 'string', 'max:64'],
            'scope_department' => ['nullable', 'string', 'max:64'],
            'scope_section' => ['nullable', 'string', 'max:64'],
        ], [
            'course_code.required' => 'The course code field is required (e.g., IT315).',
            'name.required' => 'The channel name field is required.',
        ]);

        $formattedName = str_starts_with(trim($validated['name']), '#')
            ? trim($validated['name'])
            : '# ' . trim($validated['name']);

        $scopeSection = $validated['scope_section'] ?? 'IT3R2';
        $description = $validated['description'] ?? "{$scopeSection} Scoped Course Hub";

        $parentHubId = isset($validated['parent_hub_id']) ? (int) $validated['parent_hub_id'] : null;
        if ($parentHubId === null && is_string($description) && preg_match('/^\[HUB:(\d+)\]/i', $description, $matches)) {
            $candidateParentId = (int) $matches[1];
            if (Channel::where('id', $candidateParentId)->exists()) {
                $parentHubId = $candidateParentId;
            }
        }

        $channel = Channel::create([
            'parent_hub_id' => $parentHubId,
            'course_code' => strtoupper(trim($validated['course_code'])),
            'name' => $formattedName,
            'description' => $description,
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
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
        ]);

        ApiCache::forgetChannels((int) $channel->id);
        RealtimeStateUpdated::safeDispatch('channel.created', (int) $channel->id, (int) $user->id);

        return response()->json([
            'message' => 'Scoped channel created successfully.',
            'data' => new ChannelResource($channel->load('members.academicProfile')),
        ], 201);
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

        if (! ChannelPolicy::isCourseAdmin($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can edit this Course Hub.',
            ], 403);
        }

        $validated = $request->validate([
            'course_code' => ['required', 'string', 'max:32'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:1000'],
            'scope_college' => ['nullable', 'string', 'max:64'],
            'scope_department' => ['nullable', 'string', 'max:64'],
            'scope_section' => ['nullable', 'string', 'max:64'],
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
        Channel::where('parent_hub_id', $channel->id)
            ->orWhere('description', 'like', "[HUB:{$channel->id}]%")
            ->update([
                'parent_hub_id' => $channel->id,
                'course_code' => strtoupper(trim($validated['course_code'])),
                'scope_college' => $scopeCollege,
                'scope_department' => $scopeDepartment,
                'scope_section' => $scopeSection,
            ]);

        ApiCache::forgetChannels((int) $channel->id);
        ApiCache::forgetChannelAnnouncements((int) $channel->id);
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

        if (! ChannelPolicy::isCourseAdmin($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can delete this Course Hub.',
            ], 403);
        }

        $channelName = $channel->name;

        // Find any sub-channels belonging to this Course Hub
        $subChannelIds = Channel::where('parent_hub_id', $channel->id)
            ->orWhere('description', 'like', "[HUB:{$channel->id}]%")
            ->pluck('id')
            ->all();

        $allTargetIds = array_values(array_unique(array_merge([$channel->id], $subChannelIds)));

        Message::whereIn('channel_id', $allTargetIds)->delete();
        Announcement::whereIn('channel_id', $allTargetIds)->delete();
        DB::table('channel_user')->whereIn('channel_id', $allTargetIds)->delete();
        Channel::whereIn('id', $allTargetIds)->delete();

        foreach ($allTargetIds as $targetId) {
            ApiCache::forgetChannelAnnouncements((int) $targetId);
            ApiCache::forgetChannels((int) $targetId);
        }

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

        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $isAdmin = ChannelPolicy::isCourseAdmin($user, $channel);
        $targetStatus = $isAdmin ? 'approved' : 'pending';

        $existingPivot = DB::table('channel_user')
            ->where('channel_id', $channel->id)
            ->where('user_id', $user->id)
            ->first();

        if ($existingPivot) {
            if ($isAdmin && ($existingPivot->approval_status ?? 'approved') !== 'approved') {
                DB::table('channel_user')
                    ->where('channel_id', $channel->id)
                    ->where('user_id', $user->id)
                    ->update([
                        'can_publish' => true,
                        'approval_status' => 'approved',
                    ]);
            }
        } else {
            $channel->members()->syncWithoutDetaching([
                $user->id => [
                    'can_publish' => $user->canPublishOrManage(),
                    'approval_status' => $targetStatus,
                    'joined_at' => now(),
                ],
            ]);
        }

        ApiCache::forgetChannels((int) $channel->id);
        ApiCache::forgetChannelAnnouncements((int) $channel->id);
        RealtimeStateUpdated::dispatchMembershipChanged(
            (int) $channel->id,
            (int) $user->id,
            'requested',
            (int) $user->id
        );
        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        $fresh = $channel->fresh('members.academicProfile');
        $isNowApproved = $fresh->members->contains(
            fn ($m) => (int) $m->id === (int) $user->id && ($m->pivot?->approval_status ?? 'approved') === 'approved'
        );

        return response()->json([
            'message' => $isNowApproved
                ? "Joined {$channel->name} successfully."
                : "Join request sent for {$channel->name}! Waiting for Course Admin approval.",
            'data' => new ChannelResource($fresh),
        ]);
    }

    /**
     * POST /api/v1/channels/{id}/leave
     */
    public function leave(Request $request, int $id): JsonResponse
    {
        $channel = Channel::findOrFail($id);
        $user = $request->user();

        if ($user->role === 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.',
            ], 403);
        }

        $subChannelIds = Channel::where('parent_hub_id', $channel->id)
            ->orWhere('description', 'like', "[HUB:{$channel->id}]%")
            ->pluck('id')
            ->all();
        $allTargetIds = array_values(array_unique(array_merge([$channel->id], $subChannelIds)));

        DB::table('channel_user')
            ->whereIn('channel_id', $allTargetIds)
            ->where('user_id', $user->id)
            ->delete();

        ApiCache::forgetChannels((int) $channel->id);
        ApiCache::forgetChannelAnnouncements((int) $channel->id);
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

        $channel = Channel::findOrFail($id);

        if (! ChannelPolicy::isCourseAdmin($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can add, approve, or remove members in this Course Hub.',
            ], 403);
        }

        $validated = $request->validate([
            'institutional_id' => ['required', 'string', 'max:64'],
            'name' => ['nullable', 'string', 'max:150'],
            'section' => ['nullable', 'string', 'max:64'],
            'action' => ['required', 'in:add,remove,approve,reject'],
        ]);

        $action = $validated['action'];

        $txResult = DB::transaction(function () use ($channel, $validated, $action): array {
            $targetUser = User::where('institutional_id', $validated['institutional_id'])->first();

            if (in_array($action, ['approve', 'reject'], true)) {
                if (! $targetUser) {
                    return [
                        'conflict' => true,
                        'target_user' => null,
                    ];
                }

                $pivotRow = DB::table('channel_user')
                    ->where('channel_id', $channel->id)
                    ->where('user_id', $targetUser->id)
                    ->lockForUpdate()
                    ->first();

                if (! $pivotRow || ($pivotRow->approval_status ?? 'approved') !== 'pending') {
                    return [
                        'conflict' => true,
                        'target_user' => $targetUser,
                    ];
                }

                if ($action === 'approve') {
                    DB::table('channel_user')
                        ->where('channel_id', $channel->id)
                        ->where('user_id', $targetUser->id)
                        ->where('approval_status', 'pending')
                        ->update([
                            'approval_status' => 'approved',
                            'joined_at' => now(),
                        ]);
                } else {
                    // 'reject' only deletes a pending join request row — never detaches an approved member
                    DB::table('channel_user')
                        ->where('channel_id', $channel->id)
                        ->where('user_id', $targetUser->id)
                        ->where('approval_status', 'pending')
                        ->delete();
                }

                return [
                    'conflict' => false,
                    'target_user' => $targetUser,
                ];
            }

            if ($action === 'add') {
                if (! $targetUser) {
                    $targetUser = new User([
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
                        'approval_status' => 'approved',
                        'joined_at' => now(),
                    ],
                ]);

                DB::table('channel_user')
                    ->where('channel_id', $channel->id)
                    ->where('user_id', $targetUser->id)
                    ->update(['approval_status' => 'approved']);

                return [
                    'conflict' => false,
                    'target_user' => $targetUser,
                ];
            }

            // Explicit 'remove' action
            if ($targetUser) {
                $channel->members()->detach($targetUser->id);
            }

            return [
                'conflict' => false,
                'target_user' => $targetUser,
            ];
        });

        $freshChannel = $channel->fresh('members.academicProfile');
        $freshChannel->precomputed_include_roster = true;

        if ($txResult['conflict']) {
            return response()->json([
                'status' => 409,
                'message' => 'This request was already approved/declined by another Course Admin.',
                'data' => new ChannelResource($freshChannel),
            ], 409);
        }

        ApiCache::forgetChannels((int) $channel->id);
        ApiCache::forgetChannelAnnouncements((int) $channel->id);

        /** @var \App\Models\User|null $targetUser */
        $targetUser = $txResult['target_user'];
        $broadcastActionMap = [
            'add' => 'added',
            'approve' => 'approved',
            'reject' => 'rejected',
            'remove' => 'removed',
        ];
        if ($targetUser && isset($broadcastActionMap[$action])) {
            RealtimeStateUpdated::dispatchMembershipChanged(
                (int) $channel->id,
                (int) $targetUser->id,
                $broadcastActionMap[$action],
                (int) $user->id
            );
        }

        RealtimeStateUpdated::safeDispatch('channel.updated', (int) $channel->id, (int) $user->id);

        $actionMessages = [
            'add' => 'Member added to channel roster.',
            'approve' => 'Join request approved! Member added to Course Hub roster.',
            'reject' => 'Join request declined.',
            'remove' => 'Member removed from channel roster.',
        ];

        return response()->json([
            'message' => $actionMessages[$action] ?? 'Roster updated.',
            'data' => new ChannelResource($freshChannel),
        ]);
    }
}

