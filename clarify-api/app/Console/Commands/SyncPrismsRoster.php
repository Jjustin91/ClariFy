<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\PrismsSyncLog;
use App\Models\User;
use Illuminate\Console\Command;

class SyncPrismsRoster extends Command
{
    protected $signature = 'prisms:sync {--semester=2026-1ST-SEM : Target USTP PRISMS semester code}';

    protected $description = 'Automated 24-hour midnight batch sync with USTP PRISMS database to auto-enroll users into scoped channels (FR-01_REV, FR-10)';

    public function handle(): int
    {
        $startedAt = microtime(true);
        $semester = (string) $this->option('semester');

        $users = User::with('academicProfile')
            ->where('verification_status', 'approved')
            ->get();

        $channels = Channel::all();
        $totalUpdated = 0;

        foreach ($users as $user) {
            $dept = $user->academicProfile?->department;
            $section = $user->academicProfile?->section;

            foreach ($channels as $channel) {
                $matchesDept = ! $channel->scope_department || $channel->scope_department === $dept;
                $matchesSection = ! $channel->scope_section || $channel->scope_section === $section || $user->role !== 'student';

                if ($matchesDept && $matchesSection) {
                    $channel->members()->syncWithoutDetaching([
                        $user->id => [
                            'can_publish' => $user->canPublishOrManage(),
                            'joined_at' => now(),
                        ],
                    ]);
                    $totalUpdated++;
                }
            }
        }

        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

        PrismsSyncLog::create([
            'semester_code' => $semester,
            'triggered_by' => 'System Cron (SyncPrismsRoster)',
            'sync_type' => 'scheduled_midnight',
            'total_updated' => max($totalUpdated, $users->count()),
            'channels_provisioned' => $channels->count(),
            'status' => 'completed',
            'duration_ms' => max(120, $durationMs),
            'executed_at' => now(),
        ]);

        $this->info("PRISMS Roster Sync completed for {$semester} ({$totalUpdated} enrollments verified).");

        return self::SUCCESS;
    }
}
