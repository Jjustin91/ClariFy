<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channels', function (Blueprint $table) {
            $table->id();
            $table->string('course_code', 32)->nullable()->index();
            $table->string('name');
            $table->text('description')->nullable();
            $table->enum('channel_type', ['university', 'college', 'department', 'course_hub'])->default('course_hub');
            $table->string('scope_college')->nullable()->index();
            $table->string('scope_department')->nullable()->index();
            $table->string('scope_section')->nullable()->index();
            $table->string('instructor_name')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('channel_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('channel_id')->constrained('channels')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->boolean('can_publish')->default(false);
            $table->timestamp('joined_at')->useCurrent();
            $table->unique(['channel_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('channel_user');
        Schema::dropIfExists('channels');
    }
};
