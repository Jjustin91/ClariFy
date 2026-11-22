<?php

namespace Tests\Feature;

use App\Models\AcademicProfile;
use App\Models\Announcement;
use App\Models\AnnouncementAudit;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminConsoleTest extends TestCase
{
    use RefreshDatabase;

    private function createUserWithProfile(array $userAttrs, array $profileAttrs = []): User
    {
        $user = User::factory()->create(array_merge([
            'verification_status' => 'approved',
        ], $userAttrs));

        AcademicProfile::create(array_merge([
            'user_id' => $user->id,
            'campus' => 'CDO Campus',
            'college' => 'CITC',
            'department' => 'CITC',
            'program' => 'BSIT',
            'year_level' => 3,
            'section' => 'IT3R2',
            'semester_code' => '2026-1ST-SEM',
        ], $profileAttrs));

        return $user->fresh('academicProfile');
    }

    public function test_non_admin_users_receive_403_on_admin_endpoints(): void
    {
        $student = $this->createUserWithProfile([
            'role' => 'student',
            'institutional_id' => '2026000001',
            'email' => 'student.test@ustp.edu.ph',
        ]);

        Sanctum::actingAs($student);

        $this->getJson('/api/v1/admin/metrics')->assertStatus(403);
        $this->getJson('/api/v1/admin/users')->assertStatus(403);
        $this->getJson('/api/v1/admin/users/pending')->assertStatus(403);
        $this->postJson('/api/v1/admin/sync-prisms', ['semester_code' => '2026-1ST-SEM'])->assertStatus(403);
    }

    public function test_admin_metrics_reflect_actual_database_accounts_without_hardcoded_floors(): void
    {
        $admin = $this->createUserWithProfile([
            'role' => 'it_admin',
            'institutional_id' => '900001',
            'email' => 'admin@ustp.edu.ph',
        ]);
        $student = $this->createUserWithProfile([
            'role' => 'student',
            'institutional_id' => '2026000002',
            'email' => 'student2@ustp.edu.ph',
        ]);
        $this->createUserWithProfile([
            'role' => 'student',
            'verification_status' => 'pending',
            'institutional_id' => '2026000003',
            'email' => 'pending@ustp.edu.ph',
        ]);
        $this->createUserWithProfile([
            'role' => 'faculty',
            'verification_status' => 'rejected',
            'institutional_id' => '100004',
            'email' => 'rejected@ustp.edu.ph',
        ], ['department' => 'CEA']);

        $channel = Channel::create([
            'course_code' => 'IT314',
            'name' => 'IT314 Software Engineering',
            'channel_type' => 'course_hub',
            'scope_college' => 'CITC',
            'scope_department' => 'CITC',
            'scope_section' => 'IT3R2',
            'created_by' => $admin->id,
        ]);

        $ann = Announcement::create([
            'channel_id' => $channel->id,
            'publisher_id' => $admin->id,
            'title' => 'Urgent Notice',
            'content' => 'Real content',
            'is_urgent' => true,
            'trigger_sms_fallback' => true,
            'status' => 'published',
            'published_at' => now(),
        ]);

        AnnouncementAudit::create([
            'announcement_id' => $ann->id,
            'editor_id' => $admin->id,
            'previous_title' => 'Old Title',
            'new_title' => 'Urgent Notice',
            'previous_content' => 'Old',
            'new_content' => 'Real content',
            'edited_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/v1/admin/metrics')->assertOk();
        $data = $response->json('data');

        $this->assertSame(2, $data['active_users_count']);
        $this->assertSame(2, $data['verified_accounts_count']);
        $this->assertSame(4, $data['total_registered_users_count']);
        $this->assertSame(1, $data['pending_verifications_count']);
        $this->assertSame(1, $data['rejected_verifications_count']);
        $this->assertSame(1, $data['urgent_announcements_count']);
        $this->assertSame(1, $data['sms_fallback_dispatched_count']);
        $this->assertSame(1, $data['announcement_audits_total']);
        $this->assertIsNumeric($data['api_latency_ms']);

        // Status filter returns both pending and rejected when status=all
        $allQueue = $this->getJson('/api/v1/admin/users/pending?status=all')->assertOk();
        $this->assertCount(2, $allQueue->json('data'));

        // Self-demotion is blocked
        $this->patchJson("/api/v1/admin/users/{$admin->id}/role", [
            'role' => 'student',
            'department' => 'CITC',
        ])->assertStatus(422);

        // Updating another user's role & department works
        $this->patchJson("/api/v1/admin/users/{$student->id}/role", [
            'role' => 'faculty',
            'department' => 'CEA',
        ])->assertOk();
    }
}
