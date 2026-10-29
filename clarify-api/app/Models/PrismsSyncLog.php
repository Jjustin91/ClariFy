<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PrismsSyncLog extends Model
{
    protected $fillable = [
        'semester_code',
        'triggered_by',
        'sync_type',
        'total_updated',
        'channels_provisioned',
        'status',
        'duration_ms',
        'executed_at',
    ];

    protected function casts(): array
    {
        return [
            'total_updated' => 'integer',
            'channels_provisioned' => 'integer',
            'duration_ms' => 'integer',
            'executed_at' => 'datetime',
        ];
    }
}
