<?php

namespace App\Jobs;

use App\Models\Announcement;
use App\Services\Sms\SmsManager;
use App\Support\PhoneNormalizer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class TriggerSmsFallbackBatch implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;
    public array $backoff = [2, 5, 15];

    public function __construct(public Announcement $announcement)
    {
        $this->onQueue('sms-fallback');
        $this->afterCommit();
    }

    /**
     * Formats an announcement into a concise <= 160-character urgent SMS body without private content.
     */
    public static function formatSmsMessage(Announcement $announcement): string
    {
        $title = preg_replace('/\s+/u', ' ', trim((string) $announcement->title)) ?? '';
        $rawContent = (string) $announcement->content;

        // Strip any legacy embedded media prefix line if present
        if (str_starts_with($rawContent, '__CLARIFY_ANN_MEDIA__')) {
            $newlinePos = strpos($rawContent, "\n");
            $rawContent = $newlinePos !== false ? substr($rawContent, $newlinePos + 1) : '';
        }

        $body = preg_replace('/\s+/u', ' ', trim($rawContent)) ?? '';
        $combined = $body !== ''
            ? "[USTP ClariFy URGENT] {$title} - {$body}"
            : "[USTP ClariFy URGENT] {$title}";

        if (mb_strlen($combined) <= 160) {
            return $combined;
        }

        return mb_substr($combined, 0, 157) . '...';
    }

    /**
     * Broadcasts low-bandwidth SMS alerts in chunks of 100 using decrypted RA 10173 contact_number (NFR-02, NFR-05).
     * Never logs phone numbers or API keys.
     */
    public function handle(): void
    {
        $channel = $this->announcement->relationLoaded('channel')
            ? $this->announcement->channel
            : $this->announcement->channel()->first();

        if (! $channel) {
            return;
        }

        $smsProvider = SmsManager::resolve();
        $publisherId = (int) ($this->announcement->publisher_id ?? 0);
        $message = self::formatSmsMessage($this->announcement);

        $normalizedRecipients = [];
        $seenNumbers = [];
        $skipped = 0;

        $query = $channel
            ->members()
            ->wherePivot('approval_status', 'approved')
            ->where('users.verification_status', 'approved');

        if ($publisherId > 0) {
            $query->where('users.id', '!=', $publisherId);
        }

        $query
            ->select(['users.id', 'users.contact_number'])
            ->chunkById(100, function ($recipients) use (&$normalizedRecipients, &$seenNumbers, &$skipped): void {
                foreach ($recipients as $recipient) {
                    $normalized = PhoneNormalizer::normalize($recipient->contact_number);
                    if ($normalized === null) {
                        $skipped++;
                        continue;
                    }

                    if (isset($seenNumbers[$normalized])) {
                        $skipped++;
                        continue;
                    }

                    $seenNumbers[$normalized] = true;
                    $normalizedRecipients[] = $normalized;
                }
            }, 'users.id', 'id');

        $sent = 0;
        $failed = 0;
        $lastException = null;

        foreach (array_chunk($normalizedRecipients, 100) as $chunk) {
            try {
                $result = $smsProvider->sendBatch($chunk, $message);
                $sent += (int) ($result['sent'] ?? count($chunk));
                $failed += (int) ($result['failed'] ?? 0);
            } catch (Throwable $e) {
                $failed += count($chunk);
                $lastException = $e;
                Log::warning('SMS Fallback chunk dispatch failed.', [
                    'announcement_id' => $this->announcement->id,
                    'chunk_size' => count($chunk),
                    'driver' => config('services.sms.driver', 'log'),
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info('SMS Fallback Batch (NFR-02) completed.', [
            'announcement_id' => $this->announcement->id,
            'driver' => config('services.sms.driver', 'log'),
            'sent' => $sent,
            'failed' => $failed,
            'skipped' => $skipped,
        ]);

        // Rethrow only when nothing was delivered ($sent === 0) so partial failures
        // are not retried by the queue worker and never resend duplicate SMS to successful chunks.
        if ($lastException !== null && $sent === 0) {
            throw $lastException;
        }
    }
}
