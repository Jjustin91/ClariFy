<?php

namespace Tests\Feature;

use App\Models\AcademicProfile;
use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ChannelAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private function createVerifiedUser(string $role, string $instId, string $dept = 'CITC'): User
    {
        $user = new User([
            'institutional_id' => $instId,
            'name' => "User {$instId}",
            'email' => "user.{$instId}@ustp.edu.ph",
            'password' => 'password123',
        ]);
        $user->role = $role;
        $user->verification_status = 'approved';
        $user->save();

        AcademicProfile::create([
            'user_id' => $user->id,
            'campus' => 'CDO Campus',
            'college' => $dept,
            'department' => $dept,
            'program' => "BS {$dept}",
            'year_level' => 3,
            'section' => 'IT3R2',
            'semester_code' => '2026-1ST-SEM',
        ]);

        return $user;
    }

    private function createCourseHub(User $creator, string $dept = 'CITC'): Channel
    {
        return Channel::create([
            'course_code' => 'IT314',
            'name' => '# IT314 SoftEng',
            'description' => 'IT3R2 Scoped Course Hub',
            'channel_type' => 'course_hub',
            'scope_college' => $dept,
            'scope_department' => $dept,
            'scope_section' => 'IT3R2',
            'instructor_name' => $creator->name,
            'created_by' => $creator->id,
        ]);
    }

    public function test_fake_bearer_tokens_and_spoofed_headers_are_rejected_with_401(): void
    {
        $student = $this->createVerifiedUser('student', '2020202020');

        $this->withHeaders([
            'Authorization' => 'Bearer clarify-jwt-student-2020202020-deadbeef',
            'X-Clarify-Institutional-Id' => $student->institutional_id,
            'X-Clarify-User-Id' => (string) $student->id,
        ])->getJson('/api/v1/auth/me')->assertStatus(401);

        $this->withHeaders([
            'Authorization' => 'Bearer student-2020202020',
        ])->getJson('/api/v1/channels')->assertStatus(401);
    }

    public function test_non_member_student_cannot_read_or_post_channel_chat_or_threads(): void
    {
        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $outsiderStudent = $this->createVerifiedUser('student', '2020999999', 'CEA');
        $hub = $this->createCourseHub($faculty, 'CITC');

        Sanctum::actingAs($outsiderStudent);

        $this->getJson("/api/v1/channels/{$hub->id}/chat")->assertStatus(403);
        $this->postJson("/api/v1/channels/{$hub->id}/chat", ['content' => 'Hello'])->assertStatus(403);
        $this->getJson("/api/v1/channels/{$hub->id}/threads")->assertStatus(403);
        $this->postJson("/api/v1/channels/{$hub->id}/threads", [
            'subject_hashtag' => '# Midterm',
            'content' => 'When is the exam?',
        ])->assertStatus(403);
    }

    public function test_pending_member_cannot_read_or_post_until_approved(): void
    {
        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $pendingStudent = $this->createVerifiedUser('student', '2020111111', 'CITC');
        $hub = $this->createCourseHub($faculty, 'CITC');

        DB::table('channel_user')->insert([
            'channel_id' => $hub->id,
            'user_id' => $pendingStudent->id,
            'can_publish' => false,
            'approval_status' => 'pending',
            'joined_at' => now(),
        ]);

        Sanctum::actingAs($pendingStudent);

        $this->getJson("/api/v1/channels/{$hub->id}/chat")->assertStatus(403);
        $this->postJson("/api/v1/channels/{$hub->id}/chat", ['content' => 'Blocked'])->assertStatus(403);

        // Approve membership
        DB::table('channel_user')
            ->where('channel_id', $hub->id)
            ->where('user_id', $pendingStudent->id)
            ->update(['approval_status' => 'approved']);

        $this->getJson("/api/v1/channels/{$hub->id}/chat")->assertStatus(200);
        $this->postJson("/api/v1/channels/{$hub->id}/chat", ['content' => 'Now approved!'])->assertStatus(201);
    }

    public function test_unknown_channel_id_returns_404_instead_of_falling_back_to_first_channel(): void
    {
        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $this->createCourseHub($faculty, 'CITC');

        Sanctum::actingAs($faculty);

        $this->getJson('/api/v1/channels/999999/chat')->assertStatus(404);
        $this->postJson('/api/v1/channels/999999/chat', ['content' => 'Test'])->assertStatus(404);
        $this->getJson('/api/v1/channels/999999/threads')->assertStatus(404);
    }

    public function test_only_course_admins_can_edit_delete_or_manage_members(): void
    {
        $creatorStudent = $this->createVerifiedUser('student', '2020202020', 'CITC');
        $otherStudent = $this->createVerifiedUser('student', '2020303030', 'CITC');
        $hub = $this->createCourseHub($creatorStudent, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $creatorStudent->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $otherStudent->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
        ]);

        // Non-admin student cannot edit, manage members, or delete
        Sanctum::actingAs($otherStudent);
        $this->patchJson("/api/v1/channels/{$hub->id}", [
            'course_code' => 'IT314',
            'name' => '# Hijacked',
        ])->assertStatus(403);
        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => '2020404040',
            'action' => 'add',
        ])->assertStatus(403);
        $this->deleteJson("/api/v1/channels/{$hub->id}")->assertStatus(403);

        // Creator (Course Admin) can edit and delete
        Sanctum::actingAs($creatorStudent);
        $this->patchJson("/api/v1/channels/{$hub->id}", [
            'course_code' => 'IT314',
            'name' => '# IT314 Updated',
        ])->assertStatus(200);
        $this->deleteJson("/api/v1/channels/{$hub->id}")->assertStatus(200);
    }

    public function test_announcement_creation_enforces_role_and_channel_membership(): void
    {
        $citcFaculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $ceaFaculty = $this->createVerifiedUser('faculty', '10499', 'CEA');
        $student = $this->createVerifiedUser('student', '2020202020', 'CITC');
        $citcHub = $this->createCourseHub($citcFaculty, 'CITC');

        // Student cannot create announcements
        Sanctum::actingAs($student);
        $this->postJson('/api/v1/announcements', [
            'channel_id' => $citcHub->id,
            'title' => 'Student Memo',
            'content' => 'Not allowed',
        ])->assertStatus(403);

        // Out-of-scope CEA faculty who is not a member of CITC hub cannot publish to it
        Sanctum::actingAs($ceaFaculty);
        $this->postJson('/api/v1/announcements', [
            'channel_id' => $citcHub->id,
            'title' => 'Cross Dept Memo',
            'content' => 'Not allowed',
        ])->assertStatus(403);

        // Creator CITC faculty can publish to their CITC hub
        Sanctum::actingAs($citcFaculty);
        $this->postJson('/api/v1/announcements', [
            'channel_id' => $citcHub->id,
            'title' => 'Valid Course Hub Notice',
            'content' => 'Lab quiz on Friday.',
        ])->assertStatus(201);
    }
}
