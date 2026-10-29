<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('channel_id')->constrained('channels')->cascadeOnDelete();
            $table->foreignId('announcement_id')->nullable()->constrained('announcements')->nullOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            // Self-referencing parent_id: null = root QaThread, non-null = ThreadReply
            $table->foreignId('parent_id')->nullable()->constrained('messages')->cascadeOnDelete();
            $table->string('subject_hashtag')->nullable()->index();
            $table->text('content');
            $table->boolean('is_private')->default(false);
            $table->boolean('is_resolved')->default(false)->index();
            $table->boolean('is_pinned_faq')->default(false)->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
