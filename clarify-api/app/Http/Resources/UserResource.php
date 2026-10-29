<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $profile = $this->academicProfile;

        return [
            'id' => $this->id,
            'institutional_id' => $this->institutional_id,
            'name' => $this->name,
            'email' => $this->email,
            'contact_number' => $this->contact_number,
            'avatar_url' => $this->avatar_url,
            'role' => $this->role,
            'verification_status' => $this->verification_status,
            'academic_profile' => $profile ? [
                'campus' => $profile->campus,
                'college' => $profile->college,
                'department' => $profile->department,
                'program' => $profile->program,
                'year_level' => $profile->year_level,
                'section' => $profile->section,
                'semester_code' => $profile->semester_code,
            ] : null,
        ];
    }
}
