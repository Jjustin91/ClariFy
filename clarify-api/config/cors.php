<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://ustpclarify.tech',
        'https://www.ustpclarify.tech',
        rtrim(env('FRONTEND_URL', 'https://ustpclarify.tech'), '/'),
    ],

    'allowed_origins_patterns' => [
        '#^https?://([a-z0-9-]+\.)?ustpclarify\.tech(:\d+)?$#',
        '#^https?://localhost(:\d+)?$#',
    ],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 86400,

    'supports_credentials' => true,

];