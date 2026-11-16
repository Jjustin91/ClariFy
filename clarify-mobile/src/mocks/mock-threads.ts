// MOCK DATA: fake Q&A threads. NOT from the real backend.
// Thread field names are ASSUMED (see src/types/api.ts).
// The private thread (id 4) belongs to another student: a student must NOT see it.

import { ANONYMOUS_STUDENT_LABEL } from "@/lib/constants";
import type { Thread } from "@/types/api";

export const MOCK_THREADS: Thread[] = [
  {
    id: 1,
    channel_id: 7,
    announcement_id: 42,
    subject_hashtag: "#lab_schedule",
    content:
      "Good day, sir. Will the Friday lab consultation still push through at CEA?",
    is_private: false,
    status: "open",
    is_pinned_faq: false,
    author_name: "Kobeni Higashiyama",
    is_own: true,
    created_at: "2026-10-22T13:10:00+08:00",
    reply: null,
  },
  {
    id: 2,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: "#grade_consultation",
    content: "May I ask when the grade consultation schedule will be posted?",
    is_private: false,
    status: "resolved",
    is_pinned_faq: false,
    author_name: "Maria Santos",
    is_own: false,
    created_at: "2026-10-21T16:20:00+08:00",
    reply: {
      content:
        "Consultation slots will be posted on Monday. Please check the noticeboard.",
      author_name: "Aki Hayakawa",
      created_at: "2026-10-22T09:00:00+08:00",
    },
  },
  {
    id: 3,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: "#Defence",
    content: "What format should we use for the PIT defence slides?",
    is_private: false,
    status: "resolved",
    is_pinned_faq: true,
    // Public FAQ items must never show the real student name (FR-07).
    author_name: ANONYMOUS_STUDENT_LABEL,
    is_own: false,
    created_at: "2026-10-18T11:45:00+08:00",
    reply: {
      content: "Use the department template, maximum of 10 slides, PDF format.",
      author_name: "Aki Hayakawa",
      created_at: "2026-10-18T14:00:00+08:00",
    },
  },
  {
    id: 4,
    channel_id: 7,
    announcement_id: null,
    subject_hashtag: "#personal_concern",
    content: "I would like to discuss my absence record privately.",
    is_private: true,
    status: "open",
    is_pinned_faq: false,
    author_name: "Juan Dela Cruz",
    is_own: false,
    created_at: "2026-10-22T08:30:00+08:00",
    reply: null,
  },
];
