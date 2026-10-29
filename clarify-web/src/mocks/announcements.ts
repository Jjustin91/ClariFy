import type { Announcement, Paginated } from '@/types/api';

const base = { attachment_url: null, status: 'published' as const };

export const mockAnnouncementList: Announcement[] = [
  {
    ...base,
    id: 42,
    channel_id: 7,
    title: 'CITC Lab Room Reassignment: IT314 moved to CEA',
    content: 'Please be advised that all IT3R2 laboratory consultations are moved to CEA.',
    tags: ['URGENT NOTICE', 'OFFICIAL MEMO', 'CITC'],
    is_urgent: true,
    is_pinned: true,
    is_edited: true,
    published_at: '2026-10-22T12:35:00+08:00',
    updated_at: '2026-10-22T12:50:00+08:00',
    read_reach: { acknowledged_count: 1, enrolled_total: 42, percentage: 2.4, has_current_user_acknowledged: false },
    publisher: { id: 10492, name: 'Aki Hayakawa', role: 'faculty', department: 'CITC' },
  },
  {
    ...base,
    id: 41,
    channel_id: 7,
    title: 'ES211a Midterm Schedule',
    content: 'Midterm exams will be held on November 5. Bring your own calculator.',
    tags: ['OFFICIAL MEMO', 'CITC'],
    is_urgent: false,
    is_pinned: false,
    is_edited: false,
    published_at: '2026-10-20T09:00:00+08:00',
    updated_at: '2026-10-20T09:00:00+08:00',
    read_reach: { acknowledged_count: 18, enrolled_total: 42, percentage: 42.9, has_current_user_acknowledged: false },
    publisher: { id: 10492, name: 'Aki Hayakawa', role: 'faculty', department: 'CITC' },
  },
  {
    ...base,
    id: 40,
    channel_id: 8,
    title: 'Campus-wide Memorandum: Foundation Week',
    content: 'Classes are suspended on November 12 for Foundation Week activities.',
    tags: ['CDO CAMPUS', 'MEMORANDUM'],
    is_urgent: false,
    is_pinned: false,
    is_edited: false,
    published_at: '2026-10-18T15:00:00+08:00',
    updated_at: '2026-10-18T15:00:00+08:00',
    read_reach: { acknowledged_count: 30, enrolled_total: 42, percentage: 71.4, has_current_user_acknowledged: true },
    publisher: { id: 20001, name: 'Dean Reyes', role: 'dept_head', department: 'CEA' },
  },
  {
    id: 101,
    channel_id: 7,
    title: 'IMPORTANT: Comprehensive IT314 Software Engineering Capstone & Laboratory Regulations for First Semester',
    content:
      'Please be strictly advised that all IT3R2 Software Engineering laboratory consultations, sprint reviews, and architectural milestone presentations scheduled for this semester will be held across both the CITC Main Building and the newly designated CEA Computer Lab 3. All student teams are required to submit their updated system sequence diagrams, Laravel 13 API contracts, database migration scripts, and frontend component documentation no later than midnight prior to their scheduled consultation date. Failure to adhere to these guidelines will result in an immediate forfeiture of sprint points. Furthermore, ensure that all pull requests opened against the primary repository strictly follow our agreed Conventional Commit standards and pass all automated TypeScript and ESLint validation checks before requesting a review from your designated lead developer or course instructor. If you encounter any severe environment setup blockers, CORS errors, or missing database seeders, post directly in the designated team communication channel following the 30-minute escalation rule.',
    attachment_url: 'https://example.com/memos/comprehensive-regulations.pdf',
    tags: ['URGENT NOTICE', 'OFFICIAL MEMO', 'CITC', 'CDO CAMPUS'],
    is_urgent: true,
    is_pinned: true,
    status: 'published',
    is_edited: true,
    published_at: '2026-10-22T08:30:00+08:00',
    updated_at: '2026-10-22T09:15:00+08:00',
    read_reach: {
      acknowledged_count: 18,
      enrolled_total: 42,
      percentage: 42.8,
      has_current_user_acknowledged: false,
    },
    publisher: {
      id: 10492,
      name: 'Aki Hayakawa',
      role: 'faculty',
      department: 'CITC',
    },
  },
];

export const mockAnnouncements: Paginated<Announcement> = {
  data: mockAnnouncementList,
  meta: { current_page: 1, last_page: 1, per_page: 10, total: mockAnnouncementList.length },
};