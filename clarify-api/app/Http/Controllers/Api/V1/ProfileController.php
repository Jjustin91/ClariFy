<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\UserResource;
use App\Support\ApiCache;
use App\Support\AvatarStorage;
use App\Support\PhoneNormalizer;
use App\Support\UstpEmailValidator;
use Closure;
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
        $user = $request->user();

        if ($request->has('email')) {
            $request->merge([
                'email' => UstpEmailValidator::normalize((string) $request->input('email')),
            ]);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:150'],
            'email' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! UstpEmailValidator::isValid(is_string($value) ? $value : '')) {
                        $fail(UstpEmailValidator::ERROR_MESSAGE);
                    }
                },
                'unique:users,email,' . ($user?->id ?? 0),
            ],
            'contact_number' => [
                'nullable',
                'string',
                'max:32',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if ($value === null || trim((string) $value) === '') {
                        return;
                    }
                    if (! PhoneNormalizer::isValid((string) $value)) {
                        $fail('Please enter a valid Philippine mobile number (e.g., +639171234567 or 09171234567).');
                    }
                },
            ],
            'avatar' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:' . AvatarStorage::MAX_SIZE_KB],
            'remove_avatar' => ['nullable', 'boolean'],
            'avatar_preview_url' => ['nullable', 'string'],
        ]);

        $previousAvatarUrl = $user->avatar_url;
        $newlyStoredPath = null;
        $shouldDeleteOldAvatar = false;
        $removeAvatar = filter_var($request->input('remove_avatar', false), FILTER_VALIDATE_BOOLEAN);

        if ($request->hasFile('avatar')) {
            $stored = AvatarStorage::storeUploadedAvatar($request->file('avatar'), (int) $user->id);
            $newlyStoredPath = $stored['path'];
            $user->avatar_url = $stored['url'];
            $shouldDeleteOldAvatar = true;
        } elseif (
            $removeAvatar ||
            (array_key_exists('avatar_preview_url', $validated) && trim((string) ($validated['avatar_preview_url'] ?? '')) === '')
        ) {
            $user->avatar_url = null;
            $shouldDeleteOldAvatar = true;
        } elseif (array_key_exists('avatar_preview_url', $validated)) {
            // Transition compatibility: never persist base64 data: URIs sent by older clients.
            $candidate = trim((string) ($validated['avatar_preview_url'] ?? ''));
            if ($candidate !== '' && ! str_starts_with(strtolower($candidate), 'data:')) {
                $sanitized = AvatarStorage::sanitizeForOutput($candidate);
                if ($sanitized !== null && $sanitized !== $previousAvatarUrl) {
                    $user->avatar_url = $sanitized;
                }
            }
        }

        if (! empty($validated['name'])) {
            $user->name = trim($validated['name']);
        }

        if (! empty($validated['email'])) {
            $user->email = UstpEmailValidator::normalize($validated['email']);
        }

        if (array_key_exists('contact_number', $validated)) {
            $rawContact = trim((string) ($validated['contact_number'] ?? ''));
            // Automatically encrypted at rest via User model 'encrypted' cast (RA 10173)
            $user->contact_number = $rawContact !== ''
                ? PhoneNormalizer::normalize($rawContact)
                : null;
        }

        try {
            $user->save();
        } catch (\Throwable $e) {
            if ($newlyStoredPath !== null) {
                Storage::disk('public')->delete($newlyStoredPath);
            }
            throw $e;
        }

        if ($shouldDeleteOldAvatar && $previousAvatarUrl !== $user->avatar_url) {
            AvatarStorage::deleteStoredAvatar($previousAvatarUrl);
        }

        ApiCache::forgetInstructors();
        ApiCache::forgetChannels();
        if ($user->canPublishOrManage()) {
            ApiCache::forgetChannelAnnouncements(null);
        }

        return response()->json([
            'message' => 'Profile settings and avatar updated.',
            'data' => new UserResource($user->load('academicProfile')),
        ]);
    }
}
