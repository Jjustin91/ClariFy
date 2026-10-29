<?php

namespace Database\Seeders;

use App\Models\AcademicProfile;
use App\Models\Announcement;
use App\Models\AnnouncementAudit;
use App\Models\AnnouncementRead;
use App\Models\Channel;
use App\Models\Message;
use App\Models\PrismsSyncLog;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Primary Demo Users (Student Kobeni, Faculty Aki, IT Admin Makima)
        $kobeni = new User([
            'institutional_id' => '2020202020',
            'name' => 'Kobeni Higashiyama',
            'email' => 'higashiyama.kobeni@ustp.edu.ph',
            'password' => 'ustp2026',
            'contact_number' => '+63 917 842 2020',
        ]);
        $kobeni->role = 'student';
        $kobeni->verification_status = 'approved';
        $kobeni->verified_at = now();
        $kobeni->save();

        AcademicProfile::create([
            'user_id' => $kobeni->id,
            'campus' => 'CDO Campus',
            'college' => 'CITC',
            'department' => 'CITC',
            'program' => 'BS Information Technology',
            'year_level' => 3,
            'section' => 'IT3R2',
            'semester_code' => '2026-1ST-SEM',
        ]);

        $aki = new User([
            'institutional_id' => '10492',
            'name' => 'Aki Hayakawa',
            'email' => 'aki.hayakawa@ustp.edu.ph',
            'password' => 'ustp2026',
            'contact_number' => '+63 917 550 0492',
        ]);
        $aki->role = 'faculty';
        $aki->verification_status = 'approved';
        $aki->verified_at = now();
        $aki->save();

        AcademicProfile::create([
            'user_id' => $aki->id,
            'campus' => 'CDO Campus',
            'college' => 'CITC',
            'department' => 'CITC',
            'program' => 'BS Information Technology',
            'section' => 'CITC Dept',
            'semester_code' => '2026-1ST-SEM',
            'specialization' => 'Software Engineering & Distributed Systems',
            'office_location' => 'ICT Bldg Room 304',
            'consultation_hours' => 'MWF 1:00 PM – 4:00 PM',
            'courses_handled' => ['IT314 Software Engineering', 'IT321 Capstone Project 1'],
        ]);

        $admin = new User([
            'institutional_id' => '90001',
            'name' => 'Engr. Makima Cruz',
            'email' => 'icto.admin@ustp.edu.ph',
            'password' => 'ustp2026',
            'contact_number' => '+63 917 900 0001',
        ]);
        $admin->role = 'it_admin';
        $admin->verification_status = 'approved';
        $admin->verified_at = now();
        $admin->save();

        AcademicProfile::create([
            'user_id' => $admin->id,
            'campus' => 'CDO Campus',
            'college' => 'ICTO',
            'department' => 'CITC',
            'section' => 'Registrar & ICTO',
            'semester_code' => '2026-1ST-SEM',
        ]);

        // Pending Account for FR-08 Verification Queue
        $pendingStudent = new User([
            'institutional_id' => '2023309999',
            'name' => 'Nayuta Hayakawa',
            'email' => 'nayuta.hayakawa@ustp.edu.ph',
            'password' => 'ustp2026',
            'contact_number' => '+63 917 301 9999',
        ]);
        $pendingStudent->role = 'student';
        $pendingStudent->verification_status = 'pending';
        $pendingStudent->save();

        AcademicProfile::create([
            'user_id' => $pendingStudent->id,
            'campus' => 'CDO Campus',
            'college' => 'CITC',
            'department' => 'CITC',
            'program' => 'BS Information Technology',
            'year_level' => 3,
            'section' => 'IT3R2',
            'semester_code' => '2026-1ST-SEM',
        ]);

        // 2. Scoped Course Hub Channels
        $it314 = Channel::create([
            'course_code' => 'IT314',
            'name' => '# IT314 SoftEng',
            'description' => 'IT3R2 — Software Engineering Hub (Agile Sprint Reviews, SRS & Capstone Architecture)',
            'channel_type' => 'course_hub',
            'scope_college' => 'CITC',
            'scope_department' => 'CITC',
            'scope_section' => 'IT3R2',
            'instructor_name' => 'Aki Hayakawa',
            'created_by' => $aki->id,
        ]);

        $it314->members()->syncWithoutDetaching([
            $aki->id => ['can_publish' => true, 'joined_at' => now()],
            $kobeni->id => ['can_publish' => false, 'joined_at' => now()],
        ]);

        // 3. Official Scoped Announcements
        $memo42 = Announcement::create([
            'channel_id' => $it314->id,
            'publisher_id' => $aki->id,
            'title' => 'CITC Lab Room Reassignment: IT314 moved to CEA',
            'subtitle' => 'USTP Digital Transformation',
            'content' => 'Please be advised that all IT3R2 Software Engineering laboratory consultations scheduled today are reassigned to CEA Room 302 due to scheduled CITC network servicing. Be on time and bring your Group 5 SRS & API Playbook artifacts.',
            'attachment_url' => '/storage/memos/citc-lab-room-reassignment-cea-302.pdf',
            'attachment_name' => 'Memo_042_CITC_Lab_Reassignment_CEA302.pdf',
            'attachment_type' => 'document',
            'tags' => ['URGENT NOTICE', 'OFFICIAL MEMO', 'CDO CAMPUS', 'CITC', 'MEMORANDUM'],
            'is_urgent' => true,
            'is_pinned' => true,
            'trigger_sms_fallback' => true,
            'status' => 'published',
            'is_edited' => true,
            'published_at' => now()->subMinutes(45),
        ]);

        AnnouncementRead::create([
            'announcement_id' => $memo42->id,
            'user_id' => $aki->id,
            'acknowledged_at' => now()->subMinutes(40),
        ]);

        AnnouncementAudit::create([
            'announcement_id' => $memo42->id,
            'editor_id' => $aki->id,
            'previous_title' => 'CITC Lab Room Change: IT314',
            'new_title' => 'CITC Lab Room Reassignment: IT314 moved to CEA',
            'previous_content' => 'IT3R2 Software Engineering lab consultations moved to CEA building today.',
            'new_content' => $memo42->content,
            'edited_at' => now()->subMinutes(30),
        ]);

        // 4. Isolated Q&A Threads & 1-Click Anonymized FAQs
        $faqThread = Message::create([
            'channel_id' => $it314->id,
            'announcement_id' => $memo42->id,
            'sender_id' => $kobeni->id,
            'parent_id' => null,
            'subject_hashtag' => '#When_po_defence_maam',
            'content' => 'When po defence maam? and what possible need i bring, need ba mag formal or semi casual lng pud hehe. thank you sa pag answer maam unta ma daghan imo kwarta',
            'is_private' => false,
            'is_resolved' => true,
            'is_pinned_faq' => true,
        ]);

        Message::create([
            'channel_id' => $it314->id,
            'announcement_id' => $memo42->id,
            'sender_id' => $aki->id,
            'parent_id' => $faqThread->id,
            'content' => "A4 paper, Times New Roman 12 font size. Strictly semi-casual attire. Don't be late — panelist schedule cannot be moved, print your documents at least 3 copies.",
        ]);

        // 5. Initial PRISMS Sync Log
        PrismsSyncLog::create([
            'semester_code' => '2026-1ST-SEM',
            'triggered_by' => 'System Cron (SyncPrismsRoster)',
            'sync_type' => 'scheduled_midnight',
            'total_updated' => 1428,
            'channels_provisioned' => 38,
            'status' => 'completed',
            'duration_ms' => 1420,
            'executed_at' => now()->subHours(5),
        ]);
    }
}
