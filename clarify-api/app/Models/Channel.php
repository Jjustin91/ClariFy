<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Channel extends Model
{
    use HasFactory;

    protected $fillable = [
        'course_code',
        'name',
        'description',
        'channel_type',
        'scope_college',
        'scope_department',
        'scope_section',
        'instructor_name',
        'created_by',
    ];

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'channel_user')
            ->withPivot(['can_publish', 'approval_status', 'joined_at']);
    }

    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class);
    }

    public function threads(): HasMany
    {
        return $this->hasMany(Message::class)
            ->whereNull('parent_id')
            ->where(function ($q) {
                $q->whereNull('subject_hashtag')
                    ->orWhere('subject_hashtag', '!=', '__CHAT__');
            });
    }

    public function chatMessages(): HasMany
    {
        return $this->hasMany(Message::class)
            ->whereNull('parent_id')
            ->where('subject_hashtag', '__CHAT__');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
