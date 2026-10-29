<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('institutional_id', 32)->unique()->index();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            // Encrypted mobile contact number for RA 10173 compliance (NFR-05) & SMS fallback (NFR-02)
            $table->text('contact_number')->nullable();
            $table->string('avatar_url')->nullable();
            $table->enum('role', ['student', 'faculty', 'dept_head', 'it_admin'])->default('student');
            $table->enum('verification_status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->timestamp('verified_at')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('academic_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->string('campus')->default('CDO Campus');
            $table->string('college')->default('CITC');
            $table->string('department')->default('CITC')->index();
            $table->string('program')->nullable();
            $table->unsignedTinyInteger('year_level')->nullable();
            $table->string('section')->nullable()->index();
            $table->string('semester_code')->default('2026-1ST-SEM');
            // Faculty directory metadata (Wireframes pp. 3 & 6)
            $table->string('specialization')->nullable();
            $table->string('office_location')->nullable();
            $table->string('consultation_hours')->nullable();
            $table->jsonb('courses_handled')->default('[]');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('academic_profiles');
        Schema::dropIfExists('users');
    }
};
