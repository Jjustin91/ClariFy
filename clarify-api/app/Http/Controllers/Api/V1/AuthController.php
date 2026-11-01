<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\UserResource;
use App\Models\AcademicProfile;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    /**
     * POST /api/v1/auth/register
     * Student and Faculty self-registration (created with 'pending' status for IT Admin verification).
     */
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'institutional_id' => ['required', 'string', 'max:32', 'unique:users,institutional_id'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:6'],
            'role' => ['required', 'in:student,faculty'],
            'department' => ['required', 'string', 'max:32'],
            'section' => ['required', 'string', 'max:64'],
        ], [
            'institutional_id.unique' => 'This Institutional ID is already registered.',
            'email.unique' => 'This institutional email address is already registered.',
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

        $defaultChannel = Channel::first();
        if ($defaultChannel) {
            $defaultChannel->members()->syncWithoutDetaching([
                $user->id => [
                    'can_publish' => $validated['role'] === 'faculty',
                    'joined_at' => now(),
                ],
            ]);
        }

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

        if ($user->verification_status !== 'approved') {
            return response()->json([
                'status' => 403,
                'verification_status' => $user->verification_status,
                'message' => $user->verification_status === 'rejected'
                    ? 'Your account registration was rejected by the IT Administrator.'
                    : 'Your account is pending IT Administrator registrar verification.',
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
