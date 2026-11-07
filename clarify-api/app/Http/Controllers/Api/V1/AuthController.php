<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Resources\UserResource;
use App\Models\AcademicProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class AuthController
{
    private const MAX_ACTIVE_TOKENS_PER_USER = 5;

    /**
     * POST /api/v1/auth/register
     * Student and Faculty self-registration (created with 'pending' status for IT Admin verification).
     */
    public function register(Request $request): JsonResponse
    {
        $throttleKey = 'register:' . $request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return response()->json([
                'status' => 429,
                'message' => "Too many registration attempts. Please try again in {$seconds} seconds.",
            ], 429);
        }
        RateLimiter::hit($throttleKey, 60);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'institutional_id' => ['required', 'string', 'max:32', 'unique:users,institutional_id'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
            'role' => ['required', 'in:student,faculty'],
            'department' => ['required', 'string', 'max:32'],
            'section' => ['required', 'string', 'max:64'],
        ], [
            'institutional_id.unique' => 'This Institutional ID is already registered.',
            'email.unique' => 'This institutional email address is already registered.',
            'password.min' => 'Password must be at least 8 characters long.',
            'role.in' => 'Only Student and Faculty accounts can be registered on this page.',
        ]);

        $user = new User([
            'institutional_id' => trim($validated['institutional_id']),
            'name' => trim($validated['name']),
            'email' => strtolower(trim($validated['email'])),
            'password' => $validated['password'],
        ]);
        $user->role = $validated['role'];
        $user->verification_status = 'pending';
        $user->save();

        $department = strtoupper(trim($validated['department']));
        $section = trim($validated['section']);

        AcademicProfile::create([
            'user_id' => $user->id,
            'campus' => 'CDO Campus',
            'college' => $department,
            'department' => $department,
            'program' => $validated['role'] === 'student' ? "BS {$department}" : "{$department} Faculty",
            'year_level' => $validated['role'] === 'student' ? 3 : null,
            'section' => $section,
            'semester_code' => '2026-1ST-SEM',
            'specialization' => $validated['role'] === 'faculty' ? "{$department} Instruction & Research" : null,
            'office_location' => $validated['role'] === 'faculty' ? "{$department} Faculty Office" : null,
            'consultation_hours' => $validated['role'] === 'faculty' ? 'MWF 1:00 PM – 4:00 PM' : null,
            'courses_handled' => $validated['role'] === 'faculty' ? ['IT314 Software Engineering'] : [],
        ]);

        RealtimeStateUpdated::safeDispatch('admin.updated', null, (int) $user->id);

        return response()->json([
            'message' => 'Account registered successfully! Your account is now pending IT Administrator verification before you can sign in.',
            'data' => new UserResource($user->load('academicProfile')),
        ], 201);
    }

    /**
     * POST /api/v1/auth/login
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'institutional_id' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $throttleKey = 'login:' . Str::lower(trim($validated['institutional_id'])) . '|' . $request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return response()->json([
                'status' => 429,
                'message' => "Too many login attempts. Please try again in {$seconds} seconds.",
            ], 429);
        }

        $user = User::with('academicProfile')
            ->where('institutional_id', $validated['institutional_id'])
            ->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            RateLimiter::hit($throttleKey, 60);

            return response()->json([
                'status' => 422,
                'message' => 'The provided institutional credentials do not match our records.',
                'errors' => [
                    'institutional_id' => ['Invalid Institutional ID or password.'],
                ],
            ], 422);
        }

        RateLimiter::clear($throttleKey);

        if ($user->verification_status !== 'approved') {
            return response()->json([
                'status' => 403,
                'verification_status' => $user->verification_status,
                'message' => $user->verification_status === 'rejected'
                    ? 'Your account registration was rejected by the IT Administrator.'
                    : 'Your account is pending IT Administrator registrar verification.',
            ], 403);
        }

        // Limit each user to 5 active tokens (delete oldest on login)
        $existingTokenIds = $user->tokens()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->skip(self::MAX_ACTIVE_TOKENS_PER_USER - 1)
            ->take(100)
            ->pluck('id')
            ->all();

        if (! empty($existingTokenIds)) {
            $user->tokens()->whereIn('id', $existingTokenIds)->delete();
        }

        $token = $user->createToken(
            "clarify-{$user->role}-token",
            ["role:{$user->role}"],
            now()->addDays(7)
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

