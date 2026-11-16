<?php

namespace App\Services\Sms;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class TwilioSmsProvider implements SmsProviderInterface
{
    public function __construct(
        private readonly string $accountSid,
        private readonly string $authToken,
        private readonly string $fromNumber
    ) {}

    /**
     * Dispatches SMS messages via Twilio REST API with a 10-second HTTP timeout.
     * Never logs phone numbers or credentials.
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

        if (trim($this->accountSid) === '' || trim($this->authToken) === '' || trim($this->fromNumber) === '') {
            throw new RuntimeException('Twilio SMS credentials are not configured in services.sms.');
        }

        $endpoint = "https://api.twilio.com/2010-04-01/Accounts/{$this->accountSid}/Messages.json";
        $sent = 0;
        $failed = 0;

        foreach ($recipients as $recipient) {
            $response = Http::timeout(10)
                ->withBasicAuth($this->accountSid, $this->authToken)
                ->asForm()
                ->post($endpoint, [
                    'From' => $this->fromNumber,
                    'To' => $recipient,
                    'Body' => $message,
                ]);

            if ($response->successful()) {
                $sent++;
            } else {
                $failed++;
            }
        }

        if ($failed > 0) {
            throw new RuntimeException("Twilio SMS batch had {$failed} failed deliveries out of {$count}.");
        }

        return [
            'sent' => $sent,
            'failed' => $failed,
        ];
    }
}
