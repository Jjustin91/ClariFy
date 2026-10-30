<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Message extends Model
{
    use HasFactory;

    protected $fillable = [
        'channel_id',
        'announcement_id',
        'sender_id',
        'parent_id',
        'subject_hashtag',
        'content',
        'is_private',
        'is_resolved',
        'is_pinned_faq',
    ];

    protected function casts(): array
    {
        return [
            'is_private' => 'boolean',
            'is_resolved' => 'boolean',
            'is_pinned_faq' => 'boolean',
        ];
    }

    public function scopeRootThreads(Builder $query): Builder
    {
        return $query->whereNull('parent_id')
            ->where(function (Builder $q) {
                $q->whereNull('subject_hashtag')
                    ->orWhere('subject_hashtag', '!=', '__CHAT__');
            });
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function announcement(): BelongsTo
    {
        return $this->belongsTo(Announcement::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->oldest('created_at');
    }
}
