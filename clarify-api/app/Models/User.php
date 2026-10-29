<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * Mass-assignable attributes.
     * Note: id, role, verification_status, verified_at, verified_by are strictly guarded (FR-08, FR-09).
     */
    protected $fillable = [
        'institutional_id',
        'name',
        'email',
        'password',
        'contact_number',
        'avatar_url',
    ];

    protected $guarded = [
        'id',
        'role',
        'verification_status',
        'verified_at',
        'verified_by',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            // Encrypted at rest for Philippine Data Privacy Act of 2012 (RA 10173 / NFR-05)
            'contact_number' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }

    public function academicProfile(): HasOne
    {
        return $this->hasOne(AcademicProfile::class);
    }

    public function channels(): BelongsToMany
    {
        return $this->belongsToMany(Channel::class, 'channel_user')
            ->withPivot(['can_publish', 'joined_at']);
    }

    public function publishedAnnouncements(): HasMany
    {
        return $this->hasMany(Announcement::class, 'publisher_id');
    }

    public function acknowledgedAnnouncements(): BelongsToMany
    {
        return $this->belongsToMany(Announcement::class, 'announcement_reads')
            ->withPivot(['acknowledged_at']);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'sender_id');
    }

    public function deviceTokens(): HasMany
    {
        return $this->hasMany(DeviceToken::class);
    }

    public function canPublishOrManage(): bool
    {
        return in_array($this->role, ['faculty', 'dept_head', 'it_admin'], true);
    }
}
