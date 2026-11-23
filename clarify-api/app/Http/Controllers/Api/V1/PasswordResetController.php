<?php

namespace App\Http\Controllers\Api\V1;

use App\Jobs\SendPasswordResetOtpSms;
use App\Models\User;
use App\Support\PhoneNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class PasswordResetController
{
    public const CACHE_VERSION = 1;
    public const OTP_TTL_SECONDS = 300;          // 5 minutes
    public const OTP_MAX_ATTEMPTS = 5;           // Max 5 wrong attempts before invalidation
    public const RESEND_COOLDOWN_SECONDS = 60;   // 60 seconds between OTP requests
    public const RESET_TOKEN_TTL_SECONDS = 600;  // 10 minutes
    public const USER_HOURLY_OTP_LIMIT = 5;      // Max 5 OTP SMS per user per hour
    public const IP_HOURLY_REQUEST_LIMIT = 10;   // Max 10 OTP requests per IP per hour
    public const VERIFY_ATTEMPTS_PER_MINUTE = 10;
    public const RESET_ATTEMPTS_PER_MINUTE = 10;

    public const GENERIC_OTP_SENT_MESSAGE =
        'If the account exists, a code was sent to its registered mobile number.';

    public const GENERIC_INVALID_OTP_MESSAGE =
        'Invalid or expired verification code.';

    public const GENERIC_INVALID_RESET_TOKEN_MESSAGE =
        'Invalid or expired password reset session. Please request a new code.';

    public static function otpCacheKey(int $userId): string
    {
        return "clarify:pwreset:otp:{$userId}";
    }

    public static function resetTokenCacheKey(int $userId): string
    {
        return "clarify:pwreset:token:{$userId}";
    }

    private static function hashResetToken(string $plainToken): string
    {
        $key = (string) config('app.key', 'clarify-pwreset-key');
        return hash_hmac('sha256', $plainToken, $key);
    }

    private function tooManyAttemptsResponse(int $retryAfter, string $message): JsonResponse
    {
        $seconds = max(1, $retryAfter);

        return response()->json([
            'status' => 429,
            'retry_after' => $seconds,
            'message' => $message,
        ], 429)->header('Retry-After', (string) $seconds);
    }

    /**
     * POST /api/v1/auth/password/request-otp
     * Public endpoint. Always returns the same 200 payload for unknown, unapproved, or no-phone IDs.
     */
    public function requestOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'institutional_id' => ['required', 'string', 'max:64'],
        ]);

        $rawInstitutionalId = trim((string) $validated['institutional_id']);
        $normalizedId = Str::lower($rawInstitutionalId);
        $ip = (string) $request->ip();

        // 1. Per-IP hourly cap (10 requests / hour)
        $ipHourlyKey = "clarify:pwreset:rl:ip:{$ip}";
        if (RateLimiter::tooManyAttempts($ipHourlyKey, self::IP_HOURLY_REQUEST_LIMIT)) {
            $seconds = RateLimiter::availableIn($ipHourlyKey);
            return $this->tooManyAttemptsResponse(
                $seconds,
                "Too many password reset requests from this network. Please try again in {$seconds} seconds."
            );
        }

        // 2. Per-account 60-second resend cooldown (keyed by submitted ID to prevent enumeration)
        $cooldownKey = "clarify:pwreset:rl:cooldown:{$normalizedId}";
        if (RateLimiter::tooManyAttempts($cooldownKey, 1)) {
            $seconds = RateLimiter::availableIn($cooldownKey);
            return $this->tooManyAttemptsResponse(
                $seconds,
                "Please wait {$seconds} seconds before requesting another verification code."
            );
        }

        // 3. Per-account hourly cap (5 OTP requests / hour, keyed by submitted ID to prevent enumeration)
        $userHourlyKey = "clarify:pwreset:rl:user:{$normalizedId}";
        if (RateLimiter::tooManyAttempts($userHourlyKey, self::USER_HOURLY_OTP_LIMIT)) {
            $seconds = RateLimiter::availableIn($userHourlyKey);
            return $this->tooManyAttemptsResponse(
                $seconds,
                "Maximum password reset codes reached for this hour. Please try again in {$seconds} seconds."
            );
        }

        RateLimiter::hit($ipHourlyKey, 3600);
        RateLimiter::hit($cooldownKey, self::RESEND_COOLDOWN_SECONDS);
        RateLimiter::hit($userHourlyKey, 3600);

        $user = User::where('institutional_id', $rawInstitutionalId)->first();

        if ($user && $user->verification_status === 'approved') {
            // contact_number is cast 'encrypted' on User; decrypt and normalize in PHP
            $normalizedPhone = PhoneNormalizer::normalize($user->contact_number);

            if ($normalizedPhone !== null) {
                $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
                $expiresAt = now()->addSeconds(self::OTP_TTL_SECONDS);

                // Invalidate any previous reset token and replace active OTP (strictly hashed)
                Cache::forget(self::resetTokenCacheKey((int) $user->id));
                Cache::put(
                    self::otpCacheKey((int) $user->id),
                    [
                        'v' => self::CACHE_VERSION,
                        'code_hash' => Hash::make($otp),
                        'attempts' => 0,
                        'expires_at' => $expiresAt->timestamp,
                    ],
                    self::OTP_TTL_SECONDS
                );

                SendPasswordResetOtpSms::dispatch((int) $user->id, $normalizedPhone, $otp);
            }
        }

        return response()->json([
            'message' => self::GENERIC_OTP_SENT_MESSAGE,
            'resend_cooldown_seconds' => self::RESEND_COOLDOWN_SECONDS,
        ], 200);
    }

    /**
     * POST /api/v1/auth/password/verify-otp
     * Verifies the 6-digit OTP against its hashed Cache record, enforces max 5 attempts,
     * deletes the OTP on success, and issues a one-time reset_token stored hashed in Cache (TTL 10 min).
     */
    public function verifyOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'institutional_id' => ['required', 'string', 'max:64'],
            'otp' => ['required', 'string', 'regex:/^\d{6}$/'],
        ], [
            'otp.regex' => 'Verification code must be a 6-digit number.',
        ]);

        $rawInstitutionalId = trim((string) $validated['institutional_id']);
        $normalizedId = Str::lower($rawInstitutionalId);
        $otp = trim((string) $validated['otp']);
        $throttleKey = "clarify:pwreset:rl:verify:{$normalizedId}|{$request->ip()}";

        if (RateLimiter::tooManyAttempts($throttleKey, self::VERIFY_ATTEMPTS_PER_MINUTE)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return $this->tooManyAttemptsResponse(
                $seconds,
                "Too many verification attempts. Please try again in {$seconds} seconds."
            );
        }

        $user = User::where('institutional_id', $rawInstitutionalId)->first();

        if (! $user || $user->verification_status !== 'approved') {
            RateLimiter::hit($throttleKey, 60);
            return response()->json([
                'status' => 422,
                'message' => self::GENERIC_INVALID_OTP_MESSAGE,
                'errors' => [
                    'otp' => [self::GENERIC_INVALID_OTP_MESSAGE],
                ],
            ], 422);
        }

        $cacheKey = self::otpCacheKey((int) $user->id);
        $record = Cache::get($cacheKey);

        if (
            ! is_array($record)
            || empty($record['code_hash'])
            || ! isset($record['expires_at'])
            || now()->timestamp > (int) $record['expires_at']
        ) {
            Cache::forget($cacheKey);
            RateLimiter::hit($throttleKey, 60);

            return response()->json([
                'status' => 422,
                'message' => self::GENERIC_INVALID_OTP_MESSAGE,
                'errors' => [
                    'otp' => [self::GENERIC_INVALID_OTP_MESSAGE],
                ],
            ], 422);
        }

        if (! Hash::check($otp, (string) $record['code_hash'])) {
            $attempts = ((int) ($record['attempts'] ?? 0)) + 1;
            RateLimiter::hit($throttleKey, 60);

            if ($attempts >= self::OTP_MAX_ATTEMPTS) {
                Cache::forget($cacheKey);
            } else {
                $remainingSeconds = max(1, (int) $record['expires_at'] - now()->timestamp);
                $record['attempts'] = $attempts;
                Cache::put($cacheKey, $record, $remainingSeconds);
            }

            return response()->json([
                'status' => 422,
                'message' => self::GENERIC_INVALID_OTP_MESSAGE,
                'errors' => [
                    'otp' => [self::GENERIC_INVALID_OTP_MESSAGE],
                ],
            ], 422);
        }

        // Valid OTP: delete immediately (single-use) and issue hashed one-time reset_token
        Cache::forget($cacheKey);
        RateLimiter::clear($throttleKey);

        $resetToken = Str::random(64);
        $tokenExpiresAt = now()->addSeconds(self::RESET_TOKEN_TTL_SECONDS);

        Cache::put(
            self::resetTokenCacheKey((int) $user->id),
            [
                'v' => self::CACHE_VERSION,
                'token_hash' => self::hashResetToken($resetToken),
                'expires_at' => $tokenExpiresAt->timestamp,
            ],
            self::RESET_TOKEN_TTL_SECONDS
        );

        return response()->json([
            'message' => 'Verification code confirmed. You may now choose a new password.',
            'reset_token' => $resetToken,
            'expires_in_seconds' => self::RESET_TOKEN_TTL_SECONDS,
        ], 200);
    }

    /**
     * POST /api/v1/auth/password/reset
     * Validates one-time reset_token, updates password, deletes token, revokes ALL Sanctum tokens,
     * clears the login throttle key, and returns 200 without auto-login.
     */
    public function reset(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'institutional_id' => ['required', 'string', 'max:64'],
            'reset_token' => ['required', 'string', 'min:32', 'max:128'],
            'password' => ['required', 'string', 'min:8', 'max:255', 'confirmed'],
        ], [
            'password.min' => 'Password must be at least 8 characters long.',
            'password.confirmed' => 'Password confirmation does not match.',
        ]);

        $rawInstitutionalId = trim((string) $validated['institutional_id']);
        $normalizedId = Str::lower($rawInstitutionalId);
        $throttleKey = "clarify:pwreset:rl:reset:{$normalizedId}|{$request->ip()}";

        if (RateLimiter::tooManyAttempts($throttleKey, self::RESET_ATTEMPTS_PER_MINUTE)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return $this->tooManyAttemptsResponse(
                $seconds,
                "Too many password reset attempts. Please try again in {$seconds} seconds."
            );
        }

        $user = User::where('institutional_id', $rawInstitutionalId)->first();

        if (! $user || $user->verification_status !== 'approved') {
            RateLimiter::hit($throttleKey, 60);
            return response()->json([
                'status' => 422,
                'message' => self::GENERIC_INVALID_RESET_TOKEN_MESSAGE,
                'errors' => [
                    'reset_token' => [self::GENERIC_INVALID_RESET_TOKEN_MESSAGE],
                ],
            ], 422);
        }

        $tokenCacheKey = self::resetTokenCacheKey((int) $user->id);
        $record = Cache::get($tokenCacheKey);
        $submittedHash = self::hashResetToken((string) $validated['reset_token']);

        if (
            ! is_array($record)
            || empty($record['token_hash'])
            || ! isset($record['expires_at'])
            || now()->timestamp > (int) $record['expires_at']
            || ! hash_equals((string) $record['token_hash'], $submittedHash)
        ) {
            RateLimiter::hit($throttleKey, 60);
            return response()->json([
                'status' => 422,
                'message' => self::GENERIC_INVALID_RESET_TOKEN_MESSAGE,
                'errors' => [
                    'reset_token' => [self::GENERIC_INVALID_RESET_TOKEN_MESSAGE],
                ],
            ], 422);
        }

        // Consume reset token immediately so it cannot be reused
        Cache::forget($tokenCacheKey);
        Cache::forget(self::otpCacheKey((int) $user->id));

        DB::transaction(function () use ($user, $validated): void {
            $user->password = $validated['password'];
            $user->save();

            // Revoke ALL active Sanctum personal access tokens across all devices
            $user->tokens()->delete();
        });

        // Clear login throttle key matching AuthController::login so user can sign in immediately
        RateLimiter::clear('login:' . Str::lower(trim($user->institutional_id)) . '|' . $request->ip());
        RateLimiter::clear($throttleKey);

        return response()->json([
            'message' => 'Your password has been reset successfully. Please sign in with your new password.',
        ], 200);
    }
}
