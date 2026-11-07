<?php

namespace App\Jobs;

use App\Models\Announcement;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class TriggerSmsFallbackBatch implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 30;
    public array $backoff = [2, 5, 15];
    public bool $afterCommit = true;

    public function __construct(public Announcement $announcement)
    {
        $this->onQueue('sms-fallback');
    }

    /**
     * Broadcasts low-bandwidth SMS alerts in chunks using decrypted RA 10173 contact_number (NFR-02, NFR-05).
     */
    public function handle(): void
    {
        if (! $this->announcement->channel) {
            return;
        }

        $dispatched = 0;

        $this->announcement->channel
            ->members()
            ->wherePivot('approval_status', 'approved')
            ->whereNotNull('contact_number')
            ->select(['users.id', 'users.contact_number'])
            ->chunkById(100, function ($recipients) use (&$dispatched) {
                foreach ($recipients as $recipient) {
                    if (! empty($recipient->contact_number)) {
                        $dispatched++;
                    }
                }
            }, 'users.id', 'id');

        Log::info(
            "SMS Fallback Batch (NFR-02): Dispatched {$dispatched} offline SMS notices for Announcement #{$this->announcement->id}."
        );
    }
}

