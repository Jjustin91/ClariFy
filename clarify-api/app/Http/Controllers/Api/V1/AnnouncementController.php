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
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class AnnouncementController
{
    /**
     * GET /api/v1/announcements (Workflow 3, FR-04_REV, FR-05)
     * Uses withCount('reads') and computes per-user acknowledgment status after reading shared cache.
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
                'channel' => fn ($cq) => $cq->withCount('members'),
            ])->withCount('reads');

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
            } elseif ($sort === 'read_reach') {
                $query->orderByDesc('reads_count')->orderByDesc('published_at');
            } else {
                $query->orderByDesc('published_at');
            }

            $paginator = $query->paginate($perPage, ['*'], 'page', $page);
            if ($paginator->lastPage() > 0 && $page > $paginator->lastPage()) {
                $paginator = $query->paginate($perPage, ['*'], 'page', $paginator->lastPage());
            }

            $items = $paginator->items();
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
            'attachment' => ['nullable', 'file', 'max:10240'],
            'attachment_url' => ['nullable', 'string'],
            'attachment_name' => ['nullable', 'string', 'max:255'],
            'attachment_type' => ['nullable', 'in:image,document'],
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

        $attachmentUrl = $validated['attachment_url'] ?? null;
        $attachmentName = $validated['attachment_name'] ?? null;
        $attachmentType = $validated['attachment_type'] ?? null;

        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $mime = (string) ($file->getMimeType() ?: 'application/octet-stream');
            $attachmentName = $file->getClientOriginalName();
            $attachmentType = str_starts_with($mime, 'image/') ? 'image' : 'document';
            if (! $attachmentUrl) {
                $rawBytes = @file_get_contents($file->getRealPath());
                if ($rawBytes !== false && strlen($rawBytes) <= 5 * 1024 * 1024) {
                    $attachmentUrl = 'data:' . $mime . ';base64,' . base64_encode($rawBytes);
                } else {
                    $path = $file->store('memos', 'public');
                    $attachmentUrl = url(Storage::url($path));
                }
            }
        } elseif (! $attachmentUrl && $attachmentName) {
            $attachmentUrl = "/storage/memos/{$attachmentName}";
        }

        $firstAnnouncement = null;
        foreach ($targetChannelIds as $cid) {
            $ann = Announcement::create([
                'channel_id' => (int) $cid,
                'publisher_id' => $user->id,
                'title' => trim($validated['title']),
                'subtitle' => "{$pubDept} Department",
                'content' => trim($validated['content']),
                'attachment_url' => $attachmentUrl,
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
            'channel' => fn ($cq) => $cq->withCount('members'),
        ])->loadCount('reads');
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

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string', 'max:10000'],
            'tags' => ['nullable', 'array'],
            'is_urgent' => ['nullable', 'boolean'],
            'trigger_sms_fallback' => ['nullable', 'boolean'],
            'status' => ['nullable', 'in:published,draft,archived'],
            'attachment_url' => ['nullable', 'string'],
            'attachment_name' => ['nullable', 'string', 'max:255'],
            'attachment_type' => ['nullable', 'in:image,document'],
            'remove_attachment' => ['nullable', 'boolean'],
        ]);

        $removeAttachment = filter_var($request->input('remove_attachment', false), FILTER_VALIDATE_BOOLEAN);
        $nextAttachmentUrl = $removeAttachment
            ? null
            : ($request->exists('attachment_url') ? $validated['attachment_url'] : $announcement->attachment_url);
        $nextAttachmentName = $removeAttachment
            ? null
            : ($request->exists('attachment_name') ? $validated['attachment_name'] : $announcement->attachment_name);
        $nextAttachmentType = $removeAttachment
            ? null
            : ($request->exists('attachment_type') ? $validated['attachment_type'] : $announcement->attachment_type);

        $announcement->update([
            'title' => trim($validated['title']),
            'content' => trim($validated['content']),
            'tags' => $validated['tags'] ?? $announcement->tags,
            'is_urgent' => $validated['is_urgent'] ?? $announcement->is_urgent,
            'is_pinned' => $validated['is_urgent'] ?? $announcement->is_pinned,
            'trigger_sms_fallback' => $validated['trigger_sms_fallback'] ?? $announcement->trigger_sms_fallback,
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
            'channel' => fn ($cq) => $cq->withCount('members'),
        ])->loadCount('reads');
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
        $announcement->update(['status' => 'archived']);
        $announcement->delete();

        ApiCache::forgetChannelAnnouncements($channelId);
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

        $freshAnnouncement = $announcement->fresh([
            'publisher.academicProfile',
            'channel' => fn ($cq) => $cq->withCount('members'),
        ])->loadCount('reads');
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
}

