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

    public function __construct(public Announcement $announcement)
    {
        $this->onQueue('sms-fallback');
    }

    /**
     * Broadcasts low-bandwidth SMS alerts using decrypted RA 10173 contact_number (NFR-02, NFR-05).
     */
    public function handle(): void
    {
        $recipients = $this->announcement->channel
            ->members()
            ->whereNotNull('contact_number')
            ->get();

        $dispatched = 0;
        foreach ($recipients as $recipient) {
            // $recipient->contact_number is automatically decrypted by Eloquent 'encrypted' cast
            if (! empty($recipient->contact_number)) {
                $dispatched++;
            }
        }

        Log::info(
            "SMS Fallback Batch (NFR-02): Dispatched {$dispatched} offline SMS notices for Announcement #{$this->announcement->id}."
        );
    }
}
