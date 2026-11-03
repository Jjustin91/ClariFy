<?php

namespace App\Observers;

use App\Models\Announcement;
use App\Models\AnnouncementAudit;
use App\Support\ApiCache;
use Illuminate\Support\Facades\Auth;

class AnnouncementObserver
{
    /**
     * Automatically log edits to the immutable announcement_audits table (NFR-03_REV / TC-NFR03)
     * whenever title or content changes.
     */
    public function updating(Announcement $announcement): void
    {
        if ($announcement->isDirty(['title', 'content'])) {
            $announcement->is_edited = true;

            AnnouncementAudit::create([
                'announcement_id' => $announcement->id,
                'editor_id' => Auth::id() ?? $announcement->publisher_id,
                'previous_title' => (string) $announcement->getOriginal('title'),
                'new_title' => (string) $announcement->title,
                'previous_content' => (string) $announcement->getOriginal('content'),
                'new_content' => (string) $announcement->content,
                'edited_at' => now(),
            ]);
        }
    }

    /**
     * Invalidate the specific channel's announcement cache when an announcement is created.
     */
    public function created(Announcement $announcement): void
    {
        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);
        ApiCache::forgetChannels((int) $announcement->channel_id);
    }

    /**
     * Invalidate the specific channel's announcement cache when an announcement is updated.
     */
    public function updated(Announcement $announcement): void
    {
        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);

        $originalChannelId = $announcement->getOriginal('channel_id');
        if ($originalChannelId && (int) $originalChannelId !== (int) $announcement->channel_id) {
            ApiCache::forgetChannelAnnouncements((int) $originalChannelId);
        }
    }

    /**
     * Invalidate the specific channel's announcement cache when an announcement is deleted.
     */
    public function deleted(Announcement $announcement): void
    {
        ApiCache::forgetChannelAnnouncements((int) $announcement->channel_id);
        ApiCache::forgetChannels((int) $announcement->channel_id);
    }
}
