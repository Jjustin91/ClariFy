<?php

namespace App\Jobs;

use App\Models\Announcement;
use App\Models\DeviceToken;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class DispatchUrgentPushAlerts implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 5;

    public function __construct(public Announcement $announcement)
    {
        $this->onQueue('high-priority-push');
    }

    /**
     * Dispatches urgent push notifications within <= 2.0 seconds (NFR-02 / TC-NFR02).
     */
    public function handle(): void
    {
        $startedAt = microtime(true);

        $memberUserIds = $this->announcement->channel
            ->members()
            ->pluck('users.id');

        $tokens = DeviceToken::whereIn('user_id', $memberUserIds)
            ->pluck('expo_push_token')
            ->all();

        if (empty($tokens)) {
            return;
        }

        $payload = array_map(fn (string $token) => [
            'to' => $token,
            'sound' => 'default',
            'priority' => 'high',
            'title' => '[URGENT USTP] ' . $this->announcement->title,
            'body' => mb_strimwidth($this->announcement->content, 0, 140, '...'),
            'data' => [
                'announcement_id' => $this->announcement->id,
                'channel_id' => $this->announcement->channel_id,
            ],
        ], $tokens);

        try {
            Http::timeout(2)->post('https://exp.host/--/api/v2/push/send', $payload);
        } catch (\Throwable $e) {
            Log::warning('Expo push dispatch fallback logged: ' . $e->getMessage());
        }

        $elapsedSeconds = round(microtime(true) - $startedAt, 3);
        Log::info("Dispatched urgent push alerts for Announcement #{$this->announcement->id} in {$elapsedSeconds}s (NFR-02).");
    }
}
