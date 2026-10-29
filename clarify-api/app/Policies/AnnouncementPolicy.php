<?php

namespace App\Policies;

use App\Models\Announcement;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class AnnouncementPolicy
{
    /**
     * Enforces FR-02, FR-04_REV, and NFR-01_REV (TC-NFR01):
     * - Students are strictly forbidden from creating announcements (HTTP 403).
     * - Faculty can publish inside their assigned Course Hubs.
     * - Department Heads and IT Admins can publish across university/college/department scopes.
     */
    public function create(User $user, ?Channel $channel = null): Response
    {
        if ($user->role === 'student') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: Students are not authorized to publish announcements (TC-NFR01).'
            );
        }

        if (in_array($user->role, ['dept_head', 'it_admin'], true)) {
            return Response::allow();
        }

        if ($channel && in_array($channel->channel_type, ['university', 'college'], true)) {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: University-wide and College-wide memos are restricted to Department Heads, Deans, and IT Administrators (FR-02).'
            );
        }

        return Response::allow();
    }

    public function update(User $user, Announcement $announcement): Response
    {
        if ($user->role === 'student') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: Students cannot edit announcements.'
            );
        }

        if (
            in_array($user->role, ['dept_head', 'it_admin'], true) ||
            $announcement->publisher_id === $user->id
        ) {
            return Response::allow();
        }

        return Response::denyWithStatus(
            403,
            'HTTP 403 Forbidden: You can only edit announcements within your assigned scope.'
        );
    }

    public function delete(User $user, Announcement $announcement): Response
    {
        return $this->update($user, $announcement);
    }
}
