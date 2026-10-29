<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    /**
     * POST /api/v1/auth/login (Workflow 1, NFR-01_REV, FR-08)
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'institutional_id' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $user = User::with('academicProfile')
            ->where('institutional_id', $validated['institutional_id'])
            ->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            return response()->json([
                'status' => 422,
                'message' => 'The provided institutional credentials do not match our records.',
                'errors' => [
                    'institutional_id' => ['Invalid Institutional ID or password.'],
                ],
            ], 422);
        }

        // Enforce FR-08 Account Verification gate before issuing Sanctum token
        if ($user->verification_status !== 'approved') {
            return response()->json([
                'status' => 403,
                'verification_status' => $user->verification_status,
                'message' => 'Your account is pending IT Administrator registrar verification (FR-08).',
            ], 403);
        }

        $token = $user->createToken(
            "clarify-{$user->role}-token",
            ["role:{$user->role}"]
        )->plainTextToken;

        return response()->json([
            'message' => 'Authenticated successfully.',
            'token' => $token,
            'data' => new UserResource($user),
        ]);
    }

    /**
     * POST /api/v1/auth/logout
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json([
            'message' => 'Logged out successfully.',
        ]);
    }

    /**
     * GET /api/v1/auth/me
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load('academicProfile');

        return response()->json([
            'data' => new UserResource($user),
        ]);
    }
}
