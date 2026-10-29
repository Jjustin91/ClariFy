<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AcademicProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'campus',
        'college',
        'department',
        'program',
        'year_level',
        'section',
        'semester_code',
        'specialization',
        'office_location',
        'consultation_hours',
        'courses_handled',
    ];

    protected function casts(): array
    {
        return [
            'year_level' => 'integer',
            'courses_handled' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
