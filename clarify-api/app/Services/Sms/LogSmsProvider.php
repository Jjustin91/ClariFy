<?php

namespace App\Services\Sms;

use Illuminate\Support\Facades\Log;

class LogSmsProvider implements SmsProviderInterface
{
    /**
     * Safe default driver that records aggregate SMS dispatch counts in the application log
     * without making external HTTP calls or logging recipient phone numbers.
     *
     * @param  array<int, string>  $recipients
     * @param  string              $message
     * @return array{sent: int, failed: int}
     */
    public function sendBatch(array $recipients, string $message): array
    {
        $count = count($recipients);
        if ($count === 0) {
            return ['sent' => 0, 'failed' => 0];
        }

        Log::info('SMS [log driver]: Simulated batch dispatch.', [
            'recipient_count' => $count,
            'message_length' => mb_strlen($message),
        ]);

        return [
            'sent' => $count,
            'failed' => 0,
        ];
    }
}
