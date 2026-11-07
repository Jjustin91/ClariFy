<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\AnnouncementResource;
use App\Jobs\DispatchUrgentPushAlerts;
use App\Jobs\TriggerSmsFallbackBatch;
use App\Models\Announcement;
use App\Models\AnnouncementRead;
use App\Models\Channel;
use App\Support\ApiCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class AnnouncementController
{
    /**
     * GET /api/v1/announcements (Workflow 3, FR-04_REV, FR-05)
     * Caches active announcements per channel for 10 minutes (600s) using the 'file' cache store.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $channelId = $request->query('channel_id');
        $tag = $request->query('tag');
        $department = $request->query('department');
        $search = trim((string) $request->query('search', ''));
        $sort = (string) $request->query('sort', 'latest');
        $perPage = max(1, (int) $request->query('per_page', 4));
        $page = max(1, (int) $request->query('page', 1));

        $cacheParams = array_filter([
            'user_id' => $user?->id ?? 0,
            'can_manage' => $user?->canPublishOrManage() ? 1 : 0,
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
            $tag,
            $department,
            $search,
            $sort,
            $perPage,
            $page
        ): array {
            $query = Announcement::with(['publisher.academicProfile', 'channel', 'reads'])
                ->withCount('reads');
            $likeOp = \Illuminate\Support\Facades\DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

            if (! $user || ! $user->canPublishOrManage()) {
                $query->where('status', 'published');
            }

            if ($channelId) {
                $query->where('channel_id', (int) $channelId);
            } elseif ($user) {
                $hasApprovalCol = Channel::ensureApprovalStatusColumn();
                $enrolledQuery = \Illuminate\Support\Facades\DB::table('channel_user')
                    ->where('user_id', $user->id);
                if ($hasApprovalCol) {
                    $enrolledQuery->where('approval_status', 'approved');
                }
                $enrolledIds = $enrolledQuery->pluck('channel_id')->all();

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

            return [
                'data' => AnnouncementResource::collection($paginator->items())->resolve($request),
                'meta' => [
                    'current_page' => $paginator->currentPage(),
                    'last_page' => max(1, $paginator->lastPage()),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                ],
            ];
        });

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

            if (empty($targetChannelIds)) {
                $fallbackChannel = Channel::find($request->input('channel_id', 1)) ?? Channel::first();
                if ($fallbackChannel) {
                    $targetChannelIds = [$fallbackChannel->id];
                    $request->merge(['channel_id' => $fallbackChannel->id]);
                }
            } else {
                $request->merge(['channel_id' => $targetChannelIds[0]]);
            }
        }

        $channel = Channel::find($request->input('channel_id'));
        $authResponse = Gate::inspect('create', [Announcement::class, $channel]);
        if ($authResponse->denied()) {
            return response()->json([
                'status' => 403,
                'message' => $authResponse->message(),
            ], 403);
        }

        $validated = $request->validate([
            'channel_id' => ['required', 'integer', 'exists:channels,id'],
            'title' => ['required', 'string', 'max:255'],
            'content' => ['required', 'string'],
            'tags' => ['nullable'],
            'is_urgent' => ['nullable'],
            'trigger_sms_fallback' => ['nullable'],
            'status' => ['nullable', 'in:published,draft,archived'],
            'attachment' => ['nullable', 'file', 'max:10240'],
            'attachment_name' => ['nullable', 'string'],
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

        $attachmentUrl = null;
        $attachmentName = $validated['attachment_name'] ?? null;
        $attachmentType = $validated['attachment_type'] ?? null;

        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $path = $file->store('memos', 'public');
            $attachmentUrl = Storage::url($path);
            $attachmentName = $file->getClientOriginalName();
            $attachmentType = str_starts_with((string) $file->getMimeType(), 'image/') ? 'image' : 'document';
        } elseif ($attachmentName) {
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

        $resourcePayload = (new AnnouncementResource($firstAnnouncement->load(['publisher.academicProfile', 'channel', 'reads'])))->resolve($request);

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
     * AnnouncementObserver automatically logs audit trail and sets is_edited = true.
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
            'content' => ['required', 'string'],
            'tags' => ['nullable', 'array'],
            'is_urgent' => ['nullable', 'boolean'],
            'trigger_sms_fallback' => ['nullable', 'boolean'],
            'status' => ['nullable', 'in:published,draft,archived'],
        ]);

        $announcement->update([
            'title' => trim($validated['title']),
            'content' => trim($validated['content']),
            'tags' => $validated['tags'] ?? $announcement->tags,
            'is_urgent' => $validated['is_urgent'] ?? $announcement->is_urgent,
            'is_pinned' => $validated['is_urgent'] ?? $announcement->is_pinned,
            'trigger_sms_fallback' => $validated['trigger_sms_fallback'] ?? $announcement->trigger_sms_fallback,
            'status' => $validated['status'] ?? $announcement->status,
            'is_edited' => true,
        ]);

        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);
        ApiCache::forgetChannels((int) $announcement->channel_id);

        $freshAnnouncement = $announcement->fresh(['publisher.academicProfile', 'channel', 'reads']);
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

        AnnouncementRead::firstOrCreate([
            'announcement_id' => $announcement->id,
            'user_id' => $user->id,
        ], [
            'acknowledged_at' => now(),
        ]);

        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);

        $freshAnnouncement = $announcement->fresh(['publisher.academicProfile', 'channel', 'reads']);
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
