<?php

namespace App\Policies;

use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\DB;

class ChannelPolicy
{
    /**
     * Authorizes unsending a chat message inside a Course Hub.
     * Only an approved member who authored the message (sender_id === user.id) may unsend it.
     */
    public function unsendMessage(User $user, Channel $channel, Message $message): Response
    {
        if (! self::hasApprovedChannelAccess($user, $channel)) {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: You must be an approved member of this Course Hub.'
            );
        }

        if ((int) $message->channel_id !== (int) $channel->id) {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: Message does not belong to this Course Hub.'
            );
        }

        if ((int) $message->sender_id !== (int) $user->id) {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: Only the original sender can unsend this chat message.'
            );
        }

        return Response::allow();
    }
    /**
     * Resolves parent Course Hub ID from column or legacy [HUB:id] prefix.
     */
    public static function resolveParentHubId(Channel $channel): ?int
    {
        if ($channel->parent_hub_id !== null) {
            return (int) $channel->parent_hub_id;
        }

        if (is_string($channel->description) && preg_match('/^\[HUB:(\d+)\]/i', $channel->description, $matches)) {
            return (int) $matches[1];
        }

        return null;
    }

    /**
     * Checks if user is an approved member of the channel or its parent Course Hub,
     * or passes role / department-scope rules.
     */
    public static function hasApprovedChannelAccess(User $user, Channel $channel): bool
    {
        if (in_array($user->role, ['it_admin', 'dept_head'], true)) {
            return true;
        }

        if ($channel->created_by !== null && (int) $channel->created_by === (int) $user->id) {
            return true;
        }

        $parentHubId = self::resolveParentHubId($channel);
        $targetChannelIds = array_values(array_filter([$channel->id, $parentHubId]));

        if ($parentHubId !== null) {
            $parentCreatorId = Channel::where('id', $parentHubId)->value('created_by');
            if ($parentCreatorId !== null && (int) $parentCreatorId === (int) $user->id) {
                return true;
            }
        }

        $isApprovedMember = DB::table('channel_user')
            ->whereIn('channel_id', $targetChannelIds)
            ->where('user_id', $user->id)
            ->where('approval_status', 'approved')
            ->exists();

        if ($isApprovedMember) {
            return true;
        }

        // Non-course-hub channels (university / college / department) allow department-scoped access
        if ($channel->channel_type !== 'course_hub') {
            if ($channel->channel_type === 'university' || ! $channel->scope_department) {
                return true;
            }

            $userDept = $user->academicProfile?->department;
            if ($userDept && strcasecmp($channel->scope_department, $userDept) === 0) {
                return true;
            }
        }

        // Department-scope fallback when user belongs to the matching department and is not explicitly pending/rejected
        $userDept = $user->academicProfile?->department;
        if (
            $channel->scope_department &&
            $userDept &&
            strcasecmp($channel->scope_department, $userDept) === 0 &&
            $user->role === 'faculty'
        ) {
            return true;
        }

        return false;
    }

    /**
     * Checks if user is a Course Admin (creator or faculty/dept_head) for edit/delete/roster management.
     */
    public static function isCourseAdmin(User $user, Channel $channel): bool
    {
        if ($user->role === 'it_admin') {
            return false;
        }

        if (in_array($user->role, ['faculty', 'dept_head'], true)) {
            return true;
        }

        if ($channel->created_by !== null && (int) $channel->created_by === (int) $user->id) {
            return true;
        }

        $parentHubId = self::resolveParentHubId($channel);
        if ($parentHubId !== null) {
            $parentHub = Channel::find($parentHubId);
            if ($parentHub && $parentHub->created_by !== null && (int) $parentHub->created_by === (int) $user->id) {
                return true;
            }
        }

        return false;
    }

    public function view(User $user, Channel $channel): Response
    {
        if (self::hasApprovedChannelAccess($user, $channel)) {
            return Response::allow();
        }

        return Response::denyWithStatus(
            403,
            "Access Denied: You are not an approved member of {$channel->name} (FR-01_REV)."
        );
    }

    public function interact(User $user, Channel $channel): Response
    {
        return $this->view($user, $channel);
    }

    public function join(User $user, Channel $channel): Response
    {
        if ($user->role === 'it_admin') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.'
            );
        }

        return Response::allow();
    }

    public function leave(User $user, Channel $channel): Response
    {
        if ($user->role === 'it_admin') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.'
            );
        }

        return Response::allow();
    }

    public function manageMembers(User $user, Channel $channel): Response
    {
        if ($user->role === 'it_admin') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.'
            );
        }

        if (self::isCourseAdmin($user, $channel)) {
            return Response::allow();
        }

        return Response::denyWithStatus(
            403,
            'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can add, approve, or remove members in this Course Hub.'
        );
    }

    public function update(User $user, Channel $channel): Response
    {
        if ($user->role === 'it_admin') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.'
            );
        }

        if (self::isCourseAdmin($user, $channel)) {
            return Response::allow();
        }

        return Response::denyWithStatus(
            403,
            'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can edit this Course Hub.'
        );
    }

    public function delete(User $user, Channel $channel): Response
    {
        if ($user->role === 'it_admin') {
            return Response::denyWithStatus(
                403,
                'HTTP 403 Forbidden: IT Administrator accounts are restricted to the IT Admin Console.'
            );
        }

        if (self::isCourseAdmin($user, $channel)) {
            return Response::allow();
        }

        return Response::denyWithStatus(
            403,
            'HTTP 403 Forbidden: Only Course Admins (the Course Hub creator or Faculty) can delete this Course Hub.'
        );
    }
}
