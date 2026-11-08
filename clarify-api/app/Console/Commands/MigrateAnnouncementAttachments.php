<?php

namespace App\Console\Commands;

use App\Models\Announcement;
use App\Support\ApiCache;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MigrateAnnouncementAttachments extends Command
{
    protected $signature = 'announcements:migrate-attachments {--dry-run : Report how many rows would be migrated without modifying storage or database} {--chunk=100 : Chunk size for scanning announcements}';

    protected $description = 'Migrate base64 data: URLs in attachment_url and __CLARIFY_ANN_MEDIA__ embedded content headers into files on the public storage disk.';

    private const MEDIA_PREFIX = '__CLARIFY_ANN_MEDIA__';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunkSize = max(10, (int) $this->option('chunk'));

        $migratedCount = 0;
        $skippedCount = 0;
        $touchedChannels = [];

        $query = Announcement::withTrashed()
            ->where(function ($q) {
                $q->where('attachment_url', 'like', 'data:%')
                    ->orWhere('content', 'like', self::MEDIA_PREFIX . '%');
            })
            ->orderBy('id');

        $query->chunkById($chunkSize, function ($announcements) use (
            $dryRun,
            &$migratedCount,
            &$skippedCount,
            &$touchedChannels
        ) {
            foreach ($announcements as $announcement) {
                $content = (string) ($announcement->content ?? '');
                $attachmentUrl = $announcement->attachment_url;
                $attachmentName = $announcement->attachment_name;
                $attachmentType = $announcement->attachment_type;

                $dataUrl = null;
                $cleanBody = $content;

                // 1. Check __CLARIFY_ANN_MEDIA__ header in content
                if (str_starts_with($content, self::MEDIA_PREFIX)) {
                    $newlineIdx = strpos($content, "\n");
                    $headerLine = $newlineIdx === false ? $content : substr($content, 0, $newlineIdx);
                    $cleanBody = $newlineIdx === false ? '' : substr($content, $newlineIdx + 1);
                    $rawJson = substr($headerLine, strlen(self::MEDIA_PREFIX));
                    $parsed = json_decode($rawJson, true);

                    if (is_array($parsed) && ! empty($parsed['url']) && is_string($parsed['url'])) {
                        $candidateUrl = trim($parsed['url']);
                        if (str_starts_with($candidateUrl, 'data:')) {
                            $dataUrl = $candidateUrl;
                        } elseif (empty($attachmentUrl)) {
                            $attachmentUrl = $candidateUrl;
                        }
                        if (empty($attachmentName) && ! empty($parsed['name']) && is_string($parsed['name'])) {
                            $attachmentName = $parsed['name'];
                        }
                        if (empty($attachmentType) && ! empty($parsed['type']) && is_string($parsed['type'])) {
                            $attachmentType = $parsed['type'];
                        }
                    }
                }

                // 2. Check data: URL in attachment_url
                if ($dataUrl === null && is_string($attachmentUrl) && str_starts_with($attachmentUrl, 'data:')) {
                    $dataUrl = trim($attachmentUrl);
                }

                $storedRelativePath = null;
                if ($dataUrl !== null) {
                    $decoded = $this->decodeDataUrl($dataUrl, $attachmentName, $attachmentType);
                    if ($decoded === null) {
                        $skippedCount++;
                        $this->warn("Skipping announcement #{$announcement->id}: malformed data URL.");
                        continue;
                    }

                    $channelFolder = (int) ($announcement->channel_id ?: 0);
                    $storedRelativePath = "announcements/{$channelFolder}/" . Str::uuid()->toString() . '.' . $decoded['extension'];
                    $attachmentName = $attachmentName ?: ('attachment.' . $decoded['extension']);
                    $attachmentType = $decoded['type'];

                    if (! $dryRun) {
                        Storage::disk('public')->put($storedRelativePath, $decoded['bytes']);
                    }
                }

                $needsContentUpdate = $cleanBody !== $content;
                $needsAttachmentUpdate = $storedRelativePath !== null || $attachmentUrl !== $announcement->attachment_url;

                if (! $needsContentUpdate && ! $needsAttachmentUpdate) {
                    $skippedCount++;
                    continue;
                }

                if (! $dryRun) {
                    $announcement->content = $cleanBody;
                    if ($storedRelativePath !== null) {
                        $announcement->attachment_url = $storedRelativePath;
                        $announcement->attachment_name = $attachmentName;
                        $announcement->attachment_type = $attachmentType;
                    } elseif ($attachmentUrl !== $announcement->attachment_url) {
                        $announcement->attachment_url = $attachmentUrl;
                        $announcement->attachment_name = $attachmentName;
                        $announcement->attachment_type = $attachmentType;
                    }
                    $announcement->save();
                }

                $migratedCount++;
                $touchedChannels[(int) ($announcement->channel_id ?? 0)] = true;
            }
        });

        if (! $dryRun && $migratedCount > 0) {
            ApiCache::forgetChannelAnnouncements(null);
            foreach (array_keys($touchedChannels) as $cid) {
                if ($cid > 0) {
                    ApiCache::forgetChannelAnnouncements((int) $cid);
                }
            }
        }

        $prefix = $dryRun ? '[DRY RUN] ' : '';
        $this->info("{$prefix}Migrated {$migratedCount} announcement(s), skipped {$skippedCount}.");

        return self::SUCCESS;
    }

    /**
     * @return array{bytes: string, extension: string, type: string}|null
     */
    private function decodeDataUrl(string $dataUrl, ?string $attachmentName, ?string $attachmentType): ?array
    {
        if (! preg_match('#^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$#is', $dataUrl, $matches)) {
            return null;
        }

        $mime = strtolower(trim($matches[1] ?? 'application/octet-stream'));
        $base64Payload = preg_replace('/\s+/', '', $matches[2]);
        $bytes = base64_decode($base64Payload, true);
        if ($bytes === false) {
            return null;
        }

        $mimeToExt = [
            'image/jpeg' => 'jpg',
            'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'application/pdf' => 'pdf',
            'application/msword' => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/vnd.ms-powerpoint' => 'ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'text/plain' => 'txt',
        ];

        $extFromName = $attachmentName ? strtolower(pathinfo($attachmentName, PATHINFO_EXTENSION)) : '';
        $extension = $mimeToExt[$mime] ?? ($extFromName !== '' ? $extFromName : 'bin');

        $type = $attachmentType;
        if (! in_array($type, ['image', 'pdf', 'document'], true)) {
            if (str_starts_with($mime, 'image/') || in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true)) {
                $type = 'image';
            } elseif ($mime === 'application/pdf' || $extension === 'pdf') {
                $type = 'pdf';
            } else {
                $type = 'document';
            }
        }

        return [
            'bytes' => $bytes,
            'extension' => $extension,
            'type' => $type,
        ];
    }
}
