<?php

namespace App\Services\Sms;

class SmsManager
{
    /**
     * Resolves the active SmsProviderInterface implementation from config('services.sms.driver').
     * Defaults safely to LogSmsProvider when unset or unrecognized.
     */
    public static function resolve(?string $driverOverride = null): SmsProviderInterface
    {
        $driver = strtolower(trim((string) ($driverOverride ?? config('services.sms.driver', 'log'))));

        return match ($driver) {
            'semaphore' => new SemaphoreSmsProvider(
                (string) config('services.sms.api_key', ''),
                (string) config('services.sms.sender_name', ''),
                (string) config('services.sms.semaphore_url', 'https://api.semaphore.co/api/v4/messages')
            ),
            'twilio' => new TwilioSmsProvider(
                (string) config('services.sms.twilio_sid', ''),
                (string) config('services.sms.twilio_token', ''),
                (string) config('services.sms.twilio_from', '')
            ),
            default => new LogSmsProvider(),
        };
    }
}
