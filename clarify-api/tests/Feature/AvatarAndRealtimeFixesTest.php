<?php

namespace Tests\Feature;

use App\Events\RealtimeStateUpdated;
use App\Models\AcademicProfile;
use App\Models\Announcement;
use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use App\Support\ApiCache;
use App\Support\AvatarStorage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AvatarAndRealtimeFixesTest extends TestCase
{
    use RefreshDatabase;

    private const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

    private function createUploadedPng(string $name = 'avatar.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            $name,
            (string) base64_decode(self::TINY_PNG_BASE64, true)
        );
    }

    public function test_avatar_upload_stores_file_on_public_disk_returns_url_and_deletes_old_file_on_replace(): void
    {
        Storage::fake('public');

        $student = $this->createVerifiedUser('student', '2020111001');
        Sanctum::actingAs($student);

        // 1. First upload via POST /api/v1/profile with _method=PATCH
        $firstResponse = $this->post('/api/v1/profile', [
            '_method' => 'PATCH',
            'contact_number' => '+639171234567',
            'avatar' => $this->createUploadedPng('first.png'),
        ], ['Accept' => 'application/json'])->assertStatus(200);

        $firstUrl = (string) $firstResponse->json('data.avatar_url');
        $this->assertNotEmpty($firstUrl);
        $this->assertStringStartsNotWith('data:', $firstUrl);
        $this->assertStringContainsString("/storage/avatars/{$student->id}/", $firstUrl);

        $student->refresh();
        $this->assertSame($firstUrl, $student->avatar_url);
        $firstDiskPath = AvatarStorage::extractPublicDiskPath($firstUrl);
        $this->assertNotNull($firstDiskPath);
        Storage::disk('public')->assertExists($firstDiskPath);

        // 2. Second upload replaces avatar and deletes old file
        $secondResponse = $this->post('/api/v1/profile', [
            '_method' => 'PATCH',
            'avatar' => $this->createUploadedPng('second.png'),
        ], ['Accept' => 'application/json'])->assertStatus(200);

        $secondUrl = (string) $secondResponse->json('data.avatar_url');
        $this->assertNotSame($firstUrl, $secondUrl);
        $secondDiskPath = AvatarStorage::extractPublicDiskPath($secondUrl);
        $this->assertNotNull($secondDiskPath);

        Storage::disk('public')->assertMissing($firstDiskPath);
        Storage::disk('public')->assertExists($secondDiskPath);
    }

    public function test_data_uri_avatars_are_never_serialized_across_resources_and_chat(): void
    {
        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202020', 'CITC');

        $dataUri = 'data:image/png;base64,' . self::TINY_PNG_BASE64;
        $faculty->avatar_url = $dataUri;
        $faculty->save();
        $student->avatar_url = $dataUri;
        $student->save();

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

        Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $faculty->id,
            'title' => 'Data URI Safety Check',
            'content' => 'Checking resource sanitization.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        Message::create([
            'channel_id' => $hub->id,
            'sender_id' => $student->id,
            'subject_hashtag' => '#Question',
            'content' => 'Thread content',
            'is_private' => false,
        ]);

        Message::create([
            'channel_id' => $hub->id,
            'sender_id' => $student->id,
            'subject_hashtag' => '__CHAT__',
            'content' => 'Chat content',
            'is_private' => false,
        ]);

        Sanctum::actingAs($student);

        // UserResource (/auth/me)
        $meRes = $this->getJson('/api/v1/auth/me')->assertStatus(200);
        $this->assertNull($meRes->json('data.avatar_url'));
        $this->assertStringNotContainsString('data:', (string) $meRes->getContent());

        // AnnouncementResource (/announcements)
        $annRes = $this->getJson("/api/v1/announcements?channel_id={$hub->id}")->assertStatus(200);
        $this->assertNull($annRes->json('data.0.publisher.avatar_url'));
        $this->assertStringNotContainsString('data:', (string) $annRes->getContent());

        // ThreadResource (/channels/{id}/threads)
        $threadRes = $this->getJson("/api/v1/channels/{$hub->id}/threads")->assertStatus(200);
        $this->assertNull($threadRes->json('data.0.author.avatar_url'));
        $this->assertStringNotContainsString('data:', (string) $threadRes->getContent());

        // ChannelChatController (/channels/{id}/messages)
        $chatRes = $this->getJson("/api/v1/channels/{$hub->id}/messages")->assertStatus(200);
        $this->assertNull($chatRes->json('data.0.author.avatar_url'));
        $this->assertStringNotContainsString('data:', (string) $chatRes->getContent());

        // InstructorResource (/instructors)
        $instRes = $this->getJson('/api/v1/instructors')->assertStatus(200);
        $this->assertNull($instRes->json('data.0.avatar_url'));
        $this->assertStringNotContainsString('data:', (string) $instRes->getContent());
    }

    public function test_broadcast_payload_stays_under_10kb_with_sender_avatar_and_guards_oversized_payloads(): void
    {
        Storage::fake('public');
        Event::fake([RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202021', 'CITC');
        $hub = $this->createCourseHub($faculty, 'CITC');

        DB::table('channel_user')->insert([
            [
                'channel_id' => $hub->id,
                'user_id' => $student->id,
                'can_publish' => false,
                'approval_status' => 'approved',
                'joined_at' => now(),
            ],
        ]);

        // Upload real URL avatar for sender
        Sanctum::actingAs($student);
        $this->post('/api/v1/profile', [
            '_method' => 'PATCH',
            'avatar' => $this->createUploadedPng('sender.png'),
        ], ['Accept' => 'application/json'])->assertStatus(200);

        $this->postJson("/api/v1/channels/{$hub->id}/messages", [
            'content' => 'Hello everyone in IT314!',
        ])->assertStatus(201);

        Event::assertDispatched(RealtimeStateUpdated::class, function (RealtimeStateUpdated $event) use ($hub): bool {
            if ($event->type !== 'chat.message' || $event->channelId !== $hub->id) {
                return false;
            }
            $payload = $event->broadcastWith();
            $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $this->assertNotFalse($encoded);
            $this->assertLessThan(10_000, strlen($encoded));
            $this->assertStringNotContainsString('data:', $encoded);
            $this->assertStringContainsString('/storage/avatars/', (string) ($payload['message']['author']['avatar_url'] ?? ''));

            return true;
        });

        // Also verify ~8 KB hard guard logs and falls back to minimal IDs-only payload
        Log::spy();
        $oversizedEvent = new RealtimeStateUpdated(
            'thread.created',
            $hub->id,
            $student->id,
            null,
            null,
            [
                'id' => 999,
                'channel_id' => $hub->id,
                'content' => str_repeat('A', 9500),
                'author' => [
                    'id' => $student->id,
                    'name' => $student->name,
                    'avatar_url' => 'data:image/png;base64,' . self::TINY_PNG_BASE64,
                ],
            ]
        );
        $guardedPayload = $oversizedEvent->broadcastWith();
        $guardedJson = json_encode($guardedPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $this->assertNotFalse($guardedJson);
        $this->assertLessThan(RealtimeStateUpdated::MAX_BROADCAST_BYTES, strlen($guardedJson));
        $this->assertNull($guardedPayload['thread']);
        $this->assertSame(999, $guardedPayload['message_id']);
        Log::shouldHaveReceived('warning')->once();
    }

    public function test_acknowledge_on_soft_deleted_announcement_returns_404_json_and_delete_event_carries_id(): void
    {
        Event::fake([RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202022', 'CITC');
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

        $announcement = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $faculty->id,
            'title' => 'Urgent Weather Advisory',
            'content' => 'Classes suspended.',
            'is_urgent' => true,
            'is_pinned' => true,
            'status' => 'published',
            'published_at' => now(),
        ]);

        // Delete announcement -> soft-deleted + broadcasts announcement.deleted with IDs only
        Sanctum::actingAs($faculty);
        $this->deleteJson("/api/v1/announcements/{$announcement->id}")->assertStatus(200);

        Event::assertDispatched(RealtimeStateUpdated::class, function (RealtimeStateUpdated $event) use ($announcement, $hub): bool {
            if ($event->type !== 'announcement.deleted') {
                return false;
            }
            $payload = $event->broadcastWith();
            $this->assertSame($announcement->id, $payload['announcement_id']);
            $this->assertSame($announcement->id, $payload['announcement']['id'] ?? null);
            $this->assertSame($hub->id, $payload['channel_id']);
            $this->assertArrayNotHasKey('title', $payload['announcement'] ?? []);
            $this->assertArrayNotHasKey('content', $payload['announcement'] ?? []);

            return true;
        });

        // Student acknowledging soft-deleted announcement gets clean 404 JSON
        Sanctum::actingAs($student);
        $this->postJson("/api/v1/announcements/{$announcement->id}/acknowledge")
            ->assertStatus(404)
            ->assertJson([
                'status' => 404,
                'message' => 'This announcement is no longer available.',
            ]);

        // Missing announcement ID also gets clean 404 JSON
        $this->postJson('/api/v1/announcements/999999/acknowledge')
            ->assertStatus(404)
            ->assertJson([
                'status' => 404,
                'message' => 'This announcement is no longer available.',
            ]);
    }

    public function test_acknowledge_does_not_bump_global_feed_version_and_scopes_broadcast(): void
    {
        Event::fake([RealtimeStateUpdated::class]);

        $faculty = $this->createVerifiedUser('faculty', '10492', 'CITC');
        $student = $this->createVerifiedUser('student', '2020202023', 'CITC');
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

        $announcement = Announcement::create([
            'channel_id' => $hub->id,
            'publisher_id' => $faculty->id,
            'title' => 'Lab Submission',
            'content' => 'Submit by 5 PM.',
            'status' => 'published',
            'published_at' => now(),
        ]);

        $feedVerBefore = ApiCache::getVersion('announcements.feed');
        $globalVerBefore = ApiCache::getVersion('announcements.global');
        $rrVerBefore = ApiCache::getVersion("announcements.read_reach.{$announcement->id}");

        Sanctum::actingAs($student);
        $this->postJson("/api/v1/announcements/{$announcement->id}/acknowledge")
            ->assertStatus(200)
            ->assertJsonPath('data.read_reach.acknowledged_count', 1)
            ->assertJsonPath('data.read_reach.has_current_user_acknowledged', true);

        // Global feed version and global version MUST NOT be bumped
        $this->assertSame($feedVerBefore, ApiCache::getVersion('announcements.feed'));
        $this->assertSame($globalVerBefore, ApiCache::getVersion('announcements.global'));
        // Only this announcement's read_reach version is bumped
        $this->assertGreaterThan($rrVerBefore, ApiCache::getVersion("announcements.read_reach.{$announcement->id}"));

        // Broadcast goes ONLY to clarify.channel.{id} and publisher's clarify.user.{id}, NOT clarify.global
        Event::assertDispatched(RealtimeStateUpdated::class, function (RealtimeStateUpdated $event) use ($hub, $faculty): bool {
            if ($event->type !== 'announcement.acknowledged') {
                return false;
            }
            $channelNames = array_map(fn ($ch) => $ch->name, $event->broadcastOn());
            $this->assertContains("private-clarify.channel.{$hub->id}", $channelNames);
            $this->assertContains("private-clarify.user.{$faculty->id}", $channelNames);
            $this->assertNotContains('private-clarify.global', $channelNames);

            return true;
        });

        // GET /api/v1/announcements/{id} returns updated read reach and per-user flag
        $this->getJson("/api/v1/announcements/{$announcement->id}")
            ->assertStatus(200)
            ->assertJsonPath('data.read_reach.acknowledged_count', 1)
            ->assertJsonPath('data.read_reach.has_current_user_acknowledged', true);
    }

    public function test_migrate_avatars_command_dry_run_changes_nothing_and_real_run_is_idempotent(): void
    {
        Storage::fake('public');

        $user = $this->createVerifiedUser('student', '2020202024', 'CITC');
        $dataUri = 'data:image/png;base64,' . self::TINY_PNG_BASE64;
        $user->avatar_url = $dataUri;
        $user->save();

        // Dry run must not change DB or write any file
        $this->artisan('users:migrate-avatars', ['--dry-run' => true])
            ->assertExitCode(0);

        $user->refresh();
        $this->assertSame($dataUri, $user->avatar_url);
        $this->assertSame([], Storage::disk('public')->allFiles('avatars'));

        // Real run converts data URI into file and stores URL
        $this->artisan('users:migrate-avatars')
            ->assertExitCode(0);

        $user->refresh();
        $this->assertStringStartsNotWith('data:', (string) $user->avatar_url);
        $this->assertStringContainsString("/storage/avatars/{$user->id}/", (string) $user->avatar_url);
        $diskPath = AvatarStorage::extractPublicDiskPath($user->avatar_url);
        $this->assertNotNull($diskPath);
        Storage::disk('public')->assertExists($diskPath);

        $migratedUrl = $user->avatar_url;

        // Second real run is a clean idempotent no-op
        $this->artisan('users:migrate-avatars')
            ->assertExitCode(0);

        $user->refresh();
        $this->assertSame($migratedUrl, $user->avatar_url);
    }
}
