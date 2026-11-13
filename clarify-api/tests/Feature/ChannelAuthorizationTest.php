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

    public function test_approve_pending_request_and_student_sees_hub_as_joined_in_get_channels(): void
    {
        $admin = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020555555', 'CITC');
        $hub = $this->createCourseHub($admin, 'CITC');

        DB::table('channel_user')->insert([
            'channel_id' => $hub->id,
            'user_id' => $admin->id,
            'can_publish' => true,
            'approval_status' => 'approved',
            'joined_at' => now(),
        ]);

        // Student submits join request
        Sanctum::actingAs($student);
        $this->postJson("/api/v1/channels/{$hub->id}/join")
            ->assertStatus(200);

        // Before approval, student sees themselves in pending_requests, not roster
        $beforeChannels = $this->getJson('/api/v1/channels')
            ->assertStatus(200)
            ->json('data');
        $hubBefore = collect($beforeChannels)->firstWhere('id', $hub->id);
        $this->assertNotNull($hubBefore);
        $this->assertEmpty($hubBefore['roster']);
        $this->assertCount(1, $hubBefore['pending_requests']);
        $this->assertSame($student->institutional_id, $hubBefore['pending_requests'][0]['institutional_id']);

        // Course Admin approves the pending join request
        Sanctum::actingAs($admin);
        $approveResponse = $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student->institutional_id,
            'action' => 'approve',
        ])->assertStatus(200);

        $this->assertEmpty($approveResponse->json('data.pending_requests'));
        $rosterIds = collect($approveResponse->json('data.roster'))->pluck('institutional_id')->all();
        $this->assertContains($student->institutional_id, $rosterIds);

        // Student immediately sees the Course Hub as joined in GET /channels
        Sanctum::actingAs($student);
        $afterChannels = $this->getJson('/api/v1/channels')
            ->assertStatus(200)
            ->json('data');
        $hubAfter = collect($afterChannels)->firstWhere('id', $hub->id);
        $this->assertNotNull($hubAfter);
        $this->assertEmpty($hubAfter['pending_requests']);
        $this->assertCount(1, $hubAfter['roster']);
        $this->assertSame($student->institutional_id, $hubAfter['roster'][0]['institutional_id']);
    }

    public function test_approve_again_returns_409_with_fresh_channel_resource(): void
    {
        $adminA = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $adminB = $this->createVerifiedUser('dept_head', '10400', 'CITC');
        $student = $this->createVerifiedUser('student', '2020666666', 'CITC');
        $hub = $this->createCourseHub($adminA, 'CITC');

        DB::table('channel_user')->insert([
            'channel_id' => $hub->id,
            'user_id' => $student->id,
            'can_publish' => false,
            'approval_status' => 'pending',
            'joined_at' => now(),
        ]);

        // Admin A approves first -> 200 OK
        Sanctum::actingAs($adminA);
        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student->institutional_id,
            'action' => 'approve',
        ])->assertStatus(200);

        // Admin B approves the already-approved request -> 409 Conflict with fresh ChannelResource
        Sanctum::actingAs($adminB);
        $conflictResponse = $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student->institutional_id,
            'action' => 'approve',
        ])->assertStatus(409)
          ->assertJsonPath('status', 409)
          ->assertJsonPath('message', 'This request was already approved/declined by another Course Admin.');

        $this->assertEmpty($conflictResponse->json('data.pending_requests'));
        $rosterIds = collect($conflictResponse->json('data.roster'))->pluck('institutional_id')->all();
        $this->assertContains($student->institutional_id, $rosterIds);
    }

    public function test_reject_after_approve_returns_409_and_member_stays_approved(): void
    {
        $adminA = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $adminB = $this->createVerifiedUser('dept_head', '10400', 'CITC');
        $student = $this->createVerifiedUser('student', '2020777777', 'CITC');
        $hub = $this->createCourseHub($adminA, 'CITC');

        DB::table('channel_user')->insert([
            'channel_id' => $hub->id,
            'user_id' => $student->id,
            'can_publish' => false,
            'approval_status' => 'pending',
            'joined_at' => now(),
        ]);

        // Admin A approves
        Sanctum::actingAs($adminA);
        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student->institutional_id,
            'action' => 'approve',
        ])->assertStatus(200);

        // Admin B clicks Decline on stale UI -> 409 Conflict and student stays approved
        Sanctum::actingAs($adminB);
        $conflictResponse = $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student->institutional_id,
            'action' => 'reject',
        ])->assertStatus(409)
          ->assertJsonPath('status', 409)
          ->assertJsonPath('message', 'This request was already approved/declined by another Course Admin.');

        $pivotRow = DB::table('channel_user')
            ->where('channel_id', $hub->id)
            ->where('user_id', $student->id)
            ->first();
        $this->assertNotNull($pivotRow);
        $this->assertSame('approved', $pivotRow->approval_status);

        $rosterIds = collect($conflictResponse->json('data.roster'))->pluck('institutional_id')->all();
        $this->assertContains($student->institutional_id, $rosterIds);
    }

    public function test_non_admin_gets_403_when_approving_or_rejecting_join_requests(): void
    {
        $admin = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $approvedStudent = $this->createVerifiedUser('student', '2020111111', 'CITC');
        $pendingStudent = $this->createVerifiedUser('student', '2020222222', 'CITC');
        $hub = $this->createCourseHub($admin, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $approvedStudent->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $pendingStudent->id,
                'can_publish' => false,
                'approval_status' => 'pending',
                'joined_at' => now(),
            ],
        ]);

        Sanctum::actingAs($approvedStudent);

        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $pendingStudent->institutional_id,
            'action' => 'approve',
        ])->assertStatus(403);

        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $pendingStudent->institutional_id,
            'action' => 'reject',
        ])->assertStatus(403);
    }

    public function test_pending_requests_are_hidden_from_non_admins_in_roster_endpoint(): void
    {
        $admin = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $approvedStudent = $this->createVerifiedUser('student', '2020111111', 'CITC');
        $pendingStudent = $this->createVerifiedUser('student', '2020222222', 'CITC');
        $hub = $this->createCourseHub($admin, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $admin->id,
                'can_publish' => true,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $approvedStudent->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $pendingStudent->id,
                'can_publish' => false,
                'approval_status' => 'pending',
                'joined_at' => now(),
            ],
        ]);

        // Course Admin receives both roster and pending_requests
        Sanctum::actingAs($admin);
        $adminRosterRes = $this->getJson("/api/v1/channels/{$hub->id}/roster")
            ->assertStatus(200);
        $this->assertCount(2, $adminRosterRes->json('data.roster'));
        $this->assertCount(1, $adminRosterRes->json('data.pending_requests'));
        $this->assertSame(
            $pendingStudent->institutional_id,
            $adminRosterRes->json('data.pending_requests.0.institutional_id')
        );

        // Non-admin approved student receives roster, but pending_requests is empty
        Sanctum::actingAs($approvedStudent);
        $studentRosterRes = $this->getJson("/api/v1/channels/{$hub->id}/roster")
            ->assertStatus(200);
        $this->assertCount(2, $studentRosterRes->json('data.roster'));
        $this->assertSame([], $studentRosterRes->json('data.pending_requests'));
    }

    public function test_read_reach_counts_only_approved_enrolled_students_and_excludes_faculty_pending_and_removed(): void
    {
        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student1 = $this->createVerifiedUser('student', '2020100001', 'CITC');
        $student2 = $this->createVerifiedUser('student', '2020100002', 'CITC');
        $student3 = $this->createVerifiedUser('student', '2020100003', 'CITC');
        $pendingStudent = $this->createVerifiedUser('student', '2020100004', 'CITC');
        $hub = $this->createCourseHub($faculty, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $faculty->id,
                'can_publish' => true,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $student1->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $student2->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $student3->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $pendingStudent->id,
                'can_publish' => false,
                'approval_status' => 'pending',
                'joined_at' => now(),
            ],
        ]);

        // Faculty publishes an announcement (publisher read is recorded automatically)
        Sanctum::actingAs($faculty);
        $createRes = $this->postJson('/api/v1/announcements', [
            'channel_id' => $hub->id,
            'title' => 'Midterm Coverage',
            'content' => 'Chapters 1 to 4.',
        ])->assertStatus(201);

        $annId = (int) $createRes->json('data.id');
        // Faculty publisher acknowledgment is NOT counted toward student read_reach
        $this->assertSame(3, $createRes->json('data.read_reach.enrolled_total'));
        $this->assertSame(0, $createRes->json('data.read_reach.acknowledged_count'));
        $this->assertSame(0, $createRes->json('data.read_reach.percentage'));

        // Student 1 and Student 2 acknowledge
        Sanctum::actingAs($student1);
        $this->postJson("/api/v1/announcements/{$annId}/acknowledge")
            ->assertStatus(200)
            ->assertJsonPath('read_reach.acknowledged_count', 1)
            ->assertJsonPath('read_reach.enrolled_total', 3)
            ->assertJsonPath('read_reach.percentage', 33.3);

        Sanctum::actingAs($student2);
        $this->postJson("/api/v1/announcements/{$annId}/acknowledge")
            ->assertStatus(200)
            ->assertJsonPath('read_reach.acknowledged_count', 2)
            ->assertJsonPath('read_reach.enrolled_total', 3)
            ->assertJsonPath('read_reach.percentage', 66.7);

        // Even if a pending student had a read row, they are not counted
        DB::table('announcement_reads')->insert([
            'announcement_id' => $annId,
            'user_id' => $pendingStudent->id,
            'acknowledged_at' => now(),
        ]);

        $feedRes = $this->getJson("/api/v1/announcements?channel_id={$hub->id}")
            ->assertStatus(200);
        $this->assertSame(2, $feedRes->json('data.0.read_reach.acknowledged_count'));
        $this->assertSame(3, $feedRes->json('data.0.read_reach.enrolled_total'));
        $this->assertSame(66.7, $feedRes->json('data.0.read_reach.percentage'));

        // Removing student2 from the hub excludes their old read row and updates enrolled_total to 2
        Sanctum::actingAs($faculty);
        $this->postJson("/api/v1/channels/{$hub->id}/members", [
            'institutional_id' => $student2->institutional_id,
            'action' => 'remove',
        ])->assertStatus(200);

        $afterRemoveFeed = $this->getJson("/api/v1/announcements?channel_id={$hub->id}")
            ->assertStatus(200);
        $this->assertSame(1, $afterRemoveFeed->json('data.0.read_reach.acknowledged_count'));
        $this->assertSame(2, $afterRemoveFeed->json('data.0.read_reach.enrolled_total'));
        $this->assertSame(50, $afterRemoveFeed->json('data.0.read_reach.percentage'));
    }

    public function test_channel_resource_returns_approved_faculty_and_students_count(): void
    {
        $studentCreator = $this->createVerifiedUser('student', '2020202020', 'CITC');
        $approvedFaculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $pendingFaculty = $this->createVerifiedUser('faculty', '10499', 'CITC');
        $hub = $this->createCourseHub($studentCreator, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $studentCreator->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $approvedFaculty->id,
                'can_publish' => true,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $pendingFaculty->id,
                'can_publish' => true,
                'approval_status' => 'pending',
                'joined_at' => now(),
            ],
        ]);

        Sanctum::actingAs($studentCreator);
        $channelsRes = $this->getJson('/api/v1/channels')->assertStatus(200);
        $channelData = collect($channelsRes->json('data'))->firstWhere('id', $hub->id);

        $this->assertNotNull($channelData);
        $this->assertSame(2, $channelData['members_count']);
        $this->assertSame(1, $channelData['students_count']);
        $this->assertCount(1, $channelData['faculty']);
        $this->assertSame($approvedFaculty->id, $channelData['faculty'][0]['id']);
        $this->assertSame($approvedFaculty->name, $channelData['faculty'][0]['name']);
        $this->assertSame('faculty', $channelData['faculty'][0]['role']);
    }

    public function test_announcement_attachments_upload_update_replace_remove_reject_executables_and_migrate(): void
    {
        \Illuminate\Support\Facades\Storage::fake('public');

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $hub = $this->createCourseHub($faculty, 'CITC');
        DB::table('channel_user')->insert([
            'channel_id' => $hub->id,
            'user_id' => $faculty->id,
            'can_publish' => true,
            'approval_status' => 'approved',
            'joined_at' => now(),
        ]);

        Sanctum::actingAs($faculty);

        // 1. Create announcement without attachment
        $createRes = $this->postJson('/api/v1/announcements', [
            'channel_id' => $hub->id,
            'title' => 'Lab Guidelines',
            'content' => 'Initial text body.',
        ])->assertStatus(201);
        $annId = (int) $createRes->json('data.id');

        // 2. Reject .exe and .php uploads with 422 on attachment
        $exeFile = \Illuminate\Http\UploadedFile::fake()->create('malware.exe', 128, 'application/x-msdownload');
        $this->post("/api/v1/announcements/{$annId}", [
            '_method' => 'PATCH',
            'title' => 'Lab Guidelines',
            'content' => 'Attempt exe upload',
            'attachment' => $exeFile,
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['attachment']);

        $phpFile = \Illuminate\Http\UploadedFile::fake()->create('shell.php', 64, 'application/x-php');
        $this->post("/api/v1/announcements/{$annId}", [
            '_method' => 'PATCH',
            'title' => 'Lab Guidelines',
            'content' => 'Attempt php upload',
            'attachment' => $phpFile,
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['attachment']);

        // 3. Update announcement with a 2 MB image via multipart POST + _method=PATCH
        $image2Mb = \Illuminate\Http\UploadedFile::fake()->image('schedule.png', 400, 400)->size(2048);
        $updateImgRes = $this->post("/api/v1/announcements/{$annId}", [
            '_method' => 'PATCH',
            'title' => 'Lab Guidelines Updated',
            'content' => 'Please see the attached 2 MB schedule image.',
            'attachment' => $image2Mb,
        ], ['Accept' => 'application/json'])->assertStatus(200);

        $firstStoredPath = \App\Models\Announcement::findOrFail($annId)->attachment_url;
        $this->assertNotNull($firstStoredPath);
        $this->assertStringStartsWith("announcements/{$hub->id}/", $firstStoredPath);
        \Illuminate\Support\Facades\Storage::disk('public')->assertExists($firstStoredPath);
        $this->assertSame('image', $updateImgRes->json('data.attachment_type'));
        $this->assertSame('schedule.png', $updateImgRes->json('data.attachment_name'));

        // Feed response must not contain any data: base64 strings
        $feedJson = $this->getJson("/api/v1/announcements?channel_id={$hub->id}")
            ->assertStatus(200)
            ->getContent();
        $this->assertStringNotContainsString('data:', (string) $feedJson);

        // 4. Replace attachment with a PDF -> old image file is deleted from disk
        $pdfFile = \Illuminate\Http\UploadedFile::fake()->create('syllabus.pdf', 512, 'application/pdf');
        $replaceRes = $this->post("/api/v1/announcements/{$annId}", [
            '_method' => 'PATCH',
            'title' => 'Lab Guidelines PDF',
            'content' => 'Replaced with PDF.',
            'attachment' => $pdfFile,
        ], ['Accept' => 'application/json'])->assertStatus(200);

        $secondStoredPath = \App\Models\Announcement::findOrFail($annId)->attachment_url;
        \Illuminate\Support\Facades\Storage::disk('public')->assertMissing($firstStoredPath);
        \Illuminate\Support\Facades\Storage::disk('public')->assertExists($secondStoredPath);
        $this->assertSame('pdf', $replaceRes->json('data.attachment_type'));

        // 5. Remove attachment -> file is deleted and fields are null
        $removeRes = $this->post("/api/v1/announcements/{$annId}", [
            '_method' => 'PATCH',
            'title' => 'Lab Guidelines Text Only',
            'content' => 'Removed attachment.',
            'remove_attachment' => '1',
        ], ['Accept' => 'application/json'])->assertStatus(200);

        \Illuminate\Support\Facades\Storage::disk('public')->assertMissing($secondStoredPath);
        $this->assertNull($removeRes->json('data.attachment_url'));
        $this->assertNull($removeRes->json('data.attachment_name'));
        $this->assertNull($removeRes->json('data.attachment_type'));

        // 6. Test announcements:migrate-attachments command idempotency
        $tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
        $legacyAnn = \App\Models\Announcement::create([
            'channel_id' => $hub->id,
            'published_by' => $faculty->id,
            'title' => 'Legacy Embedded',
            'content' => '__CLARIFY_ANN_MEDIA__' . json_encode([
                'url' => $tinyPngBase64,
                'name' => 'legacy.png',
                'type' => 'image',
            ]) . "\nLegacy body text.",
            'published_at' => now(),
        ]);

        $this->artisan('announcements:migrate-attachments')->assertExitCode(0);
        $legacyAnn->refresh();
        $this->assertSame('Legacy body text.', $legacyAnn->content);
        $this->assertStringStartsWith("announcements/{$hub->id}/", (string) $legacyAnn->attachment_url);
        \Illuminate\Support\Facades\Storage::disk('public')->assertExists($legacyAnn->attachment_url);

        $migratedPath = $legacyAnn->attachment_url;
        // Second run is a no-op
        $this->artisan('announcements:migrate-attachments')->assertExitCode(0);
        $legacyAnn->refresh();
        $this->assertSame($migratedPath, $legacyAnn->attachment_url);
    }

    public function test_channel_chat_attachments_upload_validate_authorize_and_broadcast_metadata_without_base64(): void
    {
        \Illuminate\Support\Facades\Storage::fake('public');
        \Illuminate\Support\Facades\Event::fake([\App\Events\RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202020', 'CITC');
        $outsider = $this->createVerifiedUser('student', '2020999999', 'CEA');
        $hub = $this->createCourseHub($faculty, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $faculty->id,
                'can_publish' => true,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $student->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
        ]);

        // 1. Non-member gets 403 on multipart attachment upload
        Sanctum::actingAs($outsider);
        $blockedImg = \Illuminate\Http\UploadedFile::fake()->image('outsider.png', 100, 100);
        $this->post("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Blocked upload',
            'attachment' => $blockedImg,
        ], ['Accept' => 'application/json'])->assertStatus(403);

        // 2. Wrong channel id gets 404
        Sanctum::actingAs($student);
        $this->post('/api/v1/channels/999999/messages', [
            'content' => 'Missing channel',
        ], ['Accept' => 'application/json'])->assertStatus(404);

        // 3. Text-only message still works (201) and returns attachment = null
        $textRes = $this->postJson("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Hello classmates!',
            'temp_id' => 'temp-text-1',
        ])->assertStatus(201);
        $this->assertSame('Hello classmates!', $textRes->json('data.content'));
        $this->assertSame('temp-text-1', $textRes->json('data.temp_id'));
        $this->assertNull($textRes->json('data.attachment'));

        // 4. Image upload returns 201 with attachment metadata (even with empty text content)
        $imageFile = \Illuminate\Http\UploadedFile::fake()->image('whiteboard.jpg', 640, 480)->size(512);
        $imgRes = $this->post("/api/v1/channels/{$hub->id}/messages", [
            'content' => '',
            'temp_id' => 'temp-img-1',
            'attachment' => $imageFile,
        ], ['Accept' => 'application/json'])->assertStatus(201);

        $this->assertSame('', $imgRes->json('data.content'));
        $this->assertSame('image', $imgRes->json('data.attachment.type'));
        $this->assertSame('whiteboard.jpg', $imgRes->json('data.attachment.name'));
        $this->assertNotEmpty($imgRes->json('data.attachment.url'));
        $this->assertIsInt($imgRes->json('data.attachment.size'));

        $imgMsg = Message::findOrFail((int) $imgRes->json('data.id'));
        $this->assertStringStartsWith("chat/{$hub->id}/", (string) $imgMsg->attachment_url);
        \Illuminate\Support\Facades\Storage::disk('public')->assertExists($imgMsg->attachment_url);

        // 5. PDF document upload returns 201 with type = document
        $pdfFile = \Illuminate\Http\UploadedFile::fake()->create('reviewer.pdf', 1024, 'application/pdf');
        $pdfRes = $this->post("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Attached reviewer PDF',
            'attachment' => $pdfFile,
        ], ['Accept' => 'application/json'])->assertStatus(201);

        $this->assertSame('document', $pdfRes->json('data.attachment.type'));
        $this->assertSame('reviewer.pdf', $pdfRes->json('data.attachment.name'));

        // 6. Voice note (.webm) upload returns 201 with type = voice
        $voiceFile = \Illuminate\Http\UploadedFile::fake()->create('voice-note.webm', 256, 'audio/webm');
        $voiceRes = $this->post("/api/v1/channels/{$hub->id}/messages", [
            'attachment' => $voiceFile,
        ], ['Accept' => 'application/json'])->assertStatus(201);

        $this->assertSame('voice', $voiceRes->json('data.attachment.type'));
        $this->assertSame('voice-note.webm', $voiceRes->json('data.attachment.name'));

        // 7. File over 10 MB (11 MB = 11264 KB) gets 422
        $hugeFile = \Illuminate\Http\UploadedFile::fake()->create('huge.pdf', 11264, 'application/pdf');
        $this->post("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Too large',
            'attachment' => $hugeFile,
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['attachment']);

        // 8. Executable/script files (.php and .exe) get 422
        $phpFile = \Illuminate\Http\UploadedFile::fake()->create('exploit.php', 32, 'application/x-php');
        $this->post("/api/v1/channels/{$hub->id}/messages", [
            'attachment' => $phpFile,
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['attachment']);

        $exeFile = \Illuminate\Http\UploadedFile::fake()->create('trojan.exe', 64, 'application/x-msdownload');
        $this->post("/api/v1/channels/{$hub->id}/messages", [
            'attachment' => $exeFile,
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['attachment']);

        // 9. GET /messages index returns attachment metadata on every message
        $indexRes = $this->getJson("/api/v1/channels/{$hub->id}/messages")
            ->assertStatus(200);
        $list = collect($indexRes->json('data'));
        $this->assertCount(4, $list);

        $fetchedImgMsg = $list->firstWhere('id', $imgMsg->id);
        $this->assertNotNull($fetchedImgMsg);
        $this->assertSame('image', $fetchedImgMsg['attachment']['type']);
        $this->assertSame('whiteboard.jpg', $fetchedImgMsg['attachment']['name']);
        $this->assertStringNotContainsString('data:', json_encode($fetchedImgMsg));

        // 10. Broadcast payload contains metadata only and no base64 strings
        \Illuminate\Support\Facades\Event::assertDispatched(
            \App\Events\RealtimeStateUpdated::class,
            function (\App\Events\RealtimeStateUpdated $event) use ($imgMsg): bool {
                if ($event->type !== 'chat.message' || ($event->message['id'] ?? null) !== $imgMsg->id) {
                    return false;
                }
                $serialized = json_encode($event->broadcastWith());
                return is_string($serialized)
                    && ! str_contains($serialized, 'data:')
                    && ! str_contains($serialized, ';base64,')
                    && ($event->message['attachment']['type'] ?? null) === 'image'
                    && ($event->message['attachment']['name'] ?? null) === 'whiteboard.jpg';
            }
        );
    }

    public function test_channel_chat_unsend_enforces_sender_policy_scrubs_content_deletes_file_is_idempotent_and_preserves_cursor_pagination(): void
    {
        \Illuminate\Support\Facades\Storage::fake('public');
        \Illuminate\Support\Facades\Event::fake([\App\Events\RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $studentA = $this->createVerifiedUser('student', '2020202020', 'CITC');
        $studentB = $this->createVerifiedUser('student', '2020303030', 'CITC');
        $hub = $this->createCourseHub($faculty, 'CITC');
        $otherHub = $this->createCourseHub($faculty, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $faculty->id,
                'can_publish' => true,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $studentA->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $hub->id,
                'user_id' => $studentB->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
            [
                'channel_id' => $otherHub->id,
                'user_id' => $studentA->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
        ]);

        // Student A sends 3 messages (middle one has an image attachment)
        Sanctum::actingAs($studentA);
        $msg1Res = $this->postJson("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'First message',
        ])->assertStatus(201);
        $msg1Id = (int) $msg1Res->json('data.id');
        $this->assertFalse($msg1Res->json('data.is_unsent'));

        $imgFile = \Illuminate\Http\UploadedFile::fake()->image('secret-diagram.png', 200, 200);
        $msg2Res = $this->post("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Message with secret attachment',
            'attachment' => $imgFile,
        ], ['Accept' => 'application/json'])->assertStatus(201);
        $msg2Id = (int) $msg2Res->json('data.id');
        $storedPath = Message::findOrFail($msg2Id)->attachment_url;
        $this->assertNotNull($storedPath);
        \Illuminate\Support\Facades\Storage::disk('public')->assertExists($storedPath);

        $msg3Res = $this->postJson("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Third message',
        ])->assertStatus(201);
        $msg3Id = (int) $msg3Res->json('data.id');

        // 1. Non-sender (Student B or even Faculty) gets 403 when trying to unsend Student A's message
        Sanctum::actingAs($studentB);
        $this->deleteJson("/api/v1/channels/{$hub->id}/messages/{$msg2Id}")->assertStatus(403);

        Sanctum::actingAs($faculty);
        $this->deleteJson("/api/v1/channels/{$hub->id}/messages/{$msg2Id}")->assertStatus(403);

        // 2. Wrong channel ID or non-existent message ID returns 404
        Sanctum::actingAs($studentA);
        $this->deleteJson("/api/v1/channels/{$otherHub->id}/messages/{$msg2Id}")->assertStatus(404);
        $this->deleteJson("/api/v1/channels/{$hub->id}/messages/999999")->assertStatus(404);

        // 3. Sender (Student A) unsends own message -> 200 OK, scrubbed content & null attachment, file deleted
        $unsendRes = $this->deleteJson("/api/v1/channels/{$hub->id}/messages/{$msg2Id}")
            ->assertStatus(200);
        $this->assertTrue($unsendRes->json('data.is_unsent'));
        $this->assertSame('', $unsendRes->json('data.content'));
        $this->assertNull($unsendRes->json('data.attachment'));
        \Illuminate\Support\Facades\Storage::disk('public')->assertMissing($storedPath);

        \Illuminate\Support\Facades\Event::assertDispatched(
            \App\Events\RealtimeStateUpdated::class,
            function (\App\Events\RealtimeStateUpdated $event) use ($hub, $msg2Id): bool {
                $payload = $event->broadcastWith();
                return $event->type === 'chat.message_unsent'
                    && ($payload['channel_id'] ?? null) === $hub->id
                    && ($payload['message_id'] ?? null) === $msg2Id
                    && ! isset($payload['message']);
            }
        );

        // 4. Unsending an already-unsent message returns 200 idempotently
        $this->deleteJson("/api/v1/channels/{$hub->id}/messages/{$msg2Id}")
            ->assertStatus(200)
            ->assertJsonPath('data.is_unsent', true)
            ->assertJsonPath('data.content', '')
            ->assertJsonPath('data.attachment', null);

        // 5. GET /messages index returns unsent message with is_unsent=true, empty content, attachment=null, and preserves cursor pagination
        $page1 = $this->getJson("/api/v1/channels/{$hub->id}/messages?limit=2")
            ->assertStatus(200);
        $this->assertTrue($page1->json('meta.has_more'));
        $this->assertSame($msg2Id, $page1->json('meta.next_before'));
        $page1Items = collect($page1->json('data'));
        $this->assertCount(2, $page1Items);

        $unsentInFeed = $page1Items->firstWhere('id', $msg2Id);
        $this->assertNotNull($unsentInFeed);
        $this->assertTrue($unsentInFeed['is_unsent']);
        $this->assertSame('', $unsentInFeed['content']);
        $this->assertNull($unsentInFeed['attachment']);
        $this->assertStringNotContainsString('secret', json_encode($unsentInFeed));

        $page2 = $this->getJson("/api/v1/channels/{$hub->id}/messages?before={$msg2Id}&limit=2")
            ->assertStatus(200);
        $this->assertFalse($page2->json('meta.has_more'));
        $this->assertCount(1, $page2->json('data'));
        $this->assertSame($msg1Id, $page2->json('data.0.id'));
    }
}

