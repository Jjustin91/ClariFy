<?php

namespace App\Http\Resources;

use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use App\Policies\ChannelPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

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
            $studentsCount = $approvedMembers
                ->filter(fn ($m) => $m->role === 'student')
                ->count();

            $faculty = $approvedMembers
                ->filter(fn ($m) => in_array($m->role, ['faculty', 'dept_head'], true))
                ->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)
                ->map(fn ($member) => [
                    'id' => (int) $member->id,
                    'name' => (string) $member->name,
                    'role' => (string) $member->role,
                ])
                ->values()
                ->all();

            if (empty($faculty)) {
                $faculty = $this->resolveCreatorFacultyFallback();
            }

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
            $studentsCount = (int) ($this->precomputed_students_count ?? 0);

            if (is_array($this->precomputed_faculty)) {
                $faculty = $this->precomputed_faculty;
            } else {
                $targetHubId = $parentHubId ?? (int) $this->id;
                $faculty = DB::table('channel_user')
                    ->join('users', 'users.id', '=', 'channel_user.user_id')
                    ->where('channel_user.channel_id', $targetHubId)
                    ->where('channel_user.approval_status', 'approved')
                    ->where('users.verification_status', 'approved')
                    ->whereIn('users.role', ['faculty', 'dept_head'])
                    ->orderBy('users.name')
                    ->select(['users.id', 'users.name', 'users.role'])
                    ->get()
                    ->map(fn ($row) => [
                        'id' => (int) $row->id,
                        'name' => (string) $row->name,
                        'role' => (string) $row->role,
                    ])
                    ->all();

                if (empty($faculty)) {
                    $faculty = $this->resolveCreatorFacultyFallback();
                }
            }
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

        $defaultInstructor = ! empty($faculty)
            ? $faculty[0]['name']
            : ($this->instructor_name ?? 'Course Hub');
        $latestPreview = "{$defaultInstructor}: Scoped Course Hub active.";
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
            $pubName = $latestAnnouncement->publisher?->name ?? $defaultInstructor;
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
            'students_count' => $studentsCount,
            'faculty' => $faculty,
            'instructor_name' => $this->instructor_name ?? 'Aki Hayakawa',
            'latest_activity_preview' => $latestPreview,
            'latest_activity_at' => $latestAt,
            'roster' => $roster,
            'pending_requests' => $pendingRequests,
        ];
    }

    /**
     * If no approved faculty member exists in channel_user, falls back to the hub creator
     * only when the creator is an approved faculty or dept_head.
     *
     * @return array<int, array{id:int, name:string, role:string}>
     */
    private function resolveCreatorFacultyFallback(): array
    {
        $creatorId = $this->created_by ? (int) $this->created_by : null;
        if (! $creatorId) {
            return [];
        }

        $creator = $this->relationLoaded('creator')
            ? $this->creator
            : User::select(['id', 'name', 'role', 'verification_status'])->find($creatorId);

        if (
            $creator &&
            $creator->verification_status === 'approved' &&
            in_array($creator->role, ['faculty', 'dept_head'], true)
        ) {
            return [[
                'id' => (int) $creator->id,
                'name' => (string) $creator->name,
                'role' => (string) $creator->role,
            ]];
        }

        return [];
    }
}


