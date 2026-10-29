<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\DeviceToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceTokenController
{
    /**
     * POST /api/v1/devices/token (NFR-02 / TC-NFR02 Urgent Push Notification Registration)
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'expo_push_token' => ['required', 'string', 'max:255'],
            'platform' => ['required', 'in:android,ios,web'],
        ]);

        $token = DeviceToken::updateOrCreate(
            ['expo_push_token' => $validated['expo_push_token']],
            [
                'user_id' => $request->user()->id,
                'platform' => $validated['platform'],
                'last_registered_at' => now(),
            ]
        );

        return response()->json([
            'message' => 'Device push token registered for <= 2.0s urgent alerts (NFR-02).',
            'data' => $token,
        ], 201);
    }
}
