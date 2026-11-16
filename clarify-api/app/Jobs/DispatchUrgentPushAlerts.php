<?php

namespace App\Jobs;

use App\Models\Announcement;
use App\Models\DeviceToken;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class DispatchUrgentPushAlerts implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 15;
    public array $backoff = [2, 5, 15];
    public bool $afterCommit = true;

    public function __construct(public Announcement $announcement)
    {
        $this->onQueue('high-priority-push');
    }

    /**
     * Dispatches urgent push notifications in chunks of 100 tokens (NFR-02 / TC-NFR02).
     */
    public function handle(): void
    {
        $startedAt = microtime(true);
        $publisherId = (int) ($this->announcement->publisher_id ?? 0);

        $memberQuery = DB::table('channel_user')
            ->join('users', 'users.id', '=', 'channel_user.user_id')
            ->where('channel_user.channel_id', $this->announcement->channel_id)
            ->where('channel_user.approval_status', 'approved')
            ->where('users.verification_status', 'approved');

        if ($publisherId > 0) {
            $memberQuery->where('channel_user.user_id', '!=', $publisherId);
        }

        $memberUserIds = $memberQuery
            ->pluck('channel_user.user_id')
            ->all();

        if (empty($memberUserIds)) {
            return;
        }

        $tokens = DeviceToken::whereIn('user_id', $memberUserIds)
            ->pluck('expo_push_token')
            ->filter(fn ($t) => is_string($t) && trim($t) !== '')
            ->unique()
            ->values()
            ->all();

        if (empty($tokens)) {
            return;
        }

        $endpoint = (string) config('services.expo.push_url', 'https://exp.host/--/api/v2/push/send');
        $accessToken = trim((string) config('services.expo.access_token', ''));

        foreach (array_chunk($tokens, 100) as $tokenBatch) {
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
            ], $tokenBatch);

            try {
                $request = Http::timeout(5)->acceptJson();
                if ($accessToken !== '') {
                    $request = $request->withToken($accessToken);
                }
                $request->post($endpoint, $payload);
            } catch (\Throwable $e) {
                Log::warning('Expo push dispatch batch failed: ' . $e->getMessage());
            }
        }

        $elapsedSeconds = round(microtime(true) - $startedAt, 3);
        Log::info("Dispatched urgent push alerts for Announcement #{$this->announcement->id} in {$elapsedSeconds}s (NFR-02).");
    }
}
