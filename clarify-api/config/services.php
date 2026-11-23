<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | All external service credentials are read via env() here and accessed
    | throughout application code exclusively via config('services.*').
    |
    */

    'sms' => [
        // Supported drivers: "log" (default safe local/dev driver), "semaphore", "twilio"
        'driver' => env('SMS_DRIVER', 'log'),

        // Semaphore (PH SMS gateway) configuration
        'api_key' => env('SMS_API_KEY', ''),
        'sender_name' => env('SMS_SENDER_NAME', ''),
        'semaphore_url' => env('SMS_SEMAPHORE_URL', 'https://api.semaphore.co/api/v4/messages'),

        // Twilio SMS configuration
        'twilio_sid' => env('TWILIO_SID', ''),
        'twilio_token' => env('TWILIO_AUTH_TOKEN', ''),
        'twilio_from' => env('TWILIO_FROM', ''),
    ],

    'expo' => [
        'push_url' => env('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'),
        'access_token' => env('EXPO_ACCESS_TOKEN', ''),
    ],

];
