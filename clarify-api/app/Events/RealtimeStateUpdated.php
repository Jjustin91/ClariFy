<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RealtimeStateUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $type;
    public ?int $channelId;
    public ?int $actorId;
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
        ?array $thread = null
    ) {
        $this->type = $type;
        $this->channelId = $channelId;
        $this->actorId = $actorId;
        $this->announcement = $announcement;
        $this->message = $message;
        $this->thread = $thread;
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
        ?array $thread = null
    ): void {
        try {
            event(new self($type, $channelId, $actorId, $announcement, $message, $thread));
        } catch (\Throwable $e) {
            // Gracefully ignore if php artisan reverb:start is not currently running
        }
    }

    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\Channel>
     */
    public function broadcastOn(): array
    {
        $channels = [
            new Channel('clarify.global'),
        ];

        if ($this->channelId !== null) {
            $channels[] = new Channel("clarify.channel.{$this->channelId}");
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
        return [
            'type' => $this->type,
            'channel_id' => $this->channelId,
            'actor_id' => $this->actorId,
            'announcement' => $this->announcement,
            'message' => $this->message,
            'thread' => $this->thread,
            'timestamp' => $this->timestamp,
        ];
    }
}
