<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('messages')) {
            return;
        }

        Schema::table('messages', function (Blueprint $table): void {
            if (! Schema::hasColumn('messages', 'deleted_at')) {
                $table->softDeletes();
                $table->index(['channel_id', 'deleted_at', 'id'], 'messages_channel_deleted_at_id_idx');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('messages')) {
            return;
        }

        if (Schema::hasColumn('messages', 'deleted_at')) {
            Schema::table('messages', function (Blueprint $table): void {
                try {
                    $table->dropIndex('messages_channel_deleted_at_id_idx');
                } catch (\Throwable $e) {
                    // Ignore if index does not exist
                }
                $table->dropSoftDeletes();
            });
        }
    }
};
