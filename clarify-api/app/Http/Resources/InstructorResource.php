<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InstructorResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $profile = $this->academicProfile;

        return [
            'id' => $this->id,
            'institutional_id' => $this->institutional_id,
            'name' => mb_strtoupper($this->name),
            'email' => $this->email,
            'campus' => $profile?->campus ?? 'CDO Campus',
            'college' => $profile?->college ?? 'CITC',
            'department' => $profile?->department ?? 'CITC',
            'specialization' => $profile?->specialization ?? 'Software Engineering & Computing',
            'office_location' => $profile?->office_location ?? 'ICT Bldg Room 304',
            'consultation_hours' => $profile?->consultation_hours ?? 'MWF 1:00 PM – 4:00 PM',
            'courses_handled' => $profile?->courses_handled ?? ['IT314 Software Engineering'],
            'avatar_url' => $this->avatar_url,
        ];
    }
}
