<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\ApiCache;
use App\Support\AvatarStorage;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class MigrateUserAvatars extends Command
{
    protected $signature = 'users:migrate-avatars
        {--dry-run : Report how many user avatars would be migrated without writing files or updating the database}
        {--chunk=100 : Chunk size for scanning users}';

    protected $description = 'Convert base64 data: URIs in users.avatar_url into files on the public storage disk and store their public URLs.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunkSize = max(10, (int) $this->option('chunk'));

        $migratedCount = 0;
        $skippedCount = 0;

        User::query()
            ->where('avatar_url', 'like', 'data:%')
            ->orderBy('id')
            ->chunkById($chunkSize, function ($users) use ($dryRun, &$migratedCount, &$skippedCount): void {
                foreach ($users as $user) {
                    $raw = (string) ($user->avatar_url ?? '');
                    $decoded = AvatarStorage::decodeDataUri($raw);

                    if ($decoded === null) {
                        $skippedCount++;
                        $this->warn("Skipping user #{$user->id}: malformed or non-image data URI.");
                        continue;
                    }

                    $hash = substr(hash('sha256', $decoded['bytes']), 0, 16);
                    $relativePath = "avatars/{$user->id}/{$hash}.{$decoded['extension']}";
                    $publicUrl = AvatarStorage::publicUrlForPath($relativePath);

                    if (! $dryRun) {
                        Storage::disk('public')->put($relativePath, $decoded['bytes']);
                        $user->avatar_url = $publicUrl;
                        $user->save();
                    }

                    $migratedCount++;
                }
            });

        if (! $dryRun && $migratedCount > 0) {
            ApiCache::forgetInstructors();
            ApiCache::forgetChannels();
            ApiCache::forgetChannelAnnouncements(null);
        }

        $prefix = $dryRun ? '[DRY RUN] ' : '';
        $this->info("{$prefix}Migrated {$migratedCount} user avatar(s), skipped {$skippedCount}.");

        return self::SUCCESS;
    }
}
