<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Add nullable indexed parent_hub_id on channels and backfill from [HUB:id] description prefix
        if (! Schema::hasColumn('channels', 'parent_hub_id')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->foreignId('parent_hub_id')
                    ->nullable()
                    ->after('id')
                    ->constrained('channels')
                    ->nullOnDelete();
                $table->index('parent_hub_id', 'channels_parent_hub_id_idx');
            });
        }

        $channels = DB::table('channels')
            ->whereNull('parent_hub_id')
            ->where('description', 'like', '[HUB:%')
            ->select(['id', 'description'])
            ->get();

        foreach ($channels as $channel) {
            if (is_string($channel->description) && preg_match('/^\[HUB:(\d+)\]/i', $channel->description, $matches)) {
                $parentId = (int) $matches[1];
                if (DB::table('channels')->where('id', $parentId)->exists()) {
                    DB::table('channels')
                        ->where('id', $channel->id)
                        ->update(['parent_hub_id' => $parentId]);
                }
            }
        }

        // 2. Composite index on messages (channel_id, subject_hashtag, id) for cursor chat pagination & counts
        Schema::table('messages', function (Blueprint $table) {
            $table->index(['channel_id', 'subject_hashtag', 'id'], 'messages_channel_hashtag_id_idx');
        });

        // 3. Composite index on announcements for feed filtering and sorting
        Schema::table('announcements', function (Blueprint $table) {
            $table->index(
                ['channel_id', 'status', 'is_urgent', 'is_pinned', 'published_at'],
                'announcements_feed_sort_idx'
            );
        });

        // 4. Ensure attachment_url is TEXT in migration rather than at runtime, and add guarded pg_trgm GIN index
        if (DB::getDriverName() === 'pgsql') {
            try {
                DB::statement('ALTER TABLE announcements ALTER COLUMN attachment_url TYPE TEXT');
            } catch (\Throwable $e) {
                // Ignore if already TEXT
            }

            try {
                DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
                DB::statement(
                    'CREATE INDEX IF NOT EXISTS announcements_title_content_trgm_idx ON announcements USING gin ((coalesce(title, \'\') || \' \' || coalesce(content, \'\')) gin_trgm_ops)'
                );
            } catch (\Throwable $e) {
                // Ignore if database user lacks SUPERUSER to enable pg_trgm extension
            }
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            try {
                DB::statement('DROP INDEX IF EXISTS announcements_title_content_trgm_idx');
            } catch (\Throwable $e) {
                // Ignore
            }
        }

        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_feed_sort_idx');
        });

        Schema::table('messages', function (Blueprint $table) {
            $table->dropIndex('messages_channel_hashtag_id_idx');
        });

        if (Schema::hasColumn('channels', 'parent_hub_id')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->dropForeign(['parent_hub_id']);
                $table->dropIndex('channels_parent_hub_id_idx');
                $table->dropColumn('parent_hub_id');
            });
        }
    }
};
