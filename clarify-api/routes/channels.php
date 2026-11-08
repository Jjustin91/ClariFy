<?php

use App\Models\Channel;
use App\Models\User;
use App\Policies\ChannelPolicy;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels (Laravel Reverb Private Channels)
|--------------------------------------------------------------------------
*/

Broadcast::channel('clarify.global', function (User $user) {
    return $user->verification_status === 'approved';
});

Broadcast::channel('clarify.channel.{channelId}', function (User $user, int $channelId) {
    if ($user->verification_status !== 'approved') {
        return false;
    }

    $channel = Channel::find($channelId);
    if (! $channel) {
        return false;
    }

    return ChannelPolicy::hasApprovedChannelAccess($user, $channel)
        || ChannelPolicy::isCourseAdmin($user, $channel);
});

Broadcast::channel('clarify.user.{userId}', function (User $user, int $userId) {
    return $user->verification_status === 'approved' && (int) $user->id === (int) $userId;
});

