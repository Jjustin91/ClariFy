<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\AnnouncementResource;
use App\Jobs\DispatchUrgentPushAlerts;
use App\Jobs\TriggerSmsFallbackBatch;
use App\Models\Announcement;
use App\Models\AnnouncementRead;
use App\Models\Channel;
use App\Policies\ChannelPolicy;
use App\Support\ApiCache;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AnnouncementController
{
    public const ALLOWED_ATTACHMENT_EXTENSIONS = [
        'jpg', 'jpeg', 'png', 'webp', 'gif',
        'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt',
    ];

    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    private const FORBIDDEN_MIME_SUBSTRINGS = [
        'php',
        'x-msdownload',
        'x-executable',
        'x-dosexec',
        'x-sh',
        'x-shellscript',
        'javascript',
        'html',
    ];

    /**
     * GET /api/v1/announcements (Workflow 3, FR-04_REV, FR-05)
     * Uses batched grouped queries for approved-student Read Reach and computes per-user acknowledgment after reading shared cache.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $channelId = $request->query('channel_id');
        $tag = $request->query('tag');
        $department = $request->query('department');
        $search = trim((string) $request->query('search', ''));
        $sort = (string) $request->query('sort', 'latest');
        $perPage = min(50, max(1, (int) $request->query('per_page', 4)));
        $page = max(1, (int) $request->query('page', 1));

        if ($channelId !== null && $channelId !== '') {
            $channel = Channel::findOrFail((int) $channelId);
            if (! $user || ! ChannelPolicy::hasApprovedChannelAccess($user, $channel)) {
                return response()->json([
                    'status' => 403,
                    'message' => "Access Denied: You are not an approved member of {$channel->name} (FR-01_REV).",
                ], 403);
            }
        }

        $enrolledIds = [];
        if (! $channelId && $user) {
            $enrolledIds = DB::table('channel_user')
                ->where('user_id', $user->id)
                ->where('approval_status', 'approved')
                ->orderBy('channel_id')
                ->pluck('channel_id')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        // Cache key is shared across users with the same role/scope filter; per-user acknowledgment is computed after cache read
        $cacheParams = array_filter([
            'can_manage' => $user?->canPublishOrManage() ? 1 : 0,
            'enrolled' => ! $channelId ? implode(',', $enrolledIds) : null,
            'pub_uid' => (! $channelId && $user?->canPublishOrManage()) ? $user->id : null,
            'tag' => $tag,
            'department' => $department,
            'search' => $search,
            'sort' => $sort,
            'per_page' => $perPage,
            'page' => $page,
        ], fn ($value) => $value !== null && $value !== '');

        $cacheKey = $channelId
            ? ApiCache::announcementChannelKey((int) $channelId, $cacheParams)
            : ApiCache::announcementFeedKey($user?->id, $cacheParams);

        $payload = Cache::remember($cacheKey, ApiCache::ANNOUNCEMENTS_TTL_SECONDS, function () use (
            $request,
            $user,
            $channelId,
            $enrolledIds,
            $tag,
            $department,
            $search,
            $sort,
            $perPage,
            $page
        ): array {
            $query = Announcement::with([
                'publisher.academicProfile',
                'channel',
            ]);

            $likeOp = DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

            if (! $user || ! $user->canPublishOrManage()) {
                $query->where('status', 'published');
            }

            if ($channelId) {
                $query->where('channel_id', (int) $channelId);
            } elseif ($user) {
                $query->where(function ($q) use ($enrolledIds, $user) {
                    $q->whereHas('channel', fn ($cq) => $cq->where('channel_type', '!=', 'course_hub'))
                        ->orWhereIn('channel_id', $enrolledIds)
                        ->orWhere('publisher_id', $user->id);
                });
            }

            if ($tag && strtoupper((string) $tag) !== 'ALL') {
                if (strtoupper(trim((string) $tag)) === 'COURSE HUB') {
                    $query->whereHas('channel', fn ($cq) => $cq->where('channel_type', 'course_hub'));
                } else {
                    $query->whereJsonContains('tags', $tag);
                }
            }

            if ($department && strtoupper((string) $department) !== 'ALL') {
                $query->where(function ($q) use ($department) {
                    $q->whereJsonContains('tags', $department)
                        ->orWhereHas('publisher.academicProfile', function ($pq) use ($department) {
                            $pq->where('department', $department);
                        });
                });
            }

            if ($search !== '') {
                $query->where(function ($q) use ($search, $likeOp) {
                    $q->where('title', $likeOp, "%{$search}%")
                        ->orWhere('content', $likeOp, "%{$search}%")
                        ->orWhere('subtitle', $likeOp, "%{$search}%")
                        ->orWhereHas('channel', fn ($cq) => $cq->where('course_code', $likeOp, "%{$search}%"))
                        ->orWhereHas('publisher', fn ($pq) => $pq->where('name', $likeOp, "%{$search}%"));
                });
            }

            // Urgent notices first, then pinned notices, then sort preference (FR-04_REV)
            $query->orderByDesc('is_urgent')->orderByDesc('is_pinned');

            if ($sort === 'oldest') {
                $query->orderBy('published_at');
            } else {
                $query->orderByDesc('published_at');
            }

            $paginator = $query->paginate($perPage, ['*'], 'page', $page);
            if ($paginator->lastPage() > 0 && $page > $paginator->lastPage()) {
                $paginator = $query->paginate($perPage, ['*'], 'page', $paginator->lastPage());
            }

            $items = $paginator->items();
            $this->hydrateReadReachMetrics($items);

            if ($sort === 'read_reach') {
                usort($items, function (Announcement $a, Announcement $b): int {
                    if ((bool) $a->is_urgent !== (bool) $b->is_urgent) {
                        return $a->is_urgent ? -1 : 1;
                    }
                    if ((bool) $a->is_pinned !== (bool) $b->is_pinned) {
                        return $a->is_pinned ? -1 : 1;
                    }
                    $pctCmp = ((float) ($b->precomputed_percentage ?? 0)) <=> ((float) ($a->precomputed_percentage ?? 0));
                    if ($pctCmp !== 0) {
                        return $pctCmp;
                    }
                    return ($b->published_at?->timestamp ?? 0) <=> ($a->published_at?->timestamp ?? 0);
                });
            }

            foreach ($items as $item) {
                $item->has_current_user_acknowledged = false;
            }

            return [
                'data' => AnnouncementResource::collection($items)->resolve($request),
                'meta' => [
                    'current_page' => $paginator->currentPage(),
                    'last_page' => max(1, $paginator->lastPage()),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                ],
            ];
        });

        // Compute per-user acknowledgment flags in a single indexed query after cache read
        if ($user && ! empty($payload['data'])) {
            $announcementIds = array_values(array_filter(array_map(
                fn (array $item) => isset($item['id']) ? (int) $item['id'] : 0,
                $payload['data']
            )));

            if (! empty($announcementIds)) {
                $ackedSet = array_flip(
                    AnnouncementRead::where('user_id', $user->id)
                        ->whereIn('announcement_id', $announcementIds)
                        ->pluck('announcement_id')
                        ->map(fn ($id) => (int) $id)
                        ->all()
                );

                foreach ($payload['data'] as &$item) {
                    $aid = (int) ($item['id'] ?? 0);
                    $item['read_reach']['has_current_user_acknowledged'] = isset($ackedSet[$aid]);
                }
                unset($item);
            }
        }

        return response()->json($payload);
    }

    /**
     * POST /api/v1/announcements & alias POST /api/announcements/create (Workflow 2, FR-02, NFR-02, TC-NFR01)
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $scopeMode = trim((string) $request->input('scope_mode', ''));
        $isCampusWide = $scopeMode === 'campus_wide' || (! $request->filled('channel_id') && ! $request->filled('channel_ids') && $user?->role === 'dept_head');

        if ($isCampusWide && $user?->role !== 'dept_head') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only Department Heads are authorized to publish Campus-Wide Announcements.',
            ], 403);
        }

        $targetChannelIds = [];
        if ($isCampusWide) {
            $uniChannel = Channel::firstOrCreate(
                ['channel_type' => 'university', 'course_code' => 'CAMPUS'],
                [
                    'name' => '# USTP Campus-Wide',
                    'description' => 'USTP Campus-Wide Official Announcements',
                    'scope_college' => 'USTP',
                    'scope_department' => $user?->academicProfile?->department ?? 'CITC',
                    'scope_section' => null,
                    'instructor_name' => $user?->name ?? 'Department Head',
                    'created_by' => $user?->id,
                ]
            );
            $targetChannelIds = [$uniChannel->id];
            $request->merge(['channel_id' => $uniChannel->id]);
        } else {
            $rawIds = $request->input('channel_ids');
            if (is_array($rawIds)) {
                $targetChannelIds = array_values(array_filter(array_map('intval', $rawIds)));
            } elseif (is_string($rawIds) && trim($rawIds) !== '') {
                $decoded = json_decode($rawIds, true);
                if (is_array($decoded)) {
                    $targetChannelIds = array_values(array_filter(array_map('intval', $decoded)));
                } else {
                    $targetChannelIds = array_values(array_filter(array_map('intval', explode(',', $rawIds))));
                }
            }

            if (empty($targetChannelIds) && $request->filled('channel_id')) {
                $targetChannelIds = [(int) $request->input('channel_id')];
            }

            if (! empty($targetChannelIds)) {
                $request->merge(['channel_id' => $targetChannelIds[0]]);
            }
        }

        foreach ($targetChannelIds as $cid) {
            $targetChannel = Channel::findOrFail((int) $cid);
            $authResponse = Gate::inspect('create', [Announcement::class, $targetChannel]);
            if ($authResponse->denied()) {
                return response()->json([
                    'status' => 403,
                    'message' => $authResponse->message(),
                ], 403);
            }
        }

        if (empty($targetChannelIds)) {
            $authResponse = Gate::inspect('create', [Announcement::class, null]);
            if ($authResponse->denied()) {
                return response()->json([
                    'status' => 403,
                    'message' => $authResponse->message(),
                ], 403);
            }
        }

        $validated = $request->validate([
            'channel_id' => ['required', 'integer', 'exists:channels,id'],
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string', 'max:10000'],
            'tags' => ['nullable'],
            'is_urgent' => ['nullable'],
            'trigger_sms_fallback' => ['nullable'],
            'status' => ['nullable', 'in:published,draft,archived'],
            'attachment' => $this->attachmentValidationRules(),
        ], [
            'title.required' => 'The title field is required.',
            'content.required' => 'The announcement content field is required.',
        ]);

        $pubDept = $user->academicProfile?->department ?? 'CITC';
        $tags = $isCampusWide ? ['OFFICIAL MEMO', 'CDO CAMPUS', $pubDept] : [];
        if (array_key_exists('tags', $validated) && $validated['tags'] !== null) {
            if (is_array($validated['tags'])) {
                $tags = $validated['tags'];
            } elseif (is_string($validated['tags'])) {
                $decoded = json_decode($validated['tags'], true);
                $tags = is_array($decoded)
                    ? $decoded
                    : (trim($validated['tags']) !== '' ? array_map('trim', explode(',', $validated['tags'])) : []);
            }
        }
        if (! $isCampusWide) {
            $tags = [];
        }

        $isUrgent = filter_var($request->input('is_urgent', false), FILTER_VALIDATE_BOOLEAN);
        $triggerSms = filter_var($request->input('trigger_sms_fallback', false), FILTER_VALIDATE_BOOLEAN);

        if ($isCampusWide && $isUrgent && ! in_array('URGENT NOTICE', $tags, true)) {
            array_unshift($tags, 'URGENT NOTICE');
        }

        $uploadedFile = $request->hasFile('attachment') ? $request->file('attachment') : null;
        $firstStoredPath = null;
        $attachmentName = null;
        $attachmentType = null;

        $firstAnnouncement = null;
        foreach ($targetChannelIds as $index => $cid) {
            $channelAttachmentPath = null;

            if ($uploadedFile instanceof UploadedFile) {
                if ($index === 0 || $firstStoredPath === null) {
                    [$firstStoredPath, $attachmentName, $attachmentType] = $this->storeUploadedAttachment(
                        $uploadedFile,
                        (int) $cid
                    );
                    $channelAttachmentPath = $firstStoredPath;
                } else {
                    $ext = pathinfo($firstStoredPath, PATHINFO_EXTENSION) ?: 'bin';
                    $copyPath = 'announcements/' . (int) $cid . '/' . Str::uuid()->toString() . '.' . $ext;
                    Storage::disk('public')->copy($firstStoredPath, $copyPath);
                    $channelAttachmentPath = $copyPath;
                }
            }

            $ann = Announcement::create([
                'channel_id' => (int) $cid,
                'publisher_id' => $user->id,
                'title' => trim($validated['title']),
                'subtitle' => "{$pubDept} Department",
                'content' => trim($validated['content']),
                'attachment_url' => $channelAttachmentPath,
                'attachment_name' => $attachmentName,
                'attachment_type' => $attachmentType,
                'tags' => $tags,
                'is_urgent' => $isUrgent,
                'is_pinned' => $isUrgent,
                'trigger_sms_fallback' => $triggerSms,
                'status' => $validated['status'] ?? 'published',
                'is_edited' => false,
                'published_at' => now(),
            ]);

            if (! $firstAnnouncement) {
                $firstAnnouncement = $ann;
            }

            AnnouncementRead::firstOrCreate([
                'announcement_id' => $ann->id,
                'user_id' => $user->id,
            ], [
                'acknowledged_at' => now(),
            ]);

            if ($isUrgent) {
                DispatchUrgentPushAlerts::dispatch($ann);
            }

            if ($triggerSms) {
                TriggerSmsFallbackBatch::dispatch($ann);
            }

            ApiCache::forgetChannelAnnouncements((int) $cid);
            ApiCache::forgetChannels((int) $cid);
        }

        ApiCache::forgetChannelAnnouncements(null);

        $firstAnnouncement->load([
            'publisher.academicProfile',
            'channel',
        ]);
        $this->hydrateReadReachMetrics([$firstAnnouncement]);
        $firstAnnouncement->has_current_user_acknowledged = true;

        $resourcePayload = (new AnnouncementResource($firstAnnouncement))->resolve($request);

        RealtimeStateUpdated::safeDispatch(
            $isUrgent ? 'announcement.urgent' : 'announcement.created',
            (int) $firstAnnouncement->channel_id,
            (int) $user->id,
            $resourcePayload
        );

        return response()->json([
            'message' => $isUrgent
                ? 'Urgent Announcement published! Push alerts queued (<= 2.0s) and pinned to top.'
                : (count($targetChannelIds) > 1
                    ? 'Announcement published across ' . count($targetChannelIds) . ' handled Course Hubs.'
                    : 'Announcement published.'),
            'data' => $resourcePayload,
        ], 201);
    }

    /**
     * PATCH /api/v1/announcements/{id} (NFR-03_REV / TC-NFR03)
     * Supports both JSON PATCH and multipart/form-data POST with _method=PATCH.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $announcement = Announcement::findOrFail($id);

        $authResponse = Gate::inspect('update', $announcement);
        if ($authResponse->denied()) {
            return response()->json([
                'status' => 403,
                'message' => $authResponse->message(),
            ], 403);
        }

        $this->normalizeUpdateRequestInputs($request);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string', 'max:10000'],
            'tags' => ['nullable', 'array'],
            'is_urgent' => ['nullable', 'boolean'],
            'trigger_sms_fallback' => ['nullable', 'boolean'],
            'status' => ['nullable', 'in:published,draft,archived'],
            'attachment' => $this->attachmentValidationRules(),
            'remove_attachment' => ['nullable', 'boolean'],
        ], [
            'title.required' => 'The title field is required.',
            'content.required' => 'The announcement content field is required.',
        ]);

        $removeAttachment = filter_var($request->input('remove_attachment', false), FILTER_VALIDATE_BOOLEAN);
        $nextAttachmentUrl = $announcement->attachment_url;
        $nextAttachmentName = $announcement->attachment_name;
        $nextAttachmentType = $announcement->attachment_type;

        if ($request->hasFile('attachment')) {
            $this->deleteStoredAttachment($announcement->attachment_url);
            [$nextAttachmentUrl, $nextAttachmentName, $nextAttachmentType] = $this->storeUploadedAttachment(
                $request->file('attachment'),
                (int) $announcement->channel_id
            );
        } elseif ($removeAttachment) {
            $this->deleteStoredAttachment($announcement->attachment_url);
            $nextAttachmentUrl = null;
            $nextAttachmentName = null;
            $nextAttachmentType = null;
        }

        $nextUrgent = array_key_exists('is_urgent', $validated) && $validated['is_urgent'] !== null
            ? (bool) $validated['is_urgent']
            : (bool) $announcement->is_urgent;

        $announcement->update([
            'title' => trim($validated['title']),
            'content' => trim($validated['content']),
            'tags' => $validated['tags'] ?? $announcement->tags,
            'is_urgent' => $nextUrgent,
            'is_pinned' => $nextUrgent ? true : (bool) $announcement->is_pinned,
            'trigger_sms_fallback' => array_key_exists('trigger_sms_fallback', $validated) && $validated['trigger_sms_fallback'] !== null
                ? (bool) $validated['trigger_sms_fallback']
                : (bool) $announcement->trigger_sms_fallback,
            'status' => $validated['status'] ?? $announcement->status,
            'attachment_url' => $nextAttachmentUrl,
            'attachment_name' => $nextAttachmentName,
            'attachment_type' => $nextAttachmentType,
            'is_edited' => true,
        ]);

        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);
        ApiCache::forgetChannelAnnouncements(null);
        ApiCache::forgetChannels((int) $announcement->channel_id);

        $freshAnnouncement = $announcement->fresh([
            'publisher.academicProfile',
            'channel',
        ]);
        $this->hydrateReadReachMetrics([$freshAnnouncement]);
        if ($request->user()) {
            $freshAnnouncement->has_current_user_acknowledged = AnnouncementRead::where('announcement_id', $freshAnnouncement->id)
                ->where('user_id', $request->user()->id)
                ->exists();
        }

        $resourcePayload = (new AnnouncementResource($freshAnnouncement))->resolve($request);

        RealtimeStateUpdated::safeDispatch(
            $freshAnnouncement->is_urgent ? 'announcement.urgent' : 'announcement.updated',
            (int) $freshAnnouncement->channel_id,
            (int) ($request->user()?->id ?? $freshAnnouncement->publisher_id),
            $resourcePayload
        );

        return response()->json([
            'message' => 'Announcement updated and audit trail logged.',
            'data' => $resourcePayload,
        ]);
    }

    /**
     * DELETE /api/v1/announcements/{id}
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $announcement = Announcement::findOrFail($id);

        $authResponse = Gate::inspect('delete', $announcement);
        if ($authResponse->denied()) {
            return response()->json([
                'status' => 403,
                'message' => $authResponse->message(),
            ], 403);
        }

        $channelId = (int) $announcement->channel_id;
        $this->deleteStoredAttachment($announcement->attachment_url);
        $announcement->update([
            'status' => 'archived',
            'attachment_url' => null,
            'attachment_name' => null,
            'attachment_type' => null,
        ]);
        $announcement->delete();

        ApiCache::forgetChannelAnnouncements($channelId);
        ApiCache::forgetChannelAnnouncements(null);
        ApiCache::forgetChannels($channelId);

        RealtimeStateUpdated::safeDispatch(
            'announcement.deleted',
            $channelId,
            (int) ($request->user()?->id ?? 0)
        );

        return response()->json([
            'message' => 'Announcement archived and removed from active noticeboard.',
        ]);
    }

    /**
     * POST /api/v1/announcements/{id}/acknowledge (Read Reach Counter)
     */
    public function acknowledge(Request $request, int $id): JsonResponse
    {
        $announcement = Announcement::findOrFail($id);
        $user = $request->user();

        if ($announcement->channel_id) {
            $channel = Channel::find($announcement->channel_id);
            if ($channel && ! ChannelPolicy::hasApprovedChannelAccess($user, $channel)) {
                return response()->json([
                    'status' => 403,
                    'message' => "Access Denied: You are not an approved member of {$channel->name}.",
                ], 403);
            }
        }

        AnnouncementRead::firstOrCreate([
            'announcement_id' => $announcement->id,
            'user_id' => $user->id,
        ], [
            'acknowledged_at' => now(),
        ]);

        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);
        if ($announcement->channel) {
            $parentHubId = ChannelPolicy::resolveParentHubId($announcement->channel);
            if ($parentHubId !== null) {
                ApiCache::forgetChannelAnnouncements($parentHubId);
            }
        }

        $freshAnnouncement = $announcement->fresh([
            'publisher.academicProfile',
            'channel',
        ]);
        $this->hydrateReadReachMetrics([$freshAnnouncement]);
        $freshAnnouncement->has_current_user_acknowledged = true;

        $resourcePayload = (new AnnouncementResource($freshAnnouncement))->resolve($request);

        RealtimeStateUpdated::safeDispatch(
            'announcement.acknowledged',
            (int) $freshAnnouncement->channel_id,
            (int) $user->id,
            $resourcePayload
        );

        return response()->json([
            'message' => 'Announcement marked as read and acknowledged.',
            'data' => $resourcePayload,
        ]);
    }

    /**
     * Precomputes enrolled_total, acknowledged_count, and percentage for a batch of announcements
     * using a fixed number of grouped SQL queries (zero per-announcement queries).
     *
     * @param iterable<int, Announcement> $announcements
     */
    public function hydrateReadReachMetrics(iterable $announcements): void
    {
        $list = [];
        foreach ($announcements as $ann) {
            if ($ann instanceof Announcement) {
                $list[] = $ann;
            }
        }

        if (empty($list)) {
            return;
        }

        $courseHubIds = [];
        $courseHubAnnIds = [];
        $effectiveHubByAnnId = [];

        $deptScopes = [];
        $deptByAnnId = [];
        $deptAnnIds = [];

        $campusAnnIds = [];

        foreach ($list as $ann) {
            $aid = (int) $ann->id;
            $channel = $ann->relationLoaded('channel') ? $ann->channel : $ann->channel()->first();
            $channelType = $channel?->channel_type ?? 'course_hub';

            if ($channel && $channelType === 'course_hub') {
                $effectiveHubId = ChannelPolicy::resolveParentHubId($channel) ?? (int) $channel->id;
                $effectiveHubByAnnId[$aid] = $effectiveHubId;
                $courseHubIds[] = $effectiveHubId;
                $courseHubAnnIds[] = $aid;
            } elseif ($channel && in_array($channelType, ['department', 'college'], true)) {
                $scopeDept = strtoupper(trim((string) ($channel->scope_department ?? '')));
                if ($scopeDept !== '' && $scopeDept !== 'USTP' && $scopeDept !== 'ALL') {
                    $deptByAnnId[$aid] = $scopeDept;
                    $deptScopes[] = $scopeDept;
                    $deptAnnIds[] = $aid;
                } else {
                    $campusAnnIds[] = $aid;
                }
            } else {
                $campusAnnIds[] = $aid;
            }
        }

        // 1. Course Hub announcements (including sub-channels mapped to parent hub)
        $enrolledByHub = [];
        $ackedByAnnAndHub = [];

        if (! empty($courseHubIds)) {
            $uniqueHubIds = array_values(array_unique($courseHubIds));

            $enrolledByHub = DB::table('channel_user')
                ->join('users', 'users.id', '=', 'channel_user.user_id')
                ->whereIn('channel_user.channel_id', $uniqueHubIds)
                ->where('channel_user.approval_status', 'approved')
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->selectRaw('channel_user.channel_id, COUNT(DISTINCT channel_user.user_id) as student_count')
                ->groupBy('channel_user.channel_id')
                ->pluck('student_count', 'channel_user.channel_id')
                ->map(fn ($cnt) => (int) $cnt)
                ->all();

            $ackRows = DB::table('announcement_reads')
                ->join('users', 'users.id', '=', 'announcement_reads.user_id')
                ->join('channel_user', function ($join) use ($uniqueHubIds) {
                    $join->on('channel_user.user_id', '=', 'announcement_reads.user_id')
                        ->whereIn('channel_user.channel_id', $uniqueHubIds)
                        ->where('channel_user.approval_status', '=', 'approved');
                })
                ->whereIn('announcement_reads.announcement_id', array_values(array_unique($courseHubAnnIds)))
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->selectRaw('announcement_reads.announcement_id, channel_user.channel_id, COUNT(DISTINCT announcement_reads.user_id) as ack_count')
                ->groupBy('announcement_reads.announcement_id', 'channel_user.channel_id')
                ->get();

            foreach ($ackRows as $row) {
                $key = ((int) $row->announcement_id) . ':' . ((int) $row->channel_id);
                $ackedByAnnAndHub[$key] = (int) $row->ack_count;
            }
        }

        // 2. Department / College announcements
        $enrolledByDept = [];
        $ackedByAnnAndDept = [];

        if (! empty($deptScopes)) {
            $uniqueDepts = array_values(array_unique($deptScopes));

            $deptRows = DB::table('users')
                ->join('academic_profiles', 'academic_profiles.user_id', '=', 'users.id')
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->whereIn(DB::raw('UPPER(academic_profiles.department)'), $uniqueDepts)
                ->selectRaw('UPPER(academic_profiles.department) as dept_key, COUNT(DISTINCT users.id) as student_count')
                ->groupBy(DB::raw('UPPER(academic_profiles.department)'))
                ->get();

            foreach ($deptRows as $row) {
                $enrolledByDept[(string) $row->dept_key] = (int) $row->student_count;
            }

            $deptAckRows = DB::table('announcement_reads')
                ->join('users', 'users.id', '=', 'announcement_reads.user_id')
                ->join('academic_profiles', 'academic_profiles.user_id', '=', 'users.id')
                ->whereIn('announcement_reads.announcement_id', array_values(array_unique($deptAnnIds)))
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->whereIn(DB::raw('UPPER(academic_profiles.department)'), $uniqueDepts)
                ->selectRaw('announcement_reads.announcement_id, UPPER(academic_profiles.department) as dept_key, COUNT(DISTINCT announcement_reads.user_id) as ack_count')
                ->groupBy('announcement_reads.announcement_id', DB::raw('UPPER(academic_profiles.department)'))
                ->get();

            foreach ($deptAckRows as $row) {
                $key = ((int) $row->announcement_id) . ':' . ((string) $row->dept_key);
                $ackedByAnnAndDept[$key] = (int) $row->ack_count;
            }
        }

        // 3. Campus-wide announcements
        $campusEnrolledTotal = 0;
        $ackedByCampusAnn = [];

        if (! empty($campusAnnIds)) {
            $campusEnrolledTotal = (int) DB::table('users')
                ->where('verification_status', 'approved')
                ->where('role', 'student')
                ->count();

            $ackedByCampusAnn = DB::table('announcement_reads')
                ->join('users', 'users.id', '=', 'announcement_reads.user_id')
                ->whereIn('announcement_reads.announcement_id', array_values(array_unique($campusAnnIds)))
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->selectRaw('announcement_reads.announcement_id, COUNT(DISTINCT announcement_reads.user_id) as ack_count')
                ->groupBy('announcement_reads.announcement_id')
                ->pluck('ack_count', 'announcement_reads.announcement_id')
                ->map(fn ($cnt) => (int) $cnt)
                ->all();
        }

        // Assign precomputed attributes to each Announcement instance
        foreach ($list as $ann) {
            $aid = (int) $ann->id;
            if (isset($effectiveHubByAnnId[$aid])) {
                $hubId = $effectiveHubByAnnId[$aid];
                $enrolled = (int) ($enrolledByHub[$hubId] ?? 0);
                $acked = min($enrolled, (int) ($ackedByAnnAndHub["{$aid}:{$hubId}"] ?? 0));
            } elseif (isset($deptByAnnId[$aid])) {
                $deptKey = $deptByAnnId[$aid];
                $enrolled = (int) ($enrolledByDept[$deptKey] ?? 0);
                $acked = min($enrolled, (int) ($ackedByAnnAndDept["{$aid}:{$deptKey}"] ?? 0));
            } else {
                $enrolled = $campusEnrolledTotal;
                $acked = min($enrolled, (int) ($ackedByCampusAnn[$aid] ?? 0));
            }

            $ann->precomputed_enrolled_total = $enrolled;
            $ann->precomputed_acknowledged_count = $acked;
            $ann->precomputed_percentage = $enrolled > 0
                ? round(($acked / $enrolled) * 100, 1)
                : 0.0;
        }
    }

    /**
     * Validation rules for uploaded announcement attachments.
     *
     * @return array<int, mixed>
     */
    private function attachmentValidationRules(): array
    {
        $allowedList = implode(',', self::ALLOWED_ATTACHMENT_EXTENSIONS);

        return [
            'nullable',
            'file',
            "mimes:{$allowedList}",
            'max:10240',
            function (string $attribute, mixed $value, Closure $fail): void {
                if (! $value instanceof UploadedFile) {
                    return;
                }

                $ext = strtolower(trim((string) $value->getClientOriginalExtension()));
                if ($ext === '' || ! in_array($ext, self::ALLOWED_ATTACHMENT_EXTENSIONS, true)) {
                    $fail('The attachment field must be a file of type: ' . implode(', ', self::ALLOWED_ATTACHMENT_EXTENSIONS) . '.');
                    return;
                }

                $detectedMime = strtolower((string) ($value->getMimeType() ?: ''));
                foreach (self::FORBIDDEN_MIME_SUBSTRINGS as $forbidden) {
                    if ($detectedMime !== '' && str_contains($detectedMime, $forbidden)) {
                        $fail('Executable or script files are not allowed as announcement attachments.');
                        return;
                    }
                }
            },
        ];
    }

    /**
     * Normalizes multipart/form-data fields (JSON-encoded tags and string booleans) for update requests.
     */
    private function normalizeUpdateRequestInputs(Request $request): void
    {
        if ($request->has('tags') && is_string($request->input('tags'))) {
            $rawTags = trim((string) $request->input('tags'));
            if ($rawTags === '') {
                $request->merge(['tags' => []]);
            } else {
                $decoded = json_decode($rawTags, true);
                $request->merge([
                    'tags' => is_array($decoded)
                        ? $decoded
                        : array_values(array_filter(array_map('trim', explode(',', $rawTags)))),
                ]);
            }
        }

        foreach (['is_urgent', 'trigger_sms_fallback', 'remove_attachment'] as $boolField) {
            if ($request->has($boolField) && $request->input($boolField) !== null && $request->input($boolField) !== '') {
                $request->merge([
                    $boolField => filter_var($request->input($boolField), FILTER_VALIDATE_BOOLEAN),
                ]);
            }
        }
    }

    /**
     * Stores an uploaded file on the public disk under announcements/{channel_id}/ with a random filename.
     *
     * @return array{0:string, 1:string, 2:string} [relativePath, sanitizedOriginalName, attachmentType]
     */
    private function storeUploadedAttachment(UploadedFile $file, int $channelId): array
    {
        $originalName = (string) $file->getClientOriginalName();
        $sanitizedName = preg_replace('/[^\w\s\.\-\(\)]/u', '_', basename($originalName)) ?: 'attachment';
        $sanitizedName = mb_substr(trim($sanitizedName), 0, 255);

        $ext = strtolower(trim((string) $file->getClientOriginalExtension()));
        if (! in_array($ext, self::ALLOWED_ATTACHMENT_EXTENSIONS, true)) {
            $guessed = strtolower((string) ($file->guessExtension() ?: 'bin'));
            $ext = in_array($guessed, self::ALLOWED_ATTACHMENT_EXTENSIONS, true) ? $guessed : 'pdf';
        }

        $randomFileName = Str::uuid()->toString() . '.' . $ext;
        $directory = "announcements/{$channelId}";
        $storedPath = $file->storeAs($directory, $randomFileName, 'public');

        $detectedMime = strtolower((string) ($file->getMimeType() ?: ''));
        $isImage = str_starts_with($detectedMime, 'image/') || in_array($ext, self::IMAGE_EXTENSIONS, true);
        $attachmentType = $isImage ? 'image' : 'document';

        return [$storedPath, $sanitizedName, $attachmentType];
    }

    /**
     * Deletes an existing attachment file from the public disk when replaced, removed, or when the announcement is deleted.
     */
    private function deleteStoredAttachment(?string $storedUrlOrPath): void
    {
        if ($storedUrlOrPath === null || trim($storedUrlOrPath) === '') {
            return;
        }

        $trimmed = trim($storedUrlOrPath);
        if (str_starts_with($trimmed, 'data:')) {
            return;
        }

        $relativePath = $trimmed;
        if (str_starts_with($trimmed, 'http://') || str_starts_with($trimmed, 'https://')) {
            $parsedPath = (string) parse_url($trimmed, PHP_URL_PATH);
            $storagePos = strpos($parsedPath, '/storage/');
            if ($storagePos === false) {
                return;
            }
            $relativePath = substr($parsedPath, $storagePos + strlen('/storage/'));
        } elseif (str_starts_with($trimmed, '/storage/')) {
            $relativePath = substr($trimmed, strlen('/storage/'));
        } elseif (str_starts_with($trimmed, 'storage/')) {
            $relativePath = substr($trimmed, strlen('storage/'));
        }

        $relativePath = ltrim($relativePath, '/');
        if ($relativePath !== '' && Storage::disk('public')->exists($relativePath)) {
            Storage::disk('public')->delete($relativePath);
        }
    }
}


