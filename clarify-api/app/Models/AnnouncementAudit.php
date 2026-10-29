<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Immutable Append-Only Audit Log (NFR-03_REV / TC-NFR03).
 * Records cannot be updated or deleted once written.
 */
class AnnouncementAudit extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'announcement_id',
        'editor_id',
        'previous_title',
        'new_title',
        'previous_content',
        'new_content',
        'edited_at',
    ];

    protected function casts(): array
    {
        return [
            'edited_at' => 'datetime',
        ];
    }

    public function announcement(): BelongsTo
    {
        return $this->belongsTo(Announcement::class);
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'editor_id');
    }

    public function update(array $attributes = [], array $options = []): bool
    {
        throw new LogicException(
            'Immutable Audit Log (NFR-03_REV): announcement_audits records are append-only and cannot be updated.'
        );
    }

    public function delete(): ?bool
    {
        throw new LogicException(
            'Immutable Audit Log (NFR-03_REV): announcement_audits records are append-only and cannot be deleted.'
        );
    }
}
