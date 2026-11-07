<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AnnouncementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();

        $channelMembersCount = $this->channel?->members_count !== null
            ? (int) $this->channel->members_count
            : (int) ($this->channel?->members()->count() ?? 0);
        $enrolledTotal = max(42, $channelMembersCount);

        $acknowledgedCount = $this->reads_count !== null
            ? (int) $this->reads_count
            : (int) $this->reads()->count();

        $percentage = $enrolledTotal > 0
            ? round(($acknowledgedCount / $enrolledTotal) * 100, 1)
            : 0.0;

        if ($this->has_current_user_acknowledged !== null) {
            $hasAcknowledged = (bool) $this->has_current_user_acknowledged;
        } else {
            $hasAcknowledged = $user
                ? $this->reads()->where('user_id', $user->id)->exists()
                : false;
        }

        $pubDept = $this->publisher?->academicProfile?->department ?? 'CITC';
        $channelType = $this->channel?->channel_type ?? 'course_hub';
        $courseCode = $this->channel?->course_code;
        $rawChannelName = $this->channel?->name ?? '';
        $cleanChannelName = trim((string) preg_replace('/^#\s*/', '', $rawChannelName));

        $rawSubtitle = $this->subtitle ?? '';
        if ($channelType === 'course_hub' && $cleanChannelName !== '') {
            $displaySubtitle = "{$cleanChannelName} • {$pubDept} Department";
        } else {
            $displaySubtitle = ($rawSubtitle !== '' && $rawSubtitle !== 'USTP Digital Transformation')
                ? $rawSubtitle
                : "{$pubDept} Department";
        }

        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'channel_type' => $channelType,
            'course_code' => $courseCode,
            'channel_name' => $cleanChannelName !== '' ? $cleanChannelName : null,
            'title' => $this->title,
            'subtitle' => $displaySubtitle,
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
                'department' => $pubDept,
                'avatar_url' => $this->publisher?->avatar_url,
            ],
        ];
    }
}
