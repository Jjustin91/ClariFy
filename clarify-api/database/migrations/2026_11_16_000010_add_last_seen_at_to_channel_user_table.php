<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('channel_user')) {
            return;
        }

        Schema::table('channel_user', function (Blueprint $table): void {
            if (! Schema::hasColumn('channel_user', 'last_seen_at')) {
                $table->timestamp('last_seen_at')->nullable()->after('joined_at');
                $table->index(
                    ['user_id', 'channel_id', 'last_seen_at'],
                    'channel_user_user_channel_last_seen_idx'
                );
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('channel_user')) {
            return;
        }

        if (Schema::hasColumn('channel_user', 'last_seen_at')) {
            Schema::table('channel_user', function (Blueprint $table): void {
                try {
                    $table->dropIndex('channel_user_user_channel_last_seen_idx');
                } catch (\Throwable $e) {
                    // Ignore if index does not exist
                }
                $table->dropColumn('last_seen_at');
            });
        }
    }
};
