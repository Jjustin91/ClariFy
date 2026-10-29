<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('channel_id')->constrained('channels')->cascadeOnDelete();
            $table->foreignId('publisher_id')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->string('subtitle')->default('USTP Digital Transformation');
            $table->text('content');
            $table->string('attachment_url')->nullable();
            $table->string('attachment_name')->nullable();
            $table->enum('attachment_type', ['image', 'document'])->nullable();
            $table->jsonb('tags')->default('[]');
            $table->boolean('is_urgent')->default(false)->index();
            $table->boolean('is_pinned')->default(false)->index();
            $table->boolean('trigger_sms_fallback')->default(false);
            $table->enum('status', ['draft', 'published', 'archived'])->default('published')->index();
            $table->boolean('is_edited')->default(false);
            $table->timestamp('published_at')->useCurrent()->index();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('announcement_reads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('announcement_id')->constrained('announcements')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('acknowledged_at')->useCurrent();
            $table->unique(['announcement_id', 'user_id']);
        });

        // Immutable Append-Only Audit Trail (NFR-03_REV)
        Schema::create('announcement_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('announcement_id')->constrained('announcements')->cascadeOnDelete();
            $table->foreignId('editor_id')->constrained('users')->cascadeOnDelete();
            $table->string('previous_title');
            $table->string('new_title');
            $table->text('previous_content');
            $table->text('new_content');
            $table->timestamp('edited_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcement_audits');
        Schema::dropIfExists('announcement_reads');
        Schema::dropIfExists('announcements');
    }
};
