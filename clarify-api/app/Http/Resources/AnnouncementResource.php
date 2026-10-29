<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AnnouncementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $enrolledTotal = max(42, (int) $this->channel?->members()->count());
        $acknowledgedCount = (int) $this->reads()->count();
        $percentage = $enrolledTotal > 0
            ? round(($acknowledgedCount / $enrolledTotal) * 100, 1)
            : 0.0;

        $hasAcknowledged = $user
            ? $this->reads()->where('user_id', $user->id)->exists()
            : false;

        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'title' => $this->title,
            'subtitle' => $this->subtitle ?? 'USTP Digital Transformation',
            'content' => $this->content,
            'attachment_url' => $this->attachment_url,
            'attachment_name' => $this->attachment_name,
            'attachment_type' => $this->attachment_type,
            'tags' => $this->tags ?? [],
            'is_urgent' => (bool) $this->is_urgent,
            'is_pinned' => (bool) $this->is_pinned,
            'trigger_sms_fallback' => (bool) $this->trigger_sms_fallback,
            'status' => $this->status,
            'is_edited' => (bool) $this->is_edited,
            'published_at' => ($this->published_at ?? $this->created_at)?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'read_reach' => [
                'acknowledged_count' => $acknowledgedCount,
                'enrolled_total' => $enrolledTotal,
                'percentage' => $percentage,
                'has_current_user_acknowledged' => $hasAcknowledged,
            ],
            'publisher' => [
                'id' => $this->publisher?->id ?? $this->publisher_id,
                'name' => $this->publisher?->name ?? 'Aki Hayakawa',
                'role' => $this->publisher?->role ?? 'faculty',
                'department' => $this->publisher?->academicProfile?->department ?? 'CITC',
                'avatar_url' => $this->publisher?->avatar_url,
            ],
        ];
    }
}
