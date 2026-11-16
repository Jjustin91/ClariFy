<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\UserResource;
use App\Support\ApiCache;
use App\Support\PhoneNormalizer;
use App\Support\UstpEmailValidator;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
            'avatar' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'avatar_preview_url' => ['nullable', 'string'],
        ]);

        if ($request->hasFile('avatar')) {
            $file = $request->file('avatar');
            $mime = $file->getMimeType() ?: 'image/jpeg';
            $base64 = base64_encode(file_get_contents($file->getRealPath()));
            $user->avatar_url = "data:{$mime};base64,{$base64}";
        } elseif (array_key_exists('avatar_preview_url', $validated)) {
            $user->avatar_url = $validated['avatar_preview_url'] !== ''
                ? $validated['avatar_preview_url']
                : null;
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

        $user->save();

        ApiCache::forgetInstructors();
        ApiCache::forgetChannels();

        return response()->json([
            'message' => 'Profile settings and avatar updated.',
            'data' => new UserResource($user->load('academicProfile')),
        ]);
    }
}
