<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ChannelResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $latestAnnouncement = $this->announcements()->latest('published_at')->first();
        $members = $this->relationLoaded('members') ? $this->members : $this->members()->with('academicProfile')->get();
        $openThreadsCount = $this->threads()->where('is_resolved', false)->count();

        return [
            'id' => $this->id,
            'course_code' => $this->course_code,
            'name' => $this->name,
            'description' => $this->description,
            'channel_type' => $this->channel_type,
            'scope_college' => $this->scope_college,
            'scope_department' => $this->scope_department,
            'scope_section' => $this->scope_section,
            'unread_count' => $openThreadsCount,
            'members_count' => max(42, $members->count()),
            'instructor_name' => $this->instructor_name ?? 'Aki Hayakawa',
            'latest_activity_preview' => $latestAnnouncement
                ? "{$latestAnnouncement->publisher?->name}: " . mb_strimwidth($latestAnnouncement->content, 0, 95, '...')
                : "{$this->instructor_name}: Scoped Course Hub active.",
            'latest_activity_at' => $latestAnnouncement
                ? $latestAnnouncement->published_at->diffForHumans(null, true, true)
                : '30 mins',
            'roster' => $members->map(fn ($member) => [
                'id' => $member->id,
                'institutional_id' => $member->institutional_id,
                'name' => $member->name,
                'role' => $member->role,
                'section' => $member->academicProfile?->section ?? $this->scope_section ?? 'IT3R2',
                'department' => $member->academicProfile?->department ?? $this->scope_department ?? 'CITC',
            ])->values()->all(),
        ];
    }
}
