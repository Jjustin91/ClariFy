<?php

namespace App\Http\Resources;

use App\Policies\ChannelPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class AnnouncementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();

        if ($this->precomputed_enrolled_total !== null && $this->precomputed_acknowledged_count !== null) {
            $enrolledTotal = max(0, (int) $this->precomputed_enrolled_total);
            $acknowledgedCount = min($enrolledTotal, max(0, (int) $this->precomputed_acknowledged_count));
        } else {
            [$enrolledTotal, $acknowledgedCount] = $this->computeFallbackReadReach();
        }

        $percentage = $this->precomputed_percentage !== null
            ? (float) $this->precomputed_percentage
            : ($enrolledTotal > 0 ? round(($acknowledgedCount / $enrolledTotal) * 100, 1) : 0.0);

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

        $resolvedAttachmentUrl = $this->resolvePublicAttachmentUrl($this->attachment_url);

        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'channel_type' => $channelType,
            'course_code' => $courseCode,
            'channel_name' => $cleanChannelName !== '' ? $cleanChannelName : null,
            'title' => $this->title,
            'subtitle' => $displaySubtitle,
            'content' => $this->content,
            'attachment_url' => $resolvedAttachmentUrl,
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

    private function resolvePublicAttachmentUrl(?string $rawUrl): ?string
    {
        if ($rawUrl === null || trim($rawUrl) === '') {
            return null;
        }

        $trimmed = trim($rawUrl);
        if (
            str_starts_with($trimmed, 'http://') ||
            str_starts_with($trimmed, 'https://') ||
            str_starts_with($trimmed, 'data:')
        ) {
            return $trimmed;
        }

        if (str_starts_with($trimmed, '/storage/')) {
            return url($trimmed);
        }

        $relativePath = ltrim(preg_replace('#^storage/#', '', $trimmed), '/');

        return url(Storage::disk('public')->url($relativePath));
    }

    /**
     * Fallback approved-student Read Reach calculation when rendered outside AnnouncementController.
     *
     * @return array{0:int, 1:int}
     */
    private function computeFallbackReadReach(): array
    {
        $channel = $this->channel;
        $channelType = $channel?->channel_type ?? 'course_hub';

        if ($channel && $channelType === 'course_hub') {
            $targetHubId = ChannelPolicy::resolveParentHubId($channel) ?? (int) $channel->id;

            $enrolledTotal = (int) DB::table('channel_user')
                ->join('users', 'users.id', '=', 'channel_user.user_id')
                ->where('channel_user.channel_id', $targetHubId)
                ->where('channel_user.approval_status', 'approved')
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->count(DB::raw('DISTINCT channel_user.user_id'));

            if ($enrolledTotal === 0) {
                return [0, 0];
            }

            $acknowledgedCount = (int) DB::table('announcement_reads')
                ->join('users', 'users.id', '=', 'announcement_reads.user_id')
                ->join('channel_user', function ($join) use ($targetHubId) {
                    $join->on('channel_user.user_id', '=', 'announcement_reads.user_id')
                        ->where('channel_user.channel_id', '=', $targetHubId)
                        ->where('channel_user.approval_status', '=', 'approved');
                })
                ->where('announcement_reads.announcement_id', $this->id)
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->count(DB::raw('DISTINCT announcement_reads.user_id'));

            return [$enrolledTotal, min($enrolledTotal, $acknowledgedCount)];
        }

        $scopeDept = ($channel && in_array($channelType, ['department', 'college'], true))
            ? trim((string) ($channel->scope_department ?? ''))
            : '';

        if ($scopeDept !== '' && strtoupper($scopeDept) !== 'USTP' && strtoupper($scopeDept) !== 'ALL') {
            $enrolledTotal = (int) DB::table('users')
                ->join('academic_profiles', 'academic_profiles.user_id', '=', 'users.id')
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->whereRaw('UPPER(academic_profiles.department) = ?', [strtoupper($scopeDept)])
                ->count(DB::raw('DISTINCT users.id'));

            if ($enrolledTotal === 0) {
                return [0, 0];
            }

            $acknowledgedCount = (int) DB::table('announcement_reads')
                ->join('users', 'users.id', '=', 'announcement_reads.user_id')
                ->join('academic_profiles', 'academic_profiles.user_id', '=', 'users.id')
                ->where('announcement_reads.announcement_id', $this->id)
                ->where('users.verification_status', 'approved')
                ->where('users.role', 'student')
                ->whereRaw('UPPER(academic_profiles.department) = ?', [strtoupper($scopeDept)])
                ->count(DB::raw('DISTINCT announcement_reads.user_id'));

            return [$enrolledTotal, min($enrolledTotal, $acknowledgedCount)];
        }

        $enrolledTotal = (int) DB::table('users')
            ->where('verification_status', 'approved')
            ->where('users.role', 'student')
            ->count();

        if ($enrolledTotal === 0) {
            return [0, 0];
        }

        $acknowledgedCount = (int) DB::table('announcement_reads')
            ->join('users', 'users.id', '=', 'announcement_reads.user_id')
            ->where('announcement_reads.announcement_id', $this->id)
            ->where('users.verification_status', 'approved')
            ->where('users.role', 'student')
            ->count(DB::raw('DISTINCT announcement_reads.user_id'));

        return [$enrolledTotal, min($enrolledTotal, $acknowledgedCount)];
    }
}

