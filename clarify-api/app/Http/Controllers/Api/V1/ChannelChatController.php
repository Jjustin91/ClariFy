<?php

namespace App\Http\Controllers\Api\V1;

use App\Events\RealtimeStateUpdated;
use App\Http\Controllers\Controller;
use App\Models\Channel;
use App\Models\Message;
use App\Policies\ChannelPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Course Hub General Messenger Chat Controller.
 *
 * Uses the `messages` table with `subject_hashtag = '__CHAT__'` and `parent_id = NULL`
 * so chat messages persist in PostgreSQL alongside Q&A threads while keeping
 * Q&A inquiries (which use real hashtags like `#Midterm`) cleanly separated.
 */
class ChannelChatController extends Controller
{
    /**
     * Allowed file extensions for Course Hub chat attachments (image, document, voice note).
     *
     * @var array<int, string>
     */
    public const ALLOWED_ATTACHMENT_EXTENSIONS = [
        'jpg',
        'jpeg',
        'png',
        'webp',
        'gif',
        'pdf',
        'doc',
        'docx',
        'ppt',
        'pptx',
        'xls',
        'xlsx',
        'txt',
        'csv',
        'zip',
        'webm',
        'ogg',
        'wav',
        'mp3',
        'm4a',
    ];

    /**
     * Dangerous executable or script MIME substrings strictly rejected on upload.
     *
     * @var array<int, string>
     */
    private const FORBIDDEN_MIME_SUBSTRINGS = [
        'application/x-msdownload',
        'application/x-executable',
        'application/x-dosexec',
        'application/x-sh',
        'application/x-httpd-php',
        'application/x-php',
        'text/x-php',
        'text/html',
        'application/javascript',
        'text/javascript',
    ];

    /**
     * GET /api/v1/channels/{channelId}/chat (and /messages)
     * Cursor-paginated latest chat messages (?before=<id>&limit=50).
     */
    public function index(Request $request, int $channelId): JsonResponse
    {
        $channel = Channel::findOrFail($channelId);
        $user = $request->user();

        if (! $user || ! app(ChannelPolicy::class)->hasApprovedChannelAccess($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: You must be an approved member of this Course Hub to view chat messages.',
            ], 403);
        }

        $limit = min(100, max(1, (int) $request->query('limit', 50)));
        $beforeId = $request->filled('before') ? (int) $request->query('before') : null;

        $query = Message::query()
            ->select([
                'id',
                'channel_id',
                'sender_id',
                'content',
                'attachment_url',
                'attachment_name',
                'attachment_type',
                'attachment_mime',
                'attachment_size',
                'created_at',
            ])
            ->with(['sender:id,name,role,avatar_url'])
            ->where('channel_id', $channel->id)
            ->whereNull('parent_id')
            ->where('subject_hashtag', '__CHAT__');

        if ($beforeId !== null && $beforeId > 0) {
            $query->where('id', '<', $beforeId);
        }

        // Fetch limit + 1 in descending order to determine if older messages exist
        $rows = $query
            ->orderByDesc('id')
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        $sliced = $rows->take($limit)->reverse()->values();
        $nextBefore = $hasMore && $sliced->isNotEmpty() ? (int) $sliced->first()->id : null;

        $messages = $sliced->map(fn (Message $msg) => $this->formatMessagePayload($msg));

        return response()->json([
            'data' => $messages,
            'meta' => [
                'has_more' => $hasMore,
                'next_before' => $nextBefore,
            ],
        ]);
    }

    /**
     * POST /api/v1/channels/{channelId}/chat (and /messages)
     * Supports both JSON text-only messages and multipart/form-data attachment uploads.
     */
    public function store(Request $request, int $channelId): JsonResponse
    {
        $channel = Channel::findOrFail($channelId);
        $user = $request->user();

        if (! $user || ! app(ChannelPolicy::class)->hasApprovedChannelAccess($user, $channel)) {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: You must be an approved member of this Course Hub to post chat messages.',
            ], 403);
        }

        $validated = $request->validate([
            'content' => ['required_without:attachment', 'nullable', 'string', 'max:2000'],
            'temp_id' => ['nullable', 'string', 'max:64'],
            'attachment' => $this->attachmentValidationRules(),
        ], [
            'content.required_without' => 'Please enter a message or attach a file before sending.',
            'content.max' => 'Chat messages cannot exceed 2,000 characters.',
            'attachment.max' => 'Chat attachments must not exceed 10 MB.',
            'attachment.mimes' => 'Unsupported file type. Allowed formats: images, PDF, Office documents, TXT/CSV/ZIP, and audio/voice notes.',
        ]);

        $trimmedContent = isset($validated['content']) ? trim((string) $validated['content']) : '';
        $hasFile = $request->hasFile('attachment');

        if ($trimmedContent === '' && ! $hasFile) {
            return response()->json([
                'status' => 422,
                'message' => 'Please enter a message or attach a file before sending.',
                'errors' => [
                    'content' => ['Please enter a message or attach a file before sending.'],
                ],
            ], 422);
        }

        $storedMeta = null;
        if ($hasFile) {
            /** @var UploadedFile $uploadedFile */
            $uploadedFile = $request->file('attachment');
            $storedMeta = $this->storeUploadedAttachment($uploadedFile, (int) $channel->id);
        }

        try {
            $message = Message::create([
                'channel_id' => $channel->id,
                'announcement_id' => null,
                'sender_id' => $user->id,
                'parent_id' => null,
                'subject_hashtag' => '__CHAT__',
                'content' => $trimmedContent,
                'attachment_url' => $storedMeta['path'] ?? null,
                'attachment_name' => $storedMeta['name'] ?? null,
                'attachment_type' => $storedMeta['type'] ?? null,
                'attachment_mime' => $storedMeta['mime'] ?? null,
                'attachment_size' => $storedMeta['size'] ?? null,
                'is_private' => false,
                'is_resolved' => false,
                'is_pinned_faq' => false,
            ]);
        } catch (\Throwable $e) {
            if ($storedMeta !== null && ! empty($storedMeta['path'])) {
                Storage::disk('public')->delete($storedMeta['path']);
            }
            throw $e;
        }

        $message->setRelation('sender', $user);

        $payload = $this->formatMessagePayload(
            $message,
            $validated['temp_id'] ?? null
        );

        RealtimeStateUpdated::dispatchAfterResponse(
            'chat.message',
            $channel->id,
            null,
            $payload
        );

        return response()->json([
            'message' => 'Message sent to Course Hub chat.',
            'data' => $payload,
        ], 201);
    }

    /**
     * Validation rules for the optional `attachment` upload.
     *
     * @return array<int, mixed>
     */
    private function attachmentValidationRules(): array
    {
        return [
            'nullable',
            'file',
            'max:10240',
            'mimes:' . implode(',', self::ALLOWED_ATTACHMENT_EXTENSIONS),
            function (string $attribute, mixed $value, \Closure $fail): void {
                if (! $value instanceof UploadedFile) {
                    return;
                }

                $clientExt = strtolower((string) $value->getClientOriginalExtension());
                if ($clientExt === '' || ! in_array($clientExt, self::ALLOWED_ATTACHMENT_EXTENSIONS, true)) {
                    $fail('The attachment extension is not allowed.');
                    return;
                }

                $detectedMime = strtolower((string) $value->getMimeType());
                $clientMime = strtolower((string) $value->getClientMimeType());
                foreach (self::FORBIDDEN_MIME_SUBSTRINGS as $forbidden) {
                    if (
                        str_contains($detectedMime, $forbidden) ||
                        str_contains($clientMime, $forbidden)
                    ) {
                        $fail('Executable or script files are not allowed.');
                        return;
                    }
                }
            },
        ];
    }

    /**
     * Stores an uploaded chat attachment under `chat/{channel_id}/{uuid}.{ext}` on the public disk.
     *
     * @return array{path: string, name: string, type: 'image'|'document'|'voice', mime: string, size: int}
     */
    private function storeUploadedAttachment(UploadedFile $file, int $channelId): array
    {
        $ext = strtolower((string) $file->getClientOriginalExtension());
        if ($ext === '' || ! in_array($ext, self::ALLOWED_ATTACHMENT_EXTENSIONS, true)) {
            $ext = strtolower((string) $file->extension());
        }
        if ($ext === '' || ! in_array($ext, self::ALLOWED_ATTACHMENT_EXTENSIONS, true)) {
            $ext = 'bin';
        }

        $filename = Str::uuid()->toString() . '.' . $ext;
        $directory = 'chat/' . $channelId;
        $storedPath = $file->storeAs($directory, $filename, 'public');

        $rawOriginalName = (string) $file->getClientOriginalName();
        $sanitizedName = preg_replace('/[^\w\-. ()\[\]]+/u', '_', basename($rawOriginalName)) ?: $filename;
        $sanitizedName = Str::limit($sanitizedName, 180, '');

        $mime = strtolower((string) ($file->getClientMimeType() ?: $file->getMimeType() ?: 'application/octet-stream'));
        $size = max(0, (int) $file->getSize());

        $imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        $voiceExtensions = ['webm', 'ogg', 'wav', 'mp3', 'm4a'];

        if (in_array($ext, $imageExtensions, true) || str_starts_with($mime, 'image/')) {
            $type = 'image';
        } elseif (in_array($ext, $voiceExtensions, true) || str_starts_with($mime, 'audio/')) {
            $type = 'voice';
        } else {
            $type = 'document';
        }

        return [
            'path' => $storedPath,
            'name' => $sanitizedName,
            'type' => $type,
            'mime' => $mime,
            'size' => $size,
        ];
    }

    /**
     * Formats a Message model into the additive API & broadcast payload.
     * Never emits base64 or file bytes in `attachment`.
     *
     * @return array<string, mixed>
     */
    private function formatMessagePayload(Message $msg, ?string $tempId = null): array
    {
        $payload = [
            'id' => $msg->id,
            'channel_id' => $msg->channel_id,
            'content' => (string) ($msg->content ?? ''),
            'attachment' => $this->formatAttachmentMetadata($msg),
            'created_at' => $msg->created_at?->toIso8601String() ?? now()->toIso8601String(),
            'author' => [
                'id' => $msg->sender?->id ?? $msg->sender_id,
                'name' => $msg->sender?->name ?? 'Campus Member',
                'role' => $msg->sender?->role ?? 'student',
                'avatar_url' => $msg->sender?->avatar_url,
            ],
        ];

        if ($tempId !== null) {
            $payload['temp_id'] = $tempId;
        }

        return $payload;
    }

    /**
     * Resolves public URL and attachment metadata for a Message record, or null when none exists.
     *
     * @return array{url: string, name: string, type: string, mime: string|null, size: int|null}|null
     */
    private function formatAttachmentMetadata(Message $msg): ?array
    {
        $rawPath = $msg->attachment_url;
        if (! is_string($rawPath) || trim($rawPath) === '') {
            return null;
        }

        $trimmed = trim($rawPath);
        if (str_starts_with($trimmed, 'http://') || str_starts_with($trimmed, 'https://') || str_starts_with($trimmed, '/storage/')) {
            $publicUrl = $trimmed;
        } else {
            $publicUrl = Storage::disk('public')->url($trimmed);
        }

        return [
            'url' => $publicUrl,
            'name' => (string) ($msg->attachment_name ?: basename($trimmed)),
            'type' => (string) ($msg->attachment_type ?: 'document'),
            'mime' => $msg->attachment_mime ? (string) $msg->attachment_mime : null,
            'size' => $msg->attachment_size !== null ? (int) $msg->attachment_size : null,
        ];
    }
}
