<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Models\Channel;
use App\Models\Message;
use App\Policies\ChannelPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChannelChatController
{
    /**
     * GET /api/v1/channels/{channelId}/chat & /api/v1/channels/{channelId}/messages
     * Cursor-paginated (latest 50 by default, max 100, cursor `before` = message id).
     */
    public function index(Request $request, int $channelId): JsonResponse
    {
        $channel = Channel::findOrFail($channelId);
        $user = $request->user();

        if (! $user || ! ChannelPolicy::hasApprovedChannelAccess($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => "Access Denied: You are not an approved member of {$channel->name} (FR-01_REV).",
            ], 403);
        }

        $limit = min(100, max(1, (int) $request->query('limit', 50)));
        $beforeId = $request->query('before') !== null ? (int) $request->query('before') : null;

        $query = Message::with(['sender:id,name,role,avatar_url'])
            ->select(['id', 'channel_id', 'sender_id', 'content', 'created_at'])
            ->where('channel_id', $channel->id)
            ->whereNull('parent_id')
            ->where('subject_hashtag', '__CHAT__');

        if ($beforeId !== null && $beforeId > 0) {
            $query->where('id', '<', $beforeId);
        }

        // Fetch limit + 1 rows in descending ID order to determine has_more with a single index scan
        $rows = $query->orderByDesc('id')
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        if ($hasMore) {
            $rows = $rows->slice(0, $limit);
        }

        // Return in chronological (ascending ID) order so existing clients render oldest -> newest
        $chronological = $rows->reverse()->values();
        $nextBefore = $hasMore && $chronological->isNotEmpty()
            ? (int) $chronological->first()->id
            : null;

        $messages = $chronological->map(function (Message $msg) {
            return [
                'id' => $msg->id,
                'channel_id' => $msg->channel_id,
                'content' => $msg->content,
                'created_at' => $msg->created_at?->toIso8601String(),
                'author' => [
                    'id' => $msg->sender?->id ?? $msg->sender_id,
                    'name' => $msg->sender?->name ?? 'USTP User',
                    'role' => $msg->sender?->role ?? 'student',
                    'avatar_url' => $msg->sender?->avatar_url,
                ],
            ];
        });

        return response()->json([
            'data' => $messages,
            'meta' => [
                'has_more' => $hasMore,
                'next_before' => $nextBefore,
            ],
        ]);
    }

    /**
     * POST /api/v1/channels/{channelId}/messages & /api/v1/channels/{channelId}/chat
     */
    public function store(Request $request, int $channelId): JsonResponse
    {
        $channel = Channel::findOrFail($channelId);
        $user = $request->user();

        if (! $user || ! ChannelPolicy::hasApprovedChannelAccess($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => "Access Denied: You are not an approved member of {$channel->name} (FR-01_REV).",
            ], 403);
        }

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:2000'],
            'temp_id' => ['nullable', 'string', 'max:100'],
        ], [
            'content.required' => 'Please type a message before sending.',
            'content.max' => 'Chat messages cannot exceed 2,000 characters.',
        ]);

        $msg = Message::create([
            'channel_id' => $channel->id,
            'sender_id' => $user->id,
            'parent_id' => null,
            'subject_hashtag' => '__CHAT__',
            'content' => trim($validated['content']),
            'is_private' => false,
            'is_resolved' => false,
            'is_pinned_faq' => false,
        ]);

        $chatPayload = [
            'id' => $msg->id,
            'temp_id' => $validated['temp_id'] ?? null,
            'channel_id' => $msg->channel_id,
            'sender_id' => $user->id,
            'content' => $msg->content,
            'created_at' => $msg->created_at?->toIso8601String(),
            'status' => 'sent',
            'author' => [
                'id' => $user->id,
                'name' => $user->name,
                'role' => $user->role,
                'avatar_url' => $user->avatar_url,
            ],
        ];

        RealtimeStateUpdated::safeDispatch(
            'chat.message',
            (int) $channel->id,
            (int) $user->id,
            null,
            $chatPayload
        );

        return response()->json([
            'message' => 'Message sent to Course Hub chat.',
            'data' => $chatPayload,
        ], 201);
    }
}

