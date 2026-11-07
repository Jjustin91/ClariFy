<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class ApiCache
{
    public const ANNOUNCEMENTS_TTL_SECONDS = 600; // 10 minutes
    public const CHANNELS_TTL_SECONDS = 600;      // 10 minutes
    public const INSTRUCTORS_TTL_SECONDS = 1800;  // 30 minutes

    /**
     * Reads the current generation counter for a namespace (initializes to 1 if absent).
     */
    public static function getVersion(string $namespace): int
    {
        $versionKey = "ver:{$namespace}";
        $ver = Cache::get($versionKey);
        if (! is_numeric($ver) || (int) $ver < 1) {
            Cache::forever($versionKey, 1);
            return 1;
        }

        return (int) $ver;
    }

    /**
     * Atomically bumps a namespace generation counter without scanning or maintaining .keys arrays.
     */
    public static function bumpVersion(string $namespace): int
    {
        $versionKey = "ver:{$namespace}";
        if (! Cache::has($versionKey)) {
            Cache::forever($versionKey, 2);
            return 2;
        }

        return (int) Cache::increment($versionKey);
    }

    /**
     * Builds the versioned cache key for a channel's shared announcements query.
     */
    public static function announcementChannelKey(int $channelId, array $params = []): string
    {
        $channelVer = self::getVersion("announcements.channel.{$channelId}");
        $globalVer = self::getVersion('announcements.global');
        ksort($params);
        $hash = empty($params) ? 'default' : md5(json_encode($params));

        return "announcements.ch.{$channelId}.v{$channelVer}.g{$globalVer}.{$hash}";
    }

    /**
     * Builds the versioned cache key for the combined campus-wide + enrolled announcements feed.
     */
    public static function announcementFeedKey(?int $userId, array $params = []): string
    {
        $feedVer = self::getVersion('announcements.feed');
        $globalVer = self::getVersion('announcements.global');
        $uid = $userId ?? 0;
        ksort($params);
        $hash = md5(json_encode($params));

        return "announcements.feed.u{$uid}.v{$feedVer}.g{$globalVer}.{$hash}";
    }

    /**
     * Builds the versioned cache key for the shared channel list (independent of per-user id).
     */
    public static function channelsKey(?int $userId = null, array $params = []): string
    {
        $ver = self::getVersion('channels.list');
        ksort($params);
        $hash = empty($params) ? 'default' : md5(json_encode($params));

        return "channels.shared.v{$ver}.{$hash}";
    }

    /**
     * Builds the versioned cache key for the verified instructor directory.
     */
    public static function instructorsKey(array $params = []): string
    {
        $ver = self::getVersion('instructors.directory');
        ksort($params);
        $hash = empty($params) ? 'default' : md5(json_encode($params));

        return "instructors.dir.v{$ver}.{$hash}";
    }

    /**
     * Invalidates cached announcement keys for a specific channel (and combined feeds) by bumping version counters.
     */
    public static function forgetChannelAnnouncements(?int $channelId): void
    {
        if ($channelId !== null) {
            self::bumpVersion("announcements.channel.{$channelId}");
        } else {
            self::bumpVersion('announcements.global');
        }

        self::bumpVersion('announcements.feed');
    }

    /**
     * Invalidates cached channel list keys when a channel is created, updated, deleted, or membership changes.
     */
    public static function forgetChannels(?int $channelId = null): void
    {
        if ($channelId !== null) {
            self::bumpVersion("channels.channel.{$channelId}");
        }

        self::bumpVersion('channels.list');
    }

    /**
     * Invalidates cached instructor directory keys.
     */
    public static function forgetInstructors(): void
    {
        self::bumpVersion('instructors.directory');
    }
}

