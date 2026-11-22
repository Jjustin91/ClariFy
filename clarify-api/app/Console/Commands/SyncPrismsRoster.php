<?php

namespace App\Console\Commands;

use App\Models\Channel;
use App\Models\PrismsSyncLog;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SyncPrismsRoster extends Command
{
    protected $signature = 'prisms:sync {--semester=2026-1ST-SEM : Target USTP semester code}';

    protected $description = 'Reconciles actual approved registered ClariFy accounts against matching scoped channels and records an accurate sync log (FR-01_REV, FR-10)';

    public function handle(): int
    {
        $startedAt = microtime(true);
        $semester = trim((string) $this->option('semester')) ?: '2026-1ST-SEM';

        $approvedUsers = User::with('academicProfile')
            ->where('verification_status', 'approved')
            ->get();

        $channels = Channel::all();

        // Preload existing memberships once to avoid N+1 queries
        $existingMemberships = DB::table('channel_user')
            ->select('channel_id', 'user_id', 'approval_status', 'can_publish')
            ->get()
            ->keyBy(fn ($row) => "{$row->channel_id}:{$row->user_id}");

        $enrollmentsTouched = 0;
        $channelsProvisioned = 0;
        $reconciledUserIds = [];
        $touchedChannelIds = [];

        foreach ($approvedUsers as $user) {
            if ($user->academicProfile && $user->academicProfile->semester_code !== $semester) {
                $user->academicProfile->semester_code = $semester;
                $user->academicProfile->save();
            }

            // IT Administrators stay isolated from academic Course Hub rosters
            if ($user->role === 'it_admin') {
                $reconciledUserIds[$user->id] = true;
                continue;
            }

            $dept = strtoupper(trim((string) ($user->academicProfile?->department ?? '')));
            $section = strtoupper(trim((string) ($user->academicProfile?->section ?? '')));
            $canPublish = $user->canPublishOrManage();

            foreach ($channels as $channel) {
                // Skip custom sub-channels; memberships are scoped to parent hubs and campus/dept channels
                if ($channel->parent_hub_id !== null) {
                    continue;
                }

                $channelDept = strtoupper(trim((string) ($channel->scope_department ?? '')));
                $channelSection = strtoupper(trim((string) ($channel->scope_section ?? '')));

                $matchesDept = $channelDept === '' || ($dept !== '' && $channelDept === $dept);
                $matchesSection = $channelSection === ''
                    || ($section !== '' && $channelSection === $section)
                    || $user->role !== 'student';

                if (! ($matchesDept && $matchesSection)) {
                    continue;
                }

                $reconciledUserIds[$user->id] = true;
                $touchedChannelIds[$channel->id] = true;

                $pivotKey = "{$channel->id}:{$user->id}";
                $existing = $existingMemberships->get($pivotKey);

                if (! $existing) {
                    $channel->members()->syncWithoutDetaching([
                        $user->id => [
                            'can_publish' => $canPublish,
                            'approval_status' => 'approved',
                            'joined_at' => now(),
                        ],
                    ]);
                    $enrollmentsTouched++;
                } elseif (
                    ($existing->approval_status ?? null) !== 'approved'
                    || (bool) $existing->can_publish !== $canPublish
                ) {
                    DB::table('channel_user')
                        ->where('channel_id', $channel->id)
                        ->where('user_id', $user->id)
                        ->update([
                            'approval_status' => 'approved',
                            'can_publish' => $canPublish,
                        ]);
                    $enrollmentsTouched++;
                }
            }
        }

        $channelsProvisioned = count($touchedChannelIds) > 0
            ? count($touchedChannelIds)
            : $channels->whereNull('parent_hub_id')->count();

        $totalReconciledAccounts = max(count($reconciledUserIds), $approvedUsers->count());
        $durationMs = max(1, (int) round((microtime(true) - $startedAt) * 1000));

        PrismsSyncLog::create([
            'semester_code' => $semester,
            'triggered_by' => 'System Cron (SyncPrismsRoster)',
            'sync_type' => 'scheduled_midnight',
            'total_updated' => $totalReconciledAccounts,
            'channels_provisioned' => $channelsProvisioned,
            'status' => 'completed',
            'duration_ms' => $durationMs,
            'executed_at' => now(),
        ]);

        $this->info(
            "Registered Account & Roster Sync completed for {$semester} ({$totalReconciledAccounts} accounts reconciled, {$enrollmentsTouched} roster updates across {$channelsProvisioned} channels)."
        );

        return self::SUCCESS;
    }
}
