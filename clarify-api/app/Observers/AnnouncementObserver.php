<?php

namespace App\Observers;

use App\Models\Announcement;
use App\Models\AnnouncementAudit;
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
}
