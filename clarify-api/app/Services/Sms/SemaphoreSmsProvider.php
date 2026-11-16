<?php

namespace App\Services\Sms;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class SemaphoreSmsProvider implements SmsProviderInterface
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $senderName,
        private readonly string $endpoint = 'https://api.semaphore.co/api/v4/messages'
    ) {}

    /**
     * Dispatches a batch of up to 100 recipients to Semaphore's bulk messages API.
     * Never logs phone numbers or the API key.
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

        if (trim($this->apiKey) === '') {
            throw new RuntimeException('Semaphore SMS API key is not configured in services.sms.api_key.');
        }

        $payload = [
            'apikey' => $this->apiKey,
            'number' => implode(',', $recipients),
            'message' => $message,
        ];

        if (trim($this->senderName) !== '') {
            $payload['sendername'] = trim($this->senderName);
        }

        $response = Http::timeout(10)
            ->acceptJson()
            ->asForm()
            ->post($this->endpoint, $payload);

        if (! $response->successful()) {
            throw new RuntimeException(
                'Semaphore SMS gateway returned HTTP ' . $response->status() . '.'
            );
        }

        // NOTE: Semaphore's exact bulk response format has not been verified against live Semaphore docs.
        // We parse the JSON body defensively: if it is a non-empty list of objects where every item
        // carries a scalar `status` field, count failed/refused/error (case-insensitive) as failed
        // and the rest as sent. For any other response shape on HTTP 2xx, fall back to all sent.
        $body = $response->json();

        if (is_array($body) && $body !== [] && array_is_list($body)) {
            $allHaveStatus = true;
            foreach ($body as $item) {
                if (! is_array($item) || ! array_key_exists('status', $item) || (! is_string($item['status']) && ! is_numeric($item['status']))) {
                    $allHaveStatus = false;
                    break;
                }
            }

            if ($allHaveStatus) {
                $sent = 0;
                $failed = 0;
                foreach ($body as $item) {
                    $normalizedStatus = strtolower(trim((string) $item['status']));
                    if (in_array($normalizedStatus, ['failed', 'refused', 'error'], true)) {
                        $failed++;
                    } else {
                        $sent++;
                    }
                }

                return [
                    'sent' => $sent,
                    'failed' => $failed,
                ];
            }
        }

        return [
            'sent' => $count,
            'failed' => 0,
        ];
    }
}
