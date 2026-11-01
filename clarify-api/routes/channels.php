<?php

use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels (Laravel Reverb)
|--------------------------------------------------------------------------
|
| Public & scoped channels for ClariFy real-time synchronization:
| - clarify.global: Campus-wide Urgent Announcements, Read Reach Ack Counters,
|   Course Hub Chat & Q&A Threads sync
| - clarify.channel.{channelId}: Scoped Course Hub channel events
|
*/

Broadcast::channel('clarify.global', function () {
    return true;
});

Broadcast::channel('clarify.channel.{channelId}', function () {
    return true;
});

Broadcast::channel('clarify.user.{userId}', function ($user, $userId) {
    return (int) $user->id === (int) $userId;
});
