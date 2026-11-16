<?php

namespace App\Services\Sms;

interface SmsProviderInterface
{
    /**
     * Sends an SMS message to a batch of canonical +639XXXXXXXXX recipients.
     * Implementations MUST NOT log raw phone numbers or API keys.
     *
     * @param  array<int, string>  $recipients  Normalized +639XXXXXXXXX phone numbers
     * @param  string              $message     Formatted SMS text (<= 160 chars)
     * @return array{sent: int, failed: int}
     */
    public function sendBatch(array $recipients, string $message): array;
}
