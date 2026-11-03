<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('channel_user') && ! Schema::hasColumn('channel_user', 'approval_status')) {
            Schema::table('channel_user', function (Blueprint $table) {
                $table->string('approval_status', 24)->default('approved')->after('can_publish');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('channel_user') && Schema::hasColumn('channel_user', 'approval_status')) {
            Schema::table('channel_user', function (Blueprint $table) {
                $table->dropColumn('approval_status');
            });
        }
    }
};
