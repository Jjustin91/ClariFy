<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Announcement extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'channel_id',
        'publisher_id',
        'title',
        'subtitle',
        'content',
        'attachment_url',
        'attachment_name',
        'attachment_type',
        'tags',
        'is_urgent',
        'is_pinned',
        'trigger_sms_fallback',
        'status',
        'is_edited',
        'published_at',
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'is_urgent' => 'boolean',
            'is_pinned' => 'boolean',
            'trigger_sms_fallback' => 'boolean',
            'is_edited' => 'boolean',
            'published_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'publisher_id');
    }

    public function reads(): HasMany
    {
        return $this->hasMany(AnnouncementRead::class);
    }

    public function acknowledgedUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'announcement_reads')
            ->withPivot(['acknowledged_at']);
    }

    public function audits(): HasMany
    {
        return $this->hasMany(AnnouncementAudit::class)->latest('edited_at');
    }
}
