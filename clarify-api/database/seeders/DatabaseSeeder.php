<?php

namespace Database\Seeders;

use App\Models\AcademicProfile;
use App\Models\Channel;
use App\Models\PrismsSyncLog;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Remove any legacy pre-seeded demo student/faculty accounts if re-seeding
        User::whereIn('institutional_id', ['2020202020', '10492', '2023309999'])->delete();

        // 1. Seed ONLY the IT Administrator Account (Faculty & Students register via /register)
        $admin = User::updateOrCreate(
            ['institutional_id' => '90001'],
            [
                'name' => 'Engr. Makima Cruz',
                'email' => 'icto.admin@ustp.edu.ph',
                'password' => 'ustp2026',
                'contact_number' => '+63 917 900 0001',
            ]
        );
        $admin->role = 'it_admin';
        $admin->verification_status = 'approved';
        $admin->verified_at = now();
        $admin->save();

        AcademicProfile::updateOrCreate(
            ['user_id' => $admin->id],
            [
                'campus' => 'CDO Campus',
                'college' => 'ICTO',
                'department' => 'CITC',
                'section' => 'Registrar & ICTO',
                'semester_code' => '2026-1ST-SEM',
            ]
        );

        // 2. Default Scoped Course Hub Channel
        $it314 = Channel::firstOrCreate(
            ['course_code' => 'IT314'],
            [
                'name' => '# IT314 SoftEng',
                'description' => 'IT3R2 — Software Engineering Hub (Agile Sprint Reviews, SRS & Capstone Architecture)',
                'channel_type' => 'course_hub',
                'scope_college' => 'CITC',
                'scope_department' => 'CITC',
                'scope_section' => 'IT3R2',
                'instructor_name' => 'CITC Instructor',
                'created_by' => $admin->id,
            ]
        );

        $it314->members()->syncWithoutDetaching([
            $admin->id => ['can_publish' => true, 'joined_at' => now()],
        ]);

        // 3. Initial PRISMS Sync Log
        if (PrismsSyncLog::count() === 0) {
            PrismsSyncLog::create([
                'semester_code' => '2026-1ST-SEM',
                'triggered_by' => 'System Cron (SyncPrismsRoster)',
                'sync_type' => 'scheduled_midnight',
                'total_updated' => 1,
                'channels_provisioned' => 1,
                'status' => 'completed',
                'duration_ms' => 420,
                'executed_at' => now()->subHours(1),
            ]);
        }
    }
}
