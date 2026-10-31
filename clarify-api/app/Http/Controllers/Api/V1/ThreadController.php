<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\ThreadResource;
use App\Models\Channel;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ThreadController
{
    /**
     * GET /api/v1/channels/{id}/threads (Workflow 4, FR-03_REV)
     */
    public function index(Request $request, int $channelId): JsonResponse
    {
        $user = $request->user();
        $channel = Channel::find($channelId) ?? Channel::first();
        $resolvedChannelId = $channel ? $channel->id : $channelId;

        $query = Message::with(['sender', 'replies.sender'])
            ->rootThreads()
            ->where('channel_id', $resolvedChannelId)
            ->latest('created_at');

        if ($status = $request->query('status')) {
            if ($status === 'resolved') {
                $query->where('is_resolved', true);
            } elseif ($status === 'open') {
                $query->where('is_resolved', false);
            }
        }

        // Enforce Private Inquiry visibility (Stakeholder Table E)
        if ($user && $user->role === 'student') {
            $query->where(function ($q) use ($user) {
                $q->where('is_private', false)
                    ->orWhere('sender_id', $user->id);
            });
        }

        $threads = $query->get();

        return response()->json([
            'data' => ThreadResource::collection($threads),
        ]);
    }

    /**
     * POST /api/v1/channels/{id}/threads (Student Inquiry Submission — FR-03_REV)
     */
    public function store(Request $request, int $channelId): JsonResponse
    {
        $validated = $request->validate([
            'announcement_id' => ['nullable', 'integer', 'exists:announcements,id'],
            'subject_hashtag' => ['required', 'string', 'max:120'],
            'content' => ['required', 'string'],
            'is_private' => ['nullable', 'boolean'],
        ], [
            'subject_hashtag.required' => 'Please enter a subject hashtag (e.g., #Defence).',
            'content.required' => 'Please enter your inquiry or clarification details.',
        ]);

        $channel = Channel::find($channelId) ?? Channel::first();
        $resolvedChannelId = $channel ? $channel->id : $channelId;

        $rawTag = ltrim(trim($validated['subject_hashtag']), '#');
        $formattedHashtag = '#' . $rawTag;

        $thread = Message::create([
            'channel_id' => $resolvedChannelId,
            'announcement_id' => $validated['announcement_id'] ?? null,
            'sender_id' => $request->user()->id,
            'parent_id' => null,
            'subject_hashtag' => $formattedHashtag,
            'content' => trim($validated['content']),
            'is_private' => (bool) ($validated['is_private'] ?? false),
            'is_resolved' => false,
            'is_pinned_faq' => false,
        ]);

        return response()->json([
            'message' => 'Academic inquiry ticket submitted to Course Hub.',
            'data' => new ThreadResource($thread->load(['sender', 'replies.sender'])),
        ], 201);
    }

    /**
     * PATCH /api/v1/threads/{id} (Student edits own unresolved inquiry — Workflow 3 Activity Diagram)
     */
    public function update(Request $request, int $threadId): JsonResponse
    {
        $thread = Message::rootThreads()->findOrFail($threadId);
        $user = $request->user();

        if ($thread->sender_id !== $user->id && ! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'You can only edit your own inquiry.',
            ], 403);
        }

        if ($thread->is_resolved) {
            return response()->json([
                'status' => 403,
                'message' => 'Resolved inquiries can no longer be edited.',
            ], 403);
        }

        $validated = $request->validate([
            'subject_hashtag' => ['sometimes', 'string', 'max:120'],
            'content' => ['required', 'string'],
        ]);

        if (! empty($validated['subject_hashtag'])) {
            $thread->subject_hashtag = '#' . ltrim(trim($validated['subject_hashtag']), '#');
        }
        $thread->content = trim($validated['content']);
        $thread->save();

        return response()->json([
            'message' => 'Inquiry updated.',
            'data' => new ThreadResource($thread->load(['sender', 'replies.sender'])),
        ]);
    }

    /**
     * DELETE /api/v1/threads/{id}
     */
    public function destroy(Request $request, int $threadId): JsonResponse
    {
        $thread = Message::rootThreads()->findOrFail($threadId);
        $user = $request->user();

        if ($thread->sender_id !== $user->id && ! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'You are not authorized to delete this inquiry.',
            ], 403);
        }

        $thread->delete();

        return response()->json([
            'message' => 'Inquiry ticket deleted.',
        ]);
    }

    /**
     * POST /api/v1/threads/{id}/replies (Faculty Answer Ticket — TC-FR03, FR-07)
     */
    public function reply(Request $request, int $threadId): JsonResponse
    {
        $user = $request->user();
        if (! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only instructors can answer and resolve tickets.',
            ], 403);
        }

        $validated = $request->validate([
            'content' => ['required', 'string'],
            'mark_resolved' => ['nullable', 'boolean'],
            'pin_to_faq' => ['nullable', 'boolean'],
        ], [
            'content.required' => 'Please enter a faculty response before submitting.',
        ]);

        $thread = Message::rootThreads()->findOrFail($threadId);

        Message::create([
            'channel_id' => $thread->channel_id,
            'announcement_id' => $thread->announcement_id,
            'sender_id' => $user->id,
            'parent_id' => $thread->id,
            'content' => trim($validated['content']),
        ]);

        $pinToFaq = (bool) ($validated['pin_to_faq'] ?? false);
        $markResolved = (bool) ($validated['mark_resolved'] ?? true) || $pinToFaq;

        $thread->is_resolved = $markResolved || $thread->is_resolved;
        $thread->is_pinned_faq = $pinToFaq || $thread->is_pinned_faq;
        if ($thread->is_pinned_faq) {
            $thread->is_private = false;
        }
        $thread->save();

        return response()->json([
            'message' => $pinToFaq
                ? 'Reply posted, ticket resolved, and converted to anonymized Class FAQ (FR-07).'
                : 'Faculty reply posted.',
            'data' => new ThreadResource($thread->fresh(['sender', 'replies.sender'])),
        ]);
    }

    /**
     * POST /api/v1/threads/{id}/convert-faq (1-Click FAQ Compilation — FR-07, NFR-05)
     */
    public function convertToFaq(Request $request, int $threadId): JsonResponse
    {
        $user = $request->user();
        if (! $user->canPublishOrManage()) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: Only instructors can publish Class FAQs (FR-07).',
            ], 403);
        }

        $thread = Message::rootThreads()->findOrFail($threadId);
        $thread->is_resolved = true;
        $thread->is_pinned_faq = true;
        $thread->is_private = false;
        $thread->save();

        return response()->json([
            'message' => 'Pinned to Class FAQs with student identity masked as "Anonymous Student" (RA 10173).',
            'data' => new ThreadResource($thread->fresh(['sender', 'replies.sender'])),
        ]);
    }
}
