<?php

namespace App\Jobs;

use App\Services\Sms\SmsManager;
use App\Services\Sms\SmsProviderInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

class SendPasswordResetOtpSms implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 20;
    public array $backoff = [2, 5, 15];

    public function __construct(
        public int $userId,
        public string $recipient,
        public string $otp
    ) {
        // Use existing high-priority queue already listed by the VPS worker
        $this->onQueue('high-priority-push');
        $this->afterCommit();
    }

    /**
     * Builds the single-segment (<= 160 chars) password reset OTP SMS body.
     */
    public static function formatOtpMessage(string $otp): string
    {
        return "[USTP ClariFy] Your password reset code is {$otp}. Valid for 5 minutes. Never share this code.";
    }

    /**
     * Dispatches a single-recipient OTP SMS via the configured SmsProviderInterface.
     * Never logs the OTP code, recipient phone number, message body, or SMS API key.
     */
    public function handle(?SmsProviderInterface $provider = null): void
    {
        $smsProvider = $provider ?? SmsManager::resolve();
        $message = self::formatOtpMessage($this->otp);
        $driver = (string) config('services.sms.driver', 'log');

        try {
            $result = $smsProvider->sendBatch([$this->recipient], $message);
            $sent = (int) ($result['sent'] ?? 0);
            $failed = (int) ($result['failed'] ?? 0);

            Log::info('Password reset OTP SMS dispatch completed.', [
                'user_id' => $this->userId,
                'driver' => $driver,
                'sent' => $sent,
                'failed' => $failed,
            ]);

            if ($sent < 1) {
                throw new RuntimeException('SMS gateway reported zero delivered OTP messages.');
            }
        } catch (Throwable $e) {
            Log::warning('Password reset OTP SMS dispatch failed.', [
                'user_id' => $this->userId,
                'driver' => $driver,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }
}
