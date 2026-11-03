<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ProfileController
{
    /**
     * POST/PATCH /api/v1/profile (FR-06, NFR-05 RA 10173 encrypted contact_number)
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:150'],
            'contact_number' => ['required', 'string', 'max:32'],
            'avatar' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'avatar_preview_url' => ['nullable', 'string'],
        ], [
            'contact_number.required' => 'Please provide a valid mobile number for SMS fallback alerts.',
        ]);

        $user = $request->user();

        try {
            if (\Illuminate\Support\Facades\DB::getDriverName() === 'pgsql') {
                \Illuminate\Support\Facades\DB::statement('ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT');
            }
        } catch (\Throwable $e) {
            // Column is already TEXT or SQLite
        }

        if ($request->hasFile('avatar')) {
            $file = $request->file('avatar');
            $mime = $file->getMimeType() ?: 'image/jpeg';
            $base64 = base64_encode(file_get_contents($file->getRealPath()));
            $user->avatar_url = "data:{$mime};base64,{$base64}";
        } elseif (! empty($validated['avatar_preview_url'])) {
            $user->avatar_url = $validated['avatar_preview_url'];
        }

        if (! empty($validated['name'])) {
            $user->name = $validated['name'];
        }

        // Automatically encrypted at rest via User model 'encrypted' cast (RA 10173)
        $user->contact_number = $validated['contact_number'];
        $user->save();

        return response()->json([
            'message' => 'Profile settings and avatar updated.',
            'data' => new UserResource($user->load('academicProfile')),
        ]);
    }
}
