<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class SyncPrismsRoster extends Command
{
    protected $signature = 'prisms:sync {semester_code?}';
    protected $description = 'Automated 24h midnight PRISMS sync (FR-01_REV)';

    public function handle(): void
    {
        // TODO: Implement FR-01_REV PRISMS sync logic
    }
}
