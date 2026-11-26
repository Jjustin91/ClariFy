<?php

namespace Tests\Feature;

use App\Events\RealtimeStateUpdated;
use App\Models\AcademicProfile;
use App\Models\Announcement;
use App\Models\Channel;
use App\Models\User;
use App\Support\ApiCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementOwnershipAndLeaveTest extends TestCase
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

    private function createChannel(User $creator, string $type = 'course_hub', string $code = 'IT314', string $dept = 'CITC'): Channel
    {
        return Channel::create([
            'course_code' => $code,
            'name' => "# {$code} Channel",
            'description' => "{$type} scoped channel",
            'channel_type' => $type,
            'scope_college' => $dept,
            'scope_department' => $dept,
            'scope_section' => $type === 'course_hub' ? 'IT3R2' : null,
            'instructor_name' => $creator->name,
            'created_by' => $creator->id,
        ]);
    }

    private function enrollApproved(Channel $channel, User $user): void
    {
        DB::table('channel_user')->insert([
            'channel_id' => $channel->id,
            'user_id' => $user->id,
            'can_publish' => $user->canPublishOrManage(),
            'approval_status' => 'approved',
            'joined_at' => now(),
        ]);
    }

    public function test_announcement_ownership_policy_enforces_faculty_dept_head_and_student_rules(): void
    {
        $facultyA = $this->createVerifiedUser('faculty', '10491', 'CITC');
        $facultyB = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $deptHead = $this->createVerifiedUser('dept_head', '10400', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202020', 'CITC');

        $hub = $this->createChannel($facultyA, 'course_hub', 'IT314');
        $uniChannel = $this->createChannel($deptHead, 'university', 'CAMPUS');
        $deptChannel = $this->createChannel($deptHead, 'department', 'CITC-DEPT');

        $this->enrollApproved($hub, $facultyA);
        $this->enrollApproved($hub, $facultyB);
        $this->enrollApproved($hub, $deptHead);
        $this->enrollApproved($hub, $student);

        $facultyAPost = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $facultyA->id,
            'title' => 'Faculty A Course Hub Notice',
            'content' => 'Posted by Faculty A.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $deptHeadHubPost = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $deptHead->id,
            'title' => 'Dept Head Course Hub Notice',
            'content' => 'Posted by Dept Head in course hub.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $uniPost = Announcement::create([
            'channel_id' => $uniChannel->id,
            'publisher_id' => $facultyA->id,
            'title' => 'University Memo',
            'content' => 'University-wide notice.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $deptPost = Announcement::create([
            'channel_id' => $deptChannel->id,
            'publisher_id' => $facultyA->id,
            'title' => 'Department Memo',
            'content' => 'Department-wide notice.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        // 1. Faculty B cannot update or delete Faculty A's announcement (403)
        Sanctum::actingAs($facultyB);
        $this->patchJson("/api/v1/announcements/{$facultyAPost->id}", [
            'title' => 'Hijacked Title',
            'content' => 'Hijacked Content',
        ])->assertStatus(403)
            ->assertJsonStructure(['status', 'message'])
            ->assertJsonPath('status', 403);

        $this->deleteJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(403)
            ->assertJsonStructure(['status', 'message'])
            ->assertJsonPath('status', 403);

        // 2. Student cannot update or delete (403)
        Sanctum::actingAs($student);
        $this->patchJson("/api/v1/announcements/{$facultyAPost->id}", [
            'title' => 'Student Edit',
            'content' => 'Student Content',
        ])->assertStatus(403);
        $this->deleteJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(403);

        // 3. Dept Head cannot update or delete another faculty's course_hub announcement (403)
        Sanctum::actingAs($deptHead);
        $this->patchJson("/api/v1/announcements/{$facultyAPost->id}", [
            'title' => 'Dept Head Edit Hub Post',
            'content' => 'Should be forbidden',
        ])->assertStatus(403);
        $this->deleteJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(403);

        // 4. Dept Head CAN delete university and department announcements published by someone else
        $this->deleteJson("/api/v1/announcements/{$uniPost->id}")
            ->assertStatus(200);
        $this->deleteJson("/api/v1/announcements/{$deptPost->id}")
            ->assertStatus(200);

        // 5. Dept Head CAN delete their own course_hub post
        $this->deleteJson("/api/v1/announcements/{$deptHeadHubPost->id}")
            ->assertStatus(200);

        // 6. Faculty A CAN update and delete their own announcement
        Sanctum::actingAs($facultyA);
        $this->patchJson("/api/v1/announcements/{$facultyAPost->id}", [
            'title' => 'Faculty A Updated Title',
            'content' => 'Updated by owner.',
        ])->assertStatus(200)
            ->assertJsonPath('data.title', 'Faculty A Updated Title')
            ->assertJsonPath('data.can_manage', true);

        $this->deleteJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(200);
    }

    public function test_leaving_course_hub_removes_hub_announcements_from_student_and_faculty_feeds(): void
    {
        Event::fake([RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10493', 'CITC');
        $student = $this->createVerifiedUser('student', '2020303030', 'CITC');
        $hubX = $this->createChannel($faculty, 'course_hub', 'IT315');
        $uniChannel = $this->createChannel($faculty, 'university', 'CAMPUS');

        $this->enrollApproved($hubX, $faculty);
        $this->enrollApproved($hubX, $student);

        // Faculty publishes an announcement in Hub X and a campus-wide announcement
        $hubAnnouncement = Announcement::create([
            'channel_id' => $hubX->id,
            'publisher_id' => $faculty->id,
            'title' => 'Hub X Midterm Notice',
            'content' => 'Exam is Friday.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $campusAnnouncement = Announcement::create([
            'channel_id' => $uniChannel->id,
            'publisher_id' => $faculty->id,
            'title' => 'Campus Notice',
            'content' => 'Visible to all.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        // Student sees Hub X announcement, acknowledges it, then leaves Hub X
        Sanctum::actingAs($student);
        $beforeStudentIds = collect(
            $this->getJson('/api/v1/announcements?per_page=20')->assertStatus(200)->json('data')
        )->pluck('id')->all();
        $this->assertContains($hubAnnouncement->id, $beforeStudentIds);
        $this->assertContains($campusAnnouncement->id, $beforeStudentIds);

        $this->postJson("/api/v1/announcements/{$hubAnnouncement->id}/acknowledge")
            ->assertStatus(200);

        $globalVerBefore = ApiCache::getVersion('announcements.global');
        $feedVerBefore = ApiCache::getVersion('announcements.feed');

        $leaveStudentRes = $this->postJson("/api/v1/channels/{$hubX->id}/leave")
            ->assertStatus(200);
        $this->assertContains($hubX->id, $leaveStudentRes->json('left_channel_ids'));
        $this->assertGreaterThan($globalVerBefore, ApiCache::getVersion('announcements.global'));
        $this->assertGreaterThan($feedVerBefore, ApiCache::getVersion('announcements.feed'));

        Event::assertDispatched(RealtimeStateUpdated::class, function (RealtimeStateUpdated $event) use ($hubX, $student): bool {
            if ($event->type !== 'membership.changed' || $event->action !== 'left') {
                return false;
            }
            $channels = array_map(fn ($ch) => $ch->name, $event->broadcastOn());

            return $event->channelId === $hubX->id
                && $event->targetUserId === $student->id
                && in_array("private-clarify.user.{$student->id}", $channels, true);
        });

        // Student's feed no longer returns Hub X's announcement, while campus notice stays
        $afterStudentIds = collect(
            $this->getJson('/api/v1/announcements?per_page=20')->assertStatus(200)->json('data')
        )->pluck('id')->all();
        $this->assertNotContains($hubAnnouncement->id, $afterStudentIds);
        $this->assertContains($campusAnnouncement->id, $afterStudentIds);

        // Faculty sees Hub X announcement before leaving
        Sanctum::actingAs($faculty);
        $beforeFacultyIds = collect(
            $this->getJson('/api/v1/announcements?per_page=20')->assertStatus(200)->json('data')
        )->pluck('id')->all();
        $this->assertContains($hubAnnouncement->id, $beforeFacultyIds);

        // Faculty leaves Hub X -> no longer sees their own Hub X announcement in feed, but still sees campus notice
        $this->postJson("/api/v1/channels/{$hubX->id}/leave")->assertStatus(200);

        $afterFacultyIds = collect(
            $this->getJson('/api/v1/announcements?per_page=20')->assertStatus(200)->json('data')
        )->pluck('id')->all();
        $this->assertNotContains($hubAnnouncement->id, $afterFacultyIds);
        $this->assertContains($campusAnnouncement->id, $afterFacultyIds);
    }

    public function test_can_manage_resource_field_is_computed_per_user_after_shared_cache_read(): void
    {
        $facultyA = $this->createVerifiedUser('faculty', '10494', 'CITC');
        $facultyB = $this->createVerifiedUser('faculty', '10495', 'CITC');
        $deptHead = $this->createVerifiedUser('dept_head', '10401', 'CITC');
        $student = $this->createVerifiedUser('student', '2020404040', 'CITC');

        $hub = $this->createChannel($facultyA, 'course_hub', 'IT316');
        $uniChannel = $this->createChannel($deptHead, 'university', 'CAMPUS');

        $this->enrollApproved($hub, $facultyA);
        $this->enrollApproved($hub, $facultyB);
        $this->enrollApproved($hub, $deptHead);
        $this->enrollApproved($hub, $student);

        $facultyAPost = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $facultyA->id,
            'title' => 'Faculty A Post',
            'content' => 'Content A',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $deptHeadHubPost = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $deptHead->id,
            'title' => 'Dept Head Hub Post',
            'content' => 'Content DH',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $campusPost = Announcement::create([
            'channel_id' => $uniChannel->id,
            'publisher_id' => $facultyA->id,
            'title' => 'Campus Notice',
            'content' => 'Campus content',
            'status' => 'published',
            'published_at' => now(),
        ]);

        // Warm shared channel cache as Faculty A
        Sanctum::actingAs($facultyA);
        $facultyAChannelFeed = collect(
            $this->getJson("/api/v1/announcements?channel_id={$hub->id}&per_page=10")
                ->assertStatus(200)
                ->json('data')
        )->keyBy('id');
        $this->assertTrue($facultyAChannelFeed[$facultyAPost->id]['can_manage']);
        $this->assertFalse($facultyAChannelFeed[$deptHeadHubPost->id]['can_manage']);

        // Faculty B hits the same shared channel cache -> can_manage must be false for both
        Sanctum::actingAs($facultyB);
        $facultyBChannelFeed = collect(
            $this->getJson("/api/v1/announcements?channel_id={$hub->id}&per_page=10")
                ->assertStatus(200)
                ->json('data')
        )->keyBy('id');
        $this->assertFalse($facultyBChannelFeed[$facultyAPost->id]['can_manage']);
        $this->assertFalse($facultyBChannelFeed[$deptHeadHubPost->id]['can_manage']);

        // Dept Head hits shared channel cache -> false on Faculty A's hub post, true on own hub post
        Sanctum::actingAs($deptHead);
        $deptHeadChannelFeed = collect(
            $this->getJson("/api/v1/announcements?channel_id={$hub->id}&per_page=10")
                ->assertStatus(200)
                ->json('data')
        )->keyBy('id');
        $this->assertFalse($deptHeadChannelFeed[$facultyAPost->id]['can_manage']);
        $this->assertTrue($deptHeadChannelFeed[$deptHeadHubPost->id]['can_manage']);

        // Dept Head main feed -> true on campusPost (university), false on facultyAPost (course_hub)
        $deptHeadMainFeed = collect(
            $this->getJson('/api/v1/announcements?per_page=20')
                ->assertStatus(200)
                ->json('data')
        )->keyBy('id');
        $this->assertTrue($deptHeadMainFeed[$campusPost->id]['can_manage']);
        $this->assertFalse($deptHeadMainFeed[$facultyAPost->id]['can_manage']);
        $this->assertTrue($deptHeadMainFeed[$deptHeadHubPost->id]['can_manage']);

        // Student -> false on everything (both index and show)
        Sanctum::actingAs($student);
        $studentFeed = collect(
            $this->getJson("/api/v1/announcements?channel_id={$hub->id}&per_page=10")
                ->assertStatus(200)
                ->json('data')
        )->keyBy('id');
        $this->assertFalse($studentFeed[$facultyAPost->id]['can_manage']);
        $this->assertFalse($studentFeed[$deptHeadHubPost->id]['can_manage']);

        $this->getJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.can_manage', false);

        // Single show endpoint for owner Faculty A -> true
        Sanctum::actingAs($facultyA);
        $this->getJson("/api/v1/announcements/{$facultyAPost->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.can_manage', true);
    }
}
