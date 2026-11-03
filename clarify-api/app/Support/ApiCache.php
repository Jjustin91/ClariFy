<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class ApiCache
{
    public const ANNOUNCEMENTS_TTL_SECONDS = 600; // 10 minutes
    public const CHANNELS_TTL_SECONDS = 600;      // 10 minutes
    public const INSTRUCTORS_TTL_SECONDS = 1800;  // 30 minutes

    /**
     * Builds the deterministic cache key for a channel's active announcements
     * and registers it under the channel's key index for targeted invalidation on the 'file' store.
     */
    public static function announcementChannelKey(int $channelId, array $params = []): string
    {
        $baseKey = "announcements.channel.{$channelId}";
        $key = empty($params) ? $baseKey : "{$baseKey}." . md5(json_encode($params));

        self::registerIndexedKey("{$baseKey}.keys", $key, self::ANNOUNCEMENTS_TTL_SECONDS);

        return $key;
    }

    /**
     * Builds the deterministic cache key for the combined campus-wide + enrolled announcements feed.
     */
    public static function announcementFeedKey(?int $userId, array $params = []): string
    {
        $uid = $userId ?? 0;
        $key = "announcements.feed.user.{$uid}." . md5(json_encode($params));

        self::registerIndexedKey('announcements.feed.keys', $key, self::ANNOUNCEMENTS_TTL_SECONDS);

        return $key;
    }

    /**
     * Builds the deterministic cache key for a user's visible channel list.
     */
    public static function channelsKey(?int $userId, array $params = []): string
    {
        $uid = $userId ?? 0;
        $baseKey = "channels.user.{$uid}";
        $key = empty($params) ? $baseKey : "{$baseKey}." . md5(json_encode($params));

        self::registerIndexedKey('channels.keys', $key, self::CHANNELS_TTL_SECONDS);

        return $key;
    }

    /**
     * Builds the deterministic cache key for the verified instructor directory.
     */
    public static function instructorsKey(array $params = []): string
    {
        $baseKey = 'instructors.directory';
        $key = empty($params) ? $baseKey : "{$baseKey}." . md5(json_encode($params));

        self::registerIndexedKey('instructors.keys', $key, self::INSTRUCTORS_TTL_SECONDS);

        return $key;
    }

    /**
     * Invalidates all cached announcement keys for a specific channel (and combined feeds).
     */
    public static function forgetChannelAnnouncements(?int $channelId): void
    {
        if ($channelId !== null) {
            Cache::forget("announcements.channel.{$channelId}");
            self::forgetIndexedKeys("announcements.channel.{$channelId}.keys");
        }

        Cache::forget('announcements.feed');
        self::forgetIndexedKeys('announcements.feed.keys');
    }

    /**
     * Invalidates all cached channel list keys when a channel is created, updated, deleted, or membership changes.
     */
    public static function forgetChannels(?int $channelId = null): void
    {
        if ($channelId !== null) {
            Cache::forget("channels.channel.{$channelId}");
        }

        Cache::forget('channels.list');
        self::forgetIndexedKeys('channels.keys');
    }

    /**
     * Invalidates all cached instructor directory keys.
     */
    public static function forgetInstructors(): void
    {
        Cache::forget('instructors.directory');
        self::forgetIndexedKeys('instructors.keys');
    }

    private static function registerIndexedKey(string $indexKey, string $targetKey, int $ttlSeconds): void
    {
        $tracked = Cache::get($indexKey, []);
        if (! is_array($tracked)) {
            $tracked = [];
        }

        if (! in_array($targetKey, $tracked, true)) {
            $tracked[] = $targetKey;
            Cache::put($indexKey, $tracked, $ttlSeconds);
        }
    }

    private static function forgetIndexedKeys(string $indexKey): void
    {
        $tracked = Cache::pull($indexKey, []);
        if (is_array($tracked)) {
            foreach ($tracked as $key) {
                if (is_string($key)) {
                    Cache::forget($key);
                }
            }
        }
    }
}
