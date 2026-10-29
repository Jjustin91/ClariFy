<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prisms_sync_logs', function (Blueprint $table) {
            $table->id();
            $table->string('semester_code')->index();
            $table->string('triggered_by');
            $table->enum('sync_type', ['scheduled_midnight', 'manual_admin'])->default('scheduled_midnight');
            $table->unsignedInteger('total_updated')->default(0);
            $table->unsignedInteger('channels_provisioned')->default(0);
            $table->enum('status', ['completed', 'partial_warning', 'failed'])->default('completed');
            $table->unsignedInteger('duration_ms')->default(0);
            $table->timestamp('executed_at')->useCurrent();
            $table->timestamps();
        });

        Schema::create('device_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('expo_push_token')->unique();
            $table->enum('platform', ['android', 'ios', 'web'])->default('android');
            $table->timestamp('last_registered_at')->useCurrent();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_tokens');
        Schema::dropIfExists('prisms_sync_logs');
    }
};
