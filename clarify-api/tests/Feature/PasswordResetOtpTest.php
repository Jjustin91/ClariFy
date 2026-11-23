<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\PasswordResetController;
use App\Jobs\DispatchUrgentPushAlerts;
use App\Jobs\SendPasswordResetOtpSms;
use App\Jobs\TriggerSmsFallbackBatch;
use App\Models\Announcement;
use App\Models\Channel;
use App\Models\User;
use App\Services\Sms\LogSmsProvider;
use App\Services\Sms\SmsProviderInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class PasswordResetOtpTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function createUser(array $overrides = []): User
    {
        $user = new User(array_merge([
            'institutional_id' => '2026123456',
            'name' => 'Juan Dela Cruz',
            'email' => 'juan.delacruz@ustp.edu.ph',
            'contact_number' => '+639171234567',
            'password' => 'OldPassword123',
        ], $overrides));
        $user->role = $overrides['role'] ?? 'student';
        $user->verification_status = $overrides['verification_status'] ?? 'approved';
        $user->save();

        return $user->fresh();
    }

    public function test_unknown_user_returns_identical_generic_response_and_dispatches_no_sms(): void
    {
        Queue::fake();

        $approved = $this->createUser(['institutional_id' => '2026100001', 'email' => 'known@ustp.edu.ph']);

        $knownRes = $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $approved->institutional_id,
        ])->assertOk();

        $unknownRes = $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => '9999999999',
        ])->assertOk();

        $this->assertSame($knownRes->json(), $unknownRes->json());
        $this->assertSame(PasswordResetController::GENERIC_OTP_SENT_MESSAGE, $unknownRes->json('message'));
        $this->assertArrayNotHasKey('contact_number', $knownRes->json());
        $this->assertArrayNotHasKey('otp', $knownRes->json());

        Queue::assertPushed(SendPasswordResetOtpSms::class, 1);
    }

    public function test_approved_user_gets_otp_job_dispatched_on_high_priority_push_and_stored_hashed(): void
    {
        Queue::fake();

        $user = $this->createUser(['institutional_id' => '2026200002', 'email' => 'approved2@ustp.edu.ph']);

        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertOk();

        $capturedOtp = null;
        Queue::assertPushed(SendPasswordResetOtpSms::class, function (SendPasswordResetOtpSms $job) use ($user, &$capturedOtp) {
            $capturedOtp = $job->otp;
            $message = SendPasswordResetOtpSms::formatOtpMessage($job->otp);

            return $job->queue === 'high-priority-push'
                && $job->userId === $user->id
                && $job->recipient === '+639171234567'
                && preg_match('/^\d{6}$/', $job->otp) === 1
                && mb_strlen($message) <= 160
                && str_contains($message, '[USTP ClariFy]')
                && str_contains($message, $job->otp);
        });

        $cached = Cache::get(PasswordResetController::otpCacheKey($user->id));
        $this->assertIsArray($cached);
        $this->assertNotSame($capturedOtp, $cached['code_hash']);
        $this->assertTrue(Hash::check((string) $capturedOtp, (string) $cached['code_hash']));
    }

    public function test_pending_and_rejected_users_receive_generic_response_and_no_sms(): void
    {
        Queue::fake();

        $pending = $this->createUser([
            'institutional_id' => '2026300001',
            'email' => 'pending@ustp.edu.ph',
            'verification_status' => 'pending',
        ]);
        $rejected = $this->createUser([
            'institutional_id' => '2026300002',
            'email' => 'rejected@ustp.edu.ph',
            'verification_status' => 'rejected',
        ]);
        $noPhone = $this->createUser([
            'institutional_id' => '2026300003',
            'email' => 'nophone@ustp.edu.ph',
            'contact_number' => null,
            'verification_status' => 'approved',
        ]);

        foreach ([$pending, $rejected, $noPhone] as $account) {
            $this->postJson('/api/v1/auth/password/request-otp', [
                'institutional_id' => $account->institutional_id,
            ])->assertOk()->assertJson([
                'message' => PasswordResetController::GENERIC_OTP_SENT_MESSAGE,
            ]);
        }

        Queue::assertNothingPushed();
    }

    public function test_wrong_otp_five_times_invalidates_code(): void
    {
        Queue::fake();

        $user = $this->createUser(['institutional_id' => '2026400001', 'email' => 'lockout@ustp.edu.ph']);
        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertOk();

        $realOtp = null;
        Queue::assertPushed(SendPasswordResetOtpSms::class, function (SendPasswordResetOtpSms $job) use (&$realOtp) {
            $realOtp = $job->otp;
            return true;
        });

        $wrongOtp = $realOtp === '000000' ? '111111' : '000000';

        for ($i = 1; $i <= 5; $i++) {
            $this->postJson('/api/v1/auth/password/verify-otp', [
                'institutional_id' => $user->institutional_id,
                'otp' => $wrongOtp,
            ])->assertStatus(422);
        }

        // OTP record must now be deleted/invalidated; even the real OTP must fail
        $this->assertNull(Cache::get(PasswordResetController::otpCacheKey($user->id)));

        $this->postJson('/api/v1/auth/password/verify-otp', [
            'institutional_id' => $user->institutional_id,
            'otp' => $realOtp,
        ])->assertStatus(422);
    }

    public function test_expired_otp_fails_verification(): void
    {
        Queue::fake();

        $user = $this->createUser(['institutional_id' => '2026500001', 'email' => 'expired@ustp.edu.ph']);
        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertOk();

        $realOtp = null;
        Queue::assertPushed(SendPasswordResetOtpSms::class, function (SendPasswordResetOtpSms $job) use (&$realOtp) {
            $realOtp = $job->otp;
            return true;
        });

        // Travel past the 5-minute TTL
        $this->travel(305)->seconds();

        $this->postJson('/api/v1/auth/password/verify-otp', [
            'institutional_id' => $user->institutional_id,
            'otp' => $realOtp,
        ])->assertStatus(422);
    }

    public function test_verify_then_reset_updates_password_revokes_all_tokens_and_blocks_token_reuse(): void
    {
        Queue::fake();

        $user = $this->createUser(['institutional_id' => '2026600001', 'email' => 'happy@ustp.edu.ph']);
        $user->createToken('device-1');
        $user->createToken('device-2');
        $this->assertSame(2, $user->tokens()->count());

        // Trigger login throttle to verify reset clears it
        $loginThrottleKey = 'login:' . strtolower($user->institutional_id) . '|127.0.0.1';
        for ($i = 0; $i < 5; $i++) {
            RateLimiter::hit($loginThrottleKey, 60);
        }
        $this->assertTrue(RateLimiter::tooManyAttempts($loginThrottleKey, 5));

        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertOk();

        $realOtp = null;
        Queue::assertPushed(SendPasswordResetOtpSms::class, function (SendPasswordResetOtpSms $job) use (&$realOtp) {
            $realOtp = $job->otp;
            return true;
        });

        // Verify OTP -> receives one-time reset_token, deletes OTP
        $verifyRes = $this->postJson('/api/v1/auth/password/verify-otp', [
            'institutional_id' => $user->institutional_id,
            'otp' => $realOtp,
        ])->assertOk();

        $resetToken = $verifyRes->json('reset_token');
        $this->assertIsString($resetToken);
        $this->assertSame(64, strlen($resetToken));
        $this->assertNull(Cache::get(PasswordResetController::otpCacheKey($user->id)));

        // Reusing the same OTP must fail
        $this->postJson('/api/v1/auth/password/verify-otp', [
            'institutional_id' => $user->institutional_id,
            'otp' => $realOtp,
        ])->assertStatus(422);

        // Reset password
        $resetRes = $this->postJson('/api/v1/auth/password/reset', [
            'institutional_id' => $user->institutional_id,
            'reset_token' => $resetToken,
            'password' => 'NewSecurePass123',
            'password_confirmation' => 'NewSecurePass123',
        ])->assertOk();

        // Must NOT auto-login (no bearer token returned)
        $this->assertArrayNotHasKey('token', $resetRes->json());

        // Password updated, all Sanctum tokens revoked, login throttle cleared
        $user->refresh();
        $this->assertTrue(Hash::check('NewSecurePass123', $user->password));
        $this->assertSame(0, $user->tokens()->count());
        $this->assertFalse(RateLimiter::tooManyAttempts($loginThrottleKey, 5));

        // Reusing the consumed reset_token must fail
        $this->postJson('/api/v1/auth/password/reset', [
            'institutional_id' => $user->institutional_id,
            'reset_token' => $resetToken,
            'password' => 'AnotherPass123',
            'password_confirmation' => 'AnotherPass123',
        ])->assertStatus(422);
    }

    public function test_rate_limits_enforce_resend_cooldown_hourly_user_cap_and_hourly_ip_cap(): void
    {
        Queue::fake();

        $user = $this->createUser(['institutional_id' => '2026700001', 'email' => 'rl1@ustp.edu.ph']);

        // 1st request succeeds
        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertOk();

        // Immediate 2nd request hits 60s resend cooldown -> 429
        $cooldownRes = $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertStatus(429);
        $this->assertGreaterThan(0, (int) $cooldownRes->json('retry_after'));

        // Simulate 4 more requests spaced 61 seconds apart (total 5 in an hour)
        for ($i = 0; $i < 4; $i++) {
            $this->travel(61)->seconds();
            $this->postJson('/api/v1/auth/password/request-otp', [
                'institutional_id' => $user->institutional_id,
            ])->assertOk();
        }

        // 6th request within the same hour hits 5/user/hour cap -> 429
        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => $user->institutional_id,
        ])->assertStatus(429);

        // 5 more distinct IDs from the same IP reach 10/IP/hour; 11th returns 429
        for ($j = 1; $j <= 5; $j++) {
            $this->postJson('/api/v1/auth/password/request-otp', [
                'institutional_id' => "202679990{$j}",
            ])->assertOk();
        }
        $this->postJson('/api/v1/auth/password/request-otp', [
            'institutional_id' => '2026799999',
        ])->assertStatus(429);
    }

    public function test_otp_job_sends_single_recipient_via_provider_and_log_driver_never_logs_otp_or_phone(): void
    {
        $capturedRecipients = [];
        $capturedMessage = '';

        $fakeProvider = new class($capturedRecipients, $capturedMessage) implements SmsProviderInterface {
            public function __construct(
                private array &$recipientsRef,
                private string &$messageRef
            ) {}

            public function sendBatch(array $recipients, string $message): array
            {
                $this->recipientsRef = $recipients;
                $this->messageRef = $message;
                return ['sent' => count($recipients), 'failed' => 0];
            }
        };

        $job = new SendPasswordResetOtpSms(42, '+639171234567', '654321');
        $job->handle($fakeProvider);

        $this->assertSame(['+639171234567'], $capturedRecipients);
        $this->assertSame(
            '[USTP ClariFy] Your password reset code is 654321. Valid for 5 minutes. Never share this code.',
            $capturedMessage
        );
        $this->assertLessThanOrEqual(160, mb_strlen($capturedMessage));

        // Verify LogSmsProvider never logs OTP or phone number even in production
        config(['app.env' => 'production']);
        Log::spy();

        $logProvider = new LogSmsProvider();
        $logProvider->sendBatch(['+639171234567'], $capturedMessage);

        Log::shouldHaveReceived('info')->withArgs(function (string $msg, array $context) {
            $serialized = $msg . ' ' . json_encode($context);
            return ! str_contains($serialized, '654321')
                && ! str_contains($serialized, '9171234567');
        });
    }

    public function test_queued_jobs_instantiate_and_dispatch_with_after_commit_without_trait_conflicts(): void
    {
        Queue::fake();

        $faculty = $this->createUser([
            'institutional_id' => '109901',
            'email' => 'faculty.jobs@ustp.edu.ph',
            'role' => 'faculty',
        ]);

        $channel = Channel::create([
            'course_code' => 'IT314',
            'name' => 'IT314 Software Engineering',
            'channel_type' => 'course_hub',
            'scope_college' => 'CITC',
            'scope_department' => 'CITC',
            'scope_section' => 'IT3R2',
            'created_by' => $faculty->id,
        ]);

        $announcement = Announcement::create([
            'channel_id' => $channel->id,
            'publisher_id' => $faculty->id,
            'title' => 'Urgent Campus Notice',
            'content' => 'Queue trait compatibility check.',
            'is_urgent' => true,
            'trigger_sms_fallback' => true,
            'status' => 'published',
            'published_at' => now(),
        ]);

        $otpJob = new SendPasswordResetOtpSms($faculty->id, '+639171234567', '123456');
        $this->assertSame('high-priority-push', $otpJob->queue);
        $this->assertTrue($otpJob->afterCommit);
        $this->assertSame(3, $otpJob->tries);
        $this->assertSame(20, $otpJob->timeout);
        $this->assertSame([2, 5, 15], $otpJob->backoff);

        $smsBatchJob = new TriggerSmsFallbackBatch($announcement);
        $this->assertSame('sms-fallback', $smsBatchJob->queue);
        $this->assertTrue($smsBatchJob->afterCommit);

        $pushJob = new DispatchUrgentPushAlerts($announcement);
        $this->assertSame('high-priority-push', $pushJob->queue);
        $this->assertTrue($pushJob->afterCommit);

        SendPasswordResetOtpSms::dispatch($faculty->id, '+639171234567', '123456');
        TriggerSmsFallbackBatch::dispatch($announcement);
        DispatchUrgentPushAlerts::dispatch($announcement);

        Queue::assertPushedOn('high-priority-push', SendPasswordResetOtpSms::class, function (SendPasswordResetOtpSms $job) use ($faculty) {
            return $job->userId === $faculty->id
                && $job->recipient === '+639171234567'
                && $job->otp === '123456'
                && $job->afterCommit === true;
        });

        Queue::assertPushedOn('sms-fallback', TriggerSmsFallbackBatch::class, function (TriggerSmsFallbackBatch $job) use ($announcement) {
            return $job->announcement->id === $announcement->id
                && $job->afterCommit === true;
        });

        Queue::assertPushedOn('high-priority-push', DispatchUrgentPushAlerts::class, function (DispatchUrgentPushAlerts $job) use ($announcement) {
            return $job->announcement->id === $announcement->id
                && $job->afterCommit === true;
        });
    }
}
