<?php

namespace App\Events;

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

    public string $broadcastQueue = 'broadcasts';

    public string $type;
    public ?int $channelId;
    public ?int $actorId;
    public ?int $targetUserId;
    public ?string $action;
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
        ?string $action = null
    ) {
        $this->type = $type;
        $this->channelId = $channelId;
        $this->actorId = $actorId;
        $this->announcement = $announcement;
        $this->message = $message;
        $this->thread = $thread;
        $this->targetUserId = $targetUserId;
        $this->action = $action;
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
        ?string $action = null
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
                $action
            ));
        } catch (\Throwable $e) {
            Log::warning('RealtimeStateUpdated broadcast dispatch failed: ' . $e->getMessage(), [
                'type' => $type,
                'channel_id' => $channelId,
                'actor_id' => $actorId,
                'target_user_id' => $targetUserId,
                'action' => $action,
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

        // Only broadcast global notices (not private channel chat messages, threads, or user-scoped membership events) on clarify.global
        if (
            ! str_starts_with($this->type, 'chat.') &&
            ! str_starts_with($this->type, 'thread.') &&
            $this->type !== 'membership.changed'
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

        // Strip announcement body content on global notices unless on a scoped channel
        $safeAnnouncement = null;
        if ($this->announcement !== null) {
            $safeAnnouncement = [
                'id' => $this->announcement['id'] ?? null,
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

        return [
            'type' => $this->type,
            'channel_id' => $this->channelId,
            'target_user_id' => $this->targetUserId,
            'action' => $this->action,
            'actor_id' => $this->actorId,
            'announcement' => $safeAnnouncement,
            'message' => $this->channelId !== null ? $this->message : null,
            'thread' => $this->channelId !== null ? $this->thread : null,
            'timestamp' => $this->timestamp,
        ];
    }
}

