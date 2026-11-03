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

    private static bool $approvalColumnEnsured = false;

    /**
     * Ensures the `approval_status` column exists on `channel_user` before any pivot query runs.
     */
    public static function ensureApprovalStatusColumn(): bool
    {
        if (self::$approvalColumnEnsured) {
            return true;
        }

        try {
            if (! \Illuminate\Support\Facades\Schema::hasTable('channel_user')) {
                return false;
            }

            if (\Illuminate\Support\Facades\Schema::hasColumn('channel_user', 'approval_status')) {
                self::$approvalColumnEnsured = true;
                return true;
            }

            try {
                \Illuminate\Support\Facades\DB::statement(
                    "ALTER TABLE channel_user ADD COLUMN IF NOT EXISTS approval_status VARCHAR(24) NOT NULL DEFAULT 'approved'"
                );
                self::$approvalColumnEnsured = true;
                return true;
            } catch (\Throwable $inner) {
                \Illuminate\Support\Facades\Schema::table('channel_user', function (\Illuminate\Database\Schema\Blueprint $table) {
                    $table->string('approval_status', 24)->default('approved');
                });
                self::$approvalColumnEnsured = true;
                return true;
            }
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function members(): BelongsToMany
    {
        $pivotColumns = self::ensureApprovalStatusColumn()
            ? ['can_publish', 'approval_status', 'joined_at']
            : ['can_publish', 'joined_at'];

        return $this->belongsToMany(User::class, 'channel_user')
            ->withPivot($pivotColumns);
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
