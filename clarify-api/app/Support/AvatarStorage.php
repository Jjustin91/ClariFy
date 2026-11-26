<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AvatarStorage
{
    public const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

    public const MAX_SIZE_KB = 5120;

    /**
     * @var array<string, string>
     */
    private const MIME_TO_EXTENSION = [
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];

    /**
     * Safety net for API resources and broadcast payloads:
     * never serialize base64 `data:` URIs; return a resolved public URL or null.
     */
    public static function sanitizeForOutput(?string $rawUrl): ?string
    {
        if ($rawUrl === null) {
            return null;
        }

        $trimmed = trim($rawUrl);
        if ($trimmed === '') {
            return null;
        }

        if (str_starts_with(strtolower($trimmed), 'data:')) {
            return null;
        }

        if (str_starts_with($trimmed, 'http://') || str_starts_with($trimmed, 'https://')) {
            return $trimmed;
        }

        if (str_starts_with($trimmed, '/storage/')) {
            return url($trimmed);
        }

        $relativePath = ltrim(preg_replace('#^storage/#', '', $trimmed) ?? $trimmed, '/');

        return $relativePath !== ''
            ? self::publicUrlForPath($relativePath)
            : null;
    }

    /**
     * Converts a `public` disk relative path (e.g. `avatars/42/uuid.jpg`) into an absolute public URL.
     */
    public static function publicUrlForPath(string $relativePath): string
    {
        $normalized = ltrim($relativePath, '/');
        $diskUrl = Storage::disk('public')->url($normalized);

        if (str_starts_with($diskUrl, 'http://') || str_starts_with($diskUrl, 'https://')) {
            return $diskUrl;
        }

        return url($diskUrl);
    }

    /**
     * Stores an uploaded avatar file under `avatars/{userId}/{uuid}.{ext}` on the `public` disk
     * and returns its resolved public URL.
     *
     * @return array{path: string, url: string}
     */
    public static function storeUploadedAvatar(UploadedFile $file, int $userId): array
    {
        $ext = strtolower(trim((string) $file->getClientOriginalExtension()));
        if (! in_array($ext, self::ALLOWED_EXTENSIONS, true)) {
            $guessed = strtolower((string) ($file->guessExtension() ?: ''));
            $ext = in_array($guessed, self::ALLOWED_EXTENSIONS, true) ? $guessed : 'jpg';
        }

        $filename = Str::uuid()->toString() . '.' . $ext;
        $directory = "avatars/{$userId}";
        $storedPath = $file->storeAs($directory, $filename, 'public');

        return [
            'path' => $storedPath,
            'url' => self::publicUrlForPath($storedPath),
        ];
    }

    /**
     * Extracts a safe `avatars/...` relative path on the `public` disk from a stored URL or path.
     */
    public static function extractPublicDiskPath(?string $storedUrlOrPath): ?string
    {
        if ($storedUrlOrPath === null) {
            return null;
        }

        $trimmed = trim($storedUrlOrPath);
        if ($trimmed === '' || str_starts_with(strtolower($trimmed), 'data:')) {
            return null;
        }

        $relativePath = $trimmed;
        if (str_starts_with($trimmed, 'http://') || str_starts_with($trimmed, 'https://')) {
            $parsedPath = (string) parse_url($trimmed, PHP_URL_PATH);
            $storagePos = strpos($parsedPath, '/storage/');
            if ($storagePos === false) {
                return null;
            }
            $relativePath = substr($parsedPath, $storagePos + strlen('/storage/'));
        } elseif (str_starts_with($trimmed, '/storage/')) {
            $relativePath = substr($trimmed, strlen('/storage/'));
        } elseif (str_starts_with($trimmed, 'storage/')) {
            $relativePath = substr($trimmed, strlen('storage/'));
        }

        $relativePath = ltrim($relativePath, '/');
        if (
            $relativePath === '' ||
            ! str_starts_with($relativePath, 'avatars/') ||
            str_contains($relativePath, '..')
        ) {
            return null;
        }

        return $relativePath;
    }

    /**
     * Deletes a previously stored avatar file from the `public` disk when replaced or removed.
     */
    public static function deleteStoredAvatar(?string $storedUrlOrPath): void
    {
        $relativePath = self::extractPublicDiskPath($storedUrlOrPath);
        if ($relativePath !== null && Storage::disk('public')->exists($relativePath)) {
            Storage::disk('public')->delete($relativePath);
        }
    }

    /**
     * Decodes a `data:image/...;base64,...` URI into raw bytes and a safe file extension.
     *
     * @return array{bytes: string, extension: string}|null
     */
    public static function decodeDataUri(string $dataUri): ?array
    {
        if (! preg_match('#^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$#is', trim($dataUri), $matches)) {
            return null;
        }

        $mime = strtolower(trim($matches[1] ?? 'image/jpeg'));
        $base64Payload = preg_replace('/\s+/', '', $matches[2]);
        if (! is_string($base64Payload) || $base64Payload === '') {
            return null;
        }

        $bytes = base64_decode($base64Payload, true);
        if ($bytes === false || $bytes === '') {
            return null;
        }

        $extension = self::MIME_TO_EXTENSION[$mime] ?? null;
        if ($extension === null) {
            if (str_starts_with($mime, 'image/')) {
                $extension = 'jpg';
            } else {
                return null;
            }
        }

        return [
            'bytes' => $bytes,
            'extension' => $extension,
        ];
    }

    /**
     * Recursively sanitizes `avatar_url` fields (and any stray `data:` URI strings) inside an array payload.
     *
     * @param array<string, mixed>|null $payload
     * @return array<string, mixed>|null
     */
    public static function sanitizeArrayPayload(?array $payload): ?array
    {
        if ($payload === null) {
            return null;
        }

        $sanitized = [];
        foreach ($payload as $key => $value) {
            if ($key === 'avatar_url') {
                $sanitized[$key] = is_string($value)
                    ? self::sanitizeForOutput($value)
                    : null;
            } elseif (is_array($value)) {
                $sanitized[$key] = self::sanitizeArrayPayload($value);
            } elseif (is_string($value) && str_starts_with(strtolower(ltrim($value)), 'data:')) {
                $sanitized[$key] = null;
            } else {
                $sanitized[$key] = $value;
            }
        }

        return $sanitized;
    }
}
