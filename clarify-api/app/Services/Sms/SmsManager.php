<?php

namespace App\Services\Sms;

class SmsManager
{
    private static ?SmsProviderInterface $testOverride = null;

    /**
     * Documented test seam: overrides the provider returned by resolve() until cleared via fake(null).
     * Never call in production code; always reset in a finally block or tearDown().
     */
    public static function fake(?SmsProviderInterface $provider): void
    {
        self::$testOverride = $provider;
    }

    /**
     * Resolves the active SmsProviderInterface implementation from config('services.sms.driver').
     * Defaults safely to LogSmsProvider when unset or unrecognized.
     */
    public static function resolve(?string $driverOverride = null): SmsProviderInterface
    {
        if ($driverOverride === null && self::$testOverride !== null) {
            return self::$testOverride;
        }

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
