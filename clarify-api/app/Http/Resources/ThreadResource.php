<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ThreadResource extends JsonResource
{
    /**
     * Enforces FR-07 and NFR-05 (RA 10173 Data Privacy Act):
     * When is_pinned_faq === true, strictly masks author as "Anonymous Student"
     * and strips sender_id and avatar_url.
     */
    public function toArray(Request $request): array
    {
        $isPinnedFaq = (bool) $this->is_pinned_faq;

        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'announcement_id' => $this->announcement_id,
            'subject_hashtag' => $this->subject_hashtag ?? '#Inquiry',
            'content' => $this->content,
            'is_private' => $isPinnedFaq ? false : (bool) $this->is_private,
            'is_resolved' => $isPinnedFaq ? true : (bool) $this->is_resolved,
            'is_pinned_faq' => $isPinnedFaq,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'author' => $isPinnedFaq
                ? [
                    'id' => null,
                    'name' => 'Anonymous Student',
                    'role' => 'student',
                    'avatar_url' => null,
                ]
                : [
                    'id' => $this->sender?->id,
                    'name' => $this->sender?->name ?? 'USTP Student',
                    'role' => $this->sender?->role ?? 'student',
                    'avatar_url' => $this->sender?->avatar_url,
                ],
            'replies' => $this->replies->map(fn ($reply) => [
                'id' => $reply->id,
                'thread_id' => $this->id,
                'content' => $reply->content,
                'created_at' => $reply->created_at?->toIso8601String(),
                'author' => [
                    'id' => $reply->sender?->id,
                    'name' => $reply->sender?->name ?? 'Aki Hayakawa',
                    'role' => $reply->sender?->role ?? 'faculty',
                    'avatar_url' => $reply->sender?->avatar_url,
                ],
            ])->values()->all(),
        ];
    }
}
