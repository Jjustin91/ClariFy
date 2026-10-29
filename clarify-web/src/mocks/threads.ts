import type { QaThread } from '@/types/api';

const now = '2026-10-29T09:00:00+08:00';

export const mockThreads: QaThread[] = [
  {
    id: 501,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#Defence',
    content: 'What should our team prepare for the capstone proposal defence?',
    is_private: false,
    status: 'open',
    is_pinned_faq: false,
    author_id: 1,
    author_name: 'Kobeni Higashiyama',
    created_at: now,
    updated_at: now,
    replies: [],
  },
  {
    id: 502,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#grade_consultation',
    content: 'Could I arrange a private consultation about my project grade?',
    is_private: true,
    status: 'resolved',
    is_pinned_faq: false,
    author_id: 2,
    author_name: 'Student',
    created_at: '2026-10-28T14:15:00+08:00',
    updated_at: '2026-10-29T08:30:00+08:00',
    replies: [
      {
        id: 601,
        content: 'Please send me a message through the department office to arrange a time.',
        author_id: 3,
        author_name: 'Aki Hayakawa',
        created_at: '2026-10-29T08:30:00+08:00',
      },
    ],
  },
  {
    id: 503,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: '#project_scope',
    content: 'How should we document the project scope in the proposal?',
    is_private: false,
    status: 'resolved',
    is_pinned_faq: true,
    author_id: 4,
    author_name: 'Sample Student',
    created_at: '2026-10-27T10:00:00+08:00',
    updated_at: '2026-10-28T11:00:00+08:00',
    replies: [
      {
        id: 602,
        content: 'Include the users, main workflows, and explicit exclusions in your scope section.',
        author_id: 3,
        author_name: 'Aki Hayakawa',
        created_at: '2026-10-28T11:00:00+08:00',
      },
    ],
  },
];
