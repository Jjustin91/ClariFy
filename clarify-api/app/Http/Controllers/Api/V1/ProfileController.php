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
            'contact_number.required' => 'Please provide a valid mobile number for SMS fallback alerts (FR-06).',
        ]);

        $user = $request->user();

        if ($request->hasFile('avatar')) {
            $path = $request->file('avatar')->store('avatars', 'public');
            $user->avatar_url = Storage::url($path);
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
            'message' => 'Profile settings and SMS fallback number updated (FR-06).',
            'data' => new UserResource($user->load('academicProfile')),
        ]);
    }
}
