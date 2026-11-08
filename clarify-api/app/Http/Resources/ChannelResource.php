<?php

namespace App\Http\Resources;

use App\Models\Channel;
use App\Models\Message;
use App\Policies\ChannelPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ChannelResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $parentHubId = ChannelPolicy::resolveParentHubId($this->resource);
        $includeRoster = (bool) ($this->precomputed_include_roster ?? $this->relationLoaded('members'));

        $roster = [];
        $pendingRequests = [];

        if ($includeRoster) {
            $rawMembers = $this->relationLoaded('members')
                ? $this->members
                : $this->members()->with('academicProfile')->get();

            $validUsers = $rawMembers
                ->filter(fn ($m) => $m->role !== 'it_admin' && $m->verification_status === 'approved')
                ->values();

            $approvedMembers = $validUsers
                ->filter(fn ($m) => ($m->pivot?->approval_status ?? 'approved') !== 'pending')
                ->values();

            $pendingMembers = $validUsers
                ->filter(fn ($m) => ($m->pivot?->approval_status ?? 'approved') === 'pending')
                ->values();

            $membersCount = $approvedMembers->count();

            $roster = $approvedMembers->map(fn ($member) => [
                'id' => $member->id,
                'institutional_id' => $member->institutional_id,
                'name' => $member->name,
                'role' => $member->role,
                'section' => $member->academicProfile?->section ?? $this->scope_section ?? 'IT3R2',
                'department' => $member->academicProfile?->department ?? $this->scope_department ?? 'CITC',
            ])->values()->all();

            $reqUser = $request->user();
            $canViewPending = $reqUser && ChannelPolicy::isCourseAdmin($reqUser, $this->resource);

            $pendingRequests = $canViewPending
                ? $pendingMembers->map(fn ($member) => [
                    'id' => $member->id,
                    'institutional_id' => $member->institutional_id,
                    'name' => $member->name,
                    'role' => $member->role,
                    'section' => $member->academicProfile?->section ?? $this->scope_section ?? 'IT3R2',
                    'department' => $member->academicProfile?->department ?? $this->scope_department ?? 'CITC',
                ])->values()->all()
                : [];
        } else {
            $membersCount = (int) ($this->precomputed_members_count ?? 0);
        }

        if (isset($this->precomputed_open_threads_count)) {
            $openThreadsCount = (int) $this->precomputed_open_threads_count;
            $chatMessagesCount = (int) ($this->precomputed_chat_messages_count ?? 0);
            $latestAnnouncement = $this->precomputed_latest_announcement ?? null;
            $latestMessage = $this->precomputed_latest_message ?? null;
        } else {
            $openThreadsCount = $this->threads()->where('is_resolved', false)->count();

            $hubChannelIds = [$this->id];
            if ($parentHubId === null) {
                $subIds = Channel::where('parent_hub_id', $this->id)
                    ->orWhere('description', 'like', "[HUB:{$this->id}]%")
                    ->pluck('id')
                    ->all();
                if (! empty($subIds)) {
                    $hubChannelIds = array_values(array_unique(array_merge($hubChannelIds, $subIds)));
                }
            }

            $chatMessagesCount = Message::whereIn('channel_id', $hubChannelIds)
                ->whereNull('parent_id')
                ->where('subject_hashtag', '__CHAT__')
                ->count();

            $latestAnnouncement = $this->announcements()->with('publisher:id,name')->latest('published_at')->first();
            $latestMessage = Message::with('sender:id,name')
                ->whereIn('channel_id', $hubChannelIds)
                ->latest('created_at')
                ->first();
        }

        $latestPreview = "{$this->instructor_name}: Scoped Course Hub active.";
        $latestAt = $this->created_at ? $this->created_at->diffForHumans(null, true, true) . ' ago' : 'Just now';

        $annTime = $latestAnnouncement?->published_at?->timestamp ?? 0;
        $msgTime = $latestMessage?->created_at?->timestamp ?? 0;

        if ($msgTime > 0 && $msgTime >= $annTime) {
            $senderName = $latestMessage->sender?->name ?? 'Member';
            $rawContent = (string) $latestMessage->content;
            if (str_starts_with($rawContent, '__CLARIFY_MEDIA__')) {
                $cleanText = 'Shared an attachment in chat';
            } else {
                $cleanText = mb_strimwidth($rawContent, 0, 90, '...');
            }
            $latestPreview = "{$senderName}: {$cleanText}";
            $latestAt = $latestMessage->created_at->diffForHumans(null, true, true) . ' ago';
        } elseif ($latestAnnouncement) {
            $pubName = $latestAnnouncement->publisher?->name ?? $this->instructor_name ?? 'Faculty';
            $latestPreview = "{$pubName}: " . mb_strimwidth((string) $latestAnnouncement->content, 0, 95, '...');
            $latestAt = $latestAnnouncement->published_at->diffForHumans(null, true, true) . ' ago';
        }

        return [
            'id' => $this->id,
            'parent_hub_id' => $parentHubId,
            'created_by' => $this->created_by,
            'course_code' => $this->course_code,
            'name' => $this->name,
            'description' => $this->description,
            'channel_type' => $this->channel_type,
            'scope_college' => $this->scope_college,
            'scope_department' => $this->scope_department,
            'scope_section' => $this->scope_section,
            'unread_count' => $openThreadsCount,
            'chat_messages_count' => $chatMessagesCount,
            'members_count' => $membersCount,
            'instructor_name' => $this->instructor_name ?? 'Aki Hayakawa',
            'latest_activity_preview' => $latestPreview,
            'latest_activity_at' => $latestAt,
            'roster' => $roster,
            'pending_requests' => $pendingRequests,
        ];
    }
}

