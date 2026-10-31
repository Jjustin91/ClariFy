<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\AnnouncementResource;
use App\Jobs\DispatchUrgentPushAlerts;
use App\Jobs\TriggerSmsFallbackBatch;
use App\Models\Announcement;
use App\Models\AnnouncementRead;
use App\Models\Channel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

class AnnouncementController
{
    /**
     * GET /api/v1/announcements (Workflow 3, FR-04_REV, FR-05)
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Announcement::with(['publisher.academicProfile', 'channel', 'reads'])
            ->withCount('reads');
        $likeOp = \Illuminate\Support\Facades\DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

        if (! $user || ! $user->canPublishOrManage()) {
            $query->where('status', 'published');
        }

        if ($channelId = $request->query('channel_id')) {
            $resolvedChannel = Channel::find((int) $channelId) ?? Channel::first();
            if ($resolvedChannel) {
                $query->where('channel_id', $resolvedChannel->id);
            }
        }

        if ($tag = $request->query('tag')) {
            if (strtoupper($tag) !== 'ALL') {
                $query->whereJsonContains('tags', $tag);
            }
        }

        if ($department = $request->query('department')) {
            if (strtoupper($department) !== 'ALL') {
                $query->where(function ($q) use ($department) {
                    $q->whereJsonContains('tags', $department)
                        ->orWhereHas('publisher.academicProfile', function ($pq) use ($department) {
                            $pq->where('department', $department);
                        });
                });
            }
        }

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search, $likeOp) {
                $q->where('title', $likeOp, "%{$search}%")
                    ->orWhere('content', $likeOp, "%{$search}%")
                    ->orWhere('subtitle', $likeOp, "%{$search}%")
                    ->orWhereHas('channel', fn ($cq) => $cq->where('course_code', $likeOp, "%{$search}%"))
                    ->orWhereHas('publisher', fn ($pq) => $pq->where('name', $likeOp, "%{$search}%"));
            });
        }

        // Urgent notices first, then pinned notices, then sort preference (FR-04_REV)
        $sort = $request->query('sort', 'latest');
        $query->orderByDesc('is_urgent')->orderByDesc('is_pinned');

        if ($sort === 'oldest') {
            $query->orderBy('published_at');
        } elseif ($sort === 'read_reach') {
            $query->orderByDesc('reads_count')->orderByDesc('published_at');
        } else {
            $query->orderByDesc('published_at');
        }

        $perPage = (int) $request->query('per_page', 4);
        $paginator = $query->paginate($perPage);

        return response()->json([
            'data' => AnnouncementResource::collection($paginator->items()),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    /**
     * POST /api/v1/announcements & alias POST /api/announcements/create (Workflow 2, FR-02, NFR-02, TC-NFR01)
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $channel = Channel::find($request->input('channel_id', 7)) ?? Channel::first();
        if ($channel) {
            $request->merge(['channel_id' => $channel->id]);
        }

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

        $tags = ['OFFICIAL MEMO', 'CDO CAMPUS', 'CITC'];
        if (! empty($validated['tags'])) {
            if (is_array($validated['tags'])) {
                $tags = $validated['tags'];
            } elseif (is_string($validated['tags'])) {
                $decoded = json_decode($validated['tags'], true);
                $tags = is_array($decoded) ? $decoded : array_map('trim', explode(',', $validated['tags']));
            }
        }

        $isUrgent = filter_var($request->input('is_urgent', false), FILTER_VALIDATE_BOOLEAN);
        $triggerSms = filter_var($request->input('trigger_sms_fallback', false), FILTER_VALIDATE_BOOLEAN);

        if ($isUrgent && ! in_array('URGENT NOTICE', $tags, true)) {
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

        $announcement = Announcement::create([
            'channel_id' => (int) $validated['channel_id'],
            'publisher_id' => $user->id,
            'title' => trim($validated['title']),
            'subtitle' => 'USTP Digital Transformation',
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

        AnnouncementRead::firstOrCreate([
            'announcement_id' => $announcement->id,
            'user_id' => $user->id,
        ], [
            'acknowledged_at' => now(),
        ]);

        if ($isUrgent) {
            DispatchUrgentPushAlerts::dispatch($announcement);
        }

        if ($triggerSms) {
            TriggerSmsFallbackBatch::dispatch($announcement);
        }

        return response()->json([
            'message' => $isUrgent
                ? 'Urgent Announcement published! Push alerts queued (<= 2.0s) and pinned to top.'
                : 'Announcement published to Course Hub.',
            'data' => new AnnouncementResource($announcement->load(['publisher.academicProfile', 'channel', 'reads'])),
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

        return response()->json([
            'message' => 'Announcement updated and audit trail logged (NFR-03_REV).',
            'data' => new AnnouncementResource($announcement->fresh(['publisher.academicProfile', 'channel', 'reads'])),
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

        $announcement->update(['status' => 'archived']);
        $announcement->delete();

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

        return response()->json([
            'message' => 'Announcement marked as read and acknowledged.',
            'data' => new AnnouncementResource($announcement->fresh(['publisher.academicProfile', 'channel', 'reads'])),
        ]);
    }
}
