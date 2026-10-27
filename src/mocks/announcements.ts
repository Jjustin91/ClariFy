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
];

export const mockAnnouncements: Paginated<Announcement> = {
  data: mockAnnouncementList,
  meta: { current_page: 1, last_page: 1, per_page: 10, total: mockAnnouncementList.length },
};