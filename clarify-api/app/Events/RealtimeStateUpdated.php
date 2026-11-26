<?php

namespace App\Events;

use App\Support\AvatarStorage;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class RealtimeStateUpdated implements ShouldBroadcast, ShouldQueue, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * Guard ceiling safely below Reverb's 10,000-byte max_message_size (config/reverb.php:71),
     * leaving headroom for Pusher protocol envelope metadata.
     */
    public const MAX_BROADCAST_BYTES = 8192;

    public string $broadcastQueue = 'broadcasts';

    public string $type;
    public ?int $channelId;
    public ?int $actorId;
    public ?int $targetUserId;
    public ?string $action;
    public ?int $messageId;
    public ?int $announcementId;
    public ?array $announcement;
    public ?array $message;
    public ?array $thread;
    public string $timestamp;

    /**
     * Create a new real-time Reverb broadcast event instance.
     */
    public function __construct(
        string $type,
        ?int $channelId = null,
        ?int $actorId = null,
        ?array $announcement = null,
        ?array $message = null,
        ?array $thread = null,
        ?int $targetUserId = null,
        ?string $action = null,
        ?int $messageId = null,
        ?int $announcementId = null
    ) {
        $this->type = $type;
        $this->channelId = $channelId;
        $this->actorId = $actorId;
        $this->announcement = $announcement;
        $this->message = $message;
        $this->thread = $thread;
        $this->targetUserId = $targetUserId;
        $this->action = $action;
        $this->messageId = $messageId;
        $this->announcementId = $announcementId ?? (isset($announcement['id']) ? (int) $announcement['id'] : null);
        $this->timestamp = now()->toIso8601String();
    }

    /**
     * Safely dispatch the Reverb event without failing the HTTP request if the Reverb daemon is not running.
     */
    public static function safeDispatch(
        string $type,
        ?int $channelId = null,
        ?int $actorId = null,
        ?array $announcement = null,
        ?array $message = null,
        ?array $thread = null,
        ?int $targetUserId = null,
        ?string $action = null,
        ?int $messageId = null,
        ?int $announcementId = null
    ): void {
        try {
            event(new self(
                $type,
                $channelId,
                $actorId,
                $announcement,
                $message,
                $thread,
                $targetUserId,
                $action,
                $messageId,
                $announcementId
            ));
        } catch (\Throwable $e) {
            Log::warning('RealtimeStateUpdated broadcast dispatch failed: ' . $e->getMessage(), [
                'type' => $type,
                'channel_id' => $channelId,
                'actor_id' => $actorId,
                'target_user_id' => $targetUserId,
                'action' => $action,
                'message_id' => $messageId,
                'announcement_id' => $announcementId,
            ]);
        }
    }

    /**
     * Dispatch a lightweight membership.changed event (IDs only, no names or content).
     */
    public static function dispatchMembershipChanged(
        int $channelId,
        int $targetUserId,
        string $action,
        int $actorId
    ): void {
        self::safeDispatch(
            'membership.changed',
            $channelId,
            $actorId,
            null,
            null,
            null,
            $targetUserId,
            $action
        );
    }

    /**
     * Get the private channels the event should broadcast on.
     * Chat messages and scoped threads broadcast strictly on PrivateChannel('clarify.channel.{id}').
     * Membership changes broadcast on PrivateChannel('clarify.channel.{channel_id}') and PrivateChannel('clarify.user.{target_user_id}').
     * Global notices broadcast minimal metadata on PrivateChannel('clarify.global').
     *
     * @return array<int, \Illuminate\Broadcasting\PrivateChannel>
     */
    public function broadcastOn(): array
    {
        $channels = [];

        if ($this->channelId !== null) {
            $channels[] = new PrivateChannel("clarify.channel.{$this->channelId}");
        }

        if ($this->targetUserId !== null) {
            $channels[] = new PrivateChannel("clarify.user.{$this->targetUserId}");
        }

        // Only broadcast global notices (never chat, threads, membership changes, or high-frequency acknowledgments) on clarify.global
        if (
            ! str_starts_with($this->type, 'chat.') &&
            ! str_starts_with($this->type, 'thread.') &&
            $this->type !== 'membership.changed' &&
            $this->type !== 'announcement.acknowledged'
        ) {
            $channels[] = new PrivateChannel('clarify.global');
        }

        if ($this->actorId !== null && $this->type === 'admin.updated' && $this->targetUserId === null) {
            $channels[] = new PrivateChannel("clarify.user.{$this->actorId}");
        }

        return $channels;
    }

    /**
     * The event's broadcast name for Laravel Echo listeners (.realtime.updated).
     */
    public function broadcastAs(): string
    {
        return 'realtime.updated';
    }

    /**
     * Get the data to broadcast over Laravel Reverb.
     * Enforces data: URI stripping and a ~8 KB ceiling so Reverb never rejects payloads.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        if ($this->type === 'membership.changed') {
            return [
                'type' => 'membership.changed',
                'channel_id' => $this->channelId,
                'target_user_id' => $this->targetUserId,
                'action' => $this->action,
                'actor_id' => $this->actorId,
                'timestamp' => $this->timestamp,
            ];
        }

        if ($this->type === 'chat.message_unsent') {
            return [
                'type' => 'chat.message_unsent',
                'channel_id' => $this->channelId,
                'message_id' => $this->messageId,
                'actor_id' => $this->actorId,
                'timestamp' => $this->timestamp,
            ];
        }

        if ($this->type === 'announcement.deleted') {
            $resolvedAnnId = $this->announcementId ?? (isset($this->announcement['id']) ? (int) $this->announcement['id'] : null);

            return [
                'type' => 'announcement.deleted',
                'channel_id' => $this->channelId,
                'announcement_id' => $resolvedAnnId,
                'actor_id' => $this->actorId,
                'announcement' => $resolvedAnnId !== null
                    ? [
                        'id' => $resolvedAnnId,
                        'channel_id' => $this->channelId,
                    ]
                    : null,
                'timestamp' => $this->timestamp,
            ];
        }

        // Strip announcement body content on global notices unless on a scoped channel
        $safeAnnouncement = null;
        if ($this->announcement !== null) {
            $safeAnnouncement = [
                'id' => $this->announcement['id'] ?? $this->announcementId,
                'channel_id' => $this->announcement['channel_id'] ?? $this->channelId,
                'channel_type' => $this->announcement['channel_type'] ?? null,
                'is_urgent' => $this->announcement['is_urgent'] ?? false,
                'status' => $this->announcement['status'] ?? 'published',
                'read_reach' => $this->announcement['read_reach'] ?? null,
                'publisher' => isset($this->announcement['publisher'])
                    ? ['id' => $this->announcement['publisher']['id'] ?? null]
                    : null,
            ];
        }

        $safeMessage = $this->channelId !== null
            ? AvatarStorage::sanitizeArrayPayload($this->message)
            : null;
        $safeThread = $this->channelId !== null
            ? AvatarStorage::sanitizeArrayPayload($this->thread)
            : null;

        $resolvedAnnouncementId = $this->announcementId
            ?? (isset($safeAnnouncement['id']) ? (int) $safeAnnouncement['id'] : null);

        $payload = [
            'type' => $this->type,
            'channel_id' => $this->channelId,
            'announcement_id' => $resolvedAnnouncementId,
            'target_user_id' => $this->targetUserId,
            'action' => $this->action,
            'actor_id' => $this->actorId,
            'message_id' => $this->messageId,
            'announcement' => $safeAnnouncement,
            'message' => $safeMessage,
            'thread' => $safeThread,
            'timestamp' => $this->timestamp,
        ];

        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $byteLength = $encoded !== false ? strlen($encoded) : PHP_INT_MAX;

        if ($byteLength > self::MAX_BROADCAST_BYTES) {
            Log::warning('RealtimeStateUpdated payload exceeded max broadcast size; falling back to minimal IDs-only event.', [
                'type' => $this->type,
                'channel_id' => $this->channelId,
                'actor_id' => $this->actorId,
                'announcement_id' => $resolvedAnnouncementId,
                'message_id' => $this->messageId ?? ($safeMessage['id'] ?? ($safeThread['id'] ?? null)),
                'byte_length' => $byteLength,
                'max_bytes' => self::MAX_BROADCAST_BYTES,
            ]);

            return $this->buildMinimalFallbackPayload($resolvedAnnouncementId, $safeMessage, $safeThread);
        }

        return $payload;
    }

    /**
     * Minimal IDs-only fallback payload guaranteed to stay well under Reverb's 10 KB limit.
     *
     * @param array<string, mixed>|null $safeMessage
     * @param array<string, mixed>|null $safeThread
     * @return array<string, mixed>
     */
    private function buildMinimalFallbackPayload(?int $announcementId, ?array $safeMessage, ?array $safeThread): array
    {
        $resolvedMessageId = $this->messageId
            ?? (isset($safeMessage['id']) ? (int) $safeMessage['id'] : null)
            ?? (isset($safeThread['id']) ? (int) $safeThread['id'] : null);

        return [
            'type' => $this->type,
            'channel_id' => $this->channelId,
            'announcement_id' => $announcementId,
            'target_user_id' => $this->targetUserId,
            'action' => $this->action,
            'actor_id' => $this->actorId,
            'message_id' => $resolvedMessageId,
            'announcement' => $announcementId !== null
                ? ['id' => $announcementId, 'channel_id' => $this->channelId]
                : null,
            'message' => null,
            'thread' => null,
            'timestamp' => $this->timestamp,
        ];
    }
}

