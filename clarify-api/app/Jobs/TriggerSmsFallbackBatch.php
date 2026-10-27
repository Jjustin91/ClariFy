<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class TriggerSmsFallbackBatch implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function handle(): void
    {
        // TODO: Implement NFR-02 queue worker logic
    }
}
