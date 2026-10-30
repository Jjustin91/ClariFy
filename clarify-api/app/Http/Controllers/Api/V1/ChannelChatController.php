<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\Channel;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChannelChatController
{
    /**
     * GET /api/v1/channels/{channelId}/chat
     */
    public function index(Request $request, int $channelId): JsonResponse
    {
        $messages = Message::with('sender')
            ->where('channel_id', $channelId)
            ->whereNull('parent_id')
            ->where('subject_hashtag', '__CHAT__')
            ->oldest('created_at')
            ->get()
            ->map(function (Message $msg) {
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
        ]);
    }

    /**
     * POST /api/v1/channels/{channelId}/chat
     */
    public function store(Request $request, int $channelId): JsonResponse
    {
        $validated = $request->validate([
            'content' => ['required', 'string'],
        ], [
            'content.required' => 'Please type a message before sending.',
        ]);

        $channel = Channel::find($channelId) ?? Channel::first();
        $resolvedChannelId = $channel ? $channel->id : $channelId;
        $user = $request->user();

        $msg = Message::create([
            'channel_id' => $resolvedChannelId,
            'sender_id' => $user->id,
            'parent_id' => null,
            'subject_hashtag' => '__CHAT__',
            'content' => trim($validated['content']),
            'is_private' => false,
            'is_resolved' => false,
            'is_pinned_faq' => false,
        ]);

        $msg->load('sender');

        return response()->json([
            'message' => 'Message sent to Course Hub chat.',
            'data' => [
                'id' => $msg->id,
                'channel_id' => $msg->channel_id,
                'content' => $msg->content,
                'created_at' => $msg->created_at?->toIso8601String(),
                'author' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'role' => $user->role,
                    'avatar_url' => $user->avatar_url,
                ],
            ],
        ], 201);
    }
}
