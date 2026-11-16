// MOCK DATA: fake announcements. NOT from the real backend.
// Announcement 42 copies the sample in the playbook (§6.2); the rest are invented.
// The feed logic (later) is responsible for sorting: urgent/pinned first, then newest.

import type { Announcement, AnnouncementPublisher } from "@/types/api";

const AKI: AnnouncementPublisher = {
  id: 10492,
  name: "Aki Hayakawa",
  role: "faculty",
  department: "CITC",
};

export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 42,
    channel_id: 7,
    title: "CITC Lab Room Reassignment: IT314 moved to CEA",
    content:
      "Please be advised that all IT3R2 Software Engineering laboratory consultations are moved to the CEA building until further notice.",
    attachment_url:
      "https://api.clarify.ustp.edu.ph/storage/memos/lab-move.pdf",
    tags: [
      "URGENT NOTICE",
      "OFFICIAL MEMO",
      "CDO CAMPUS",
      "CITC",
      "MEMORANDUM",
    ],
    is_urgent: true,
    is_pinned: true,
    status: "published",
    is_edited: true,
    published_at: "2026-10-22T12:35:00+08:00",
    updated_at: "2026-10-22T12:50:00+08:00",
    read_reach: {
      acknowledged_count: 1,
      enrolled_total: 42,
      percentage: 2.4,
      has_current_user_acknowledged: false,
    },
    publisher: AKI,
  },
  {
    id: 41,
    channel_id: 7,
    title: "PIT Submission Window Opens Next Week",
    content:
      "The Performance Innovative Task (PIT) submission window opens on Monday. Make sure your repository link is ready.",
    attachment_url: null,
    tags: ["OFFICIAL MEMO", "CITC"],
    is_urgent: false,
    is_pinned: false,
    status: "published",
    is_edited: false,
    published_at: "2026-10-21T09:00:00+08:00",
    updated_at: "2026-10-21T09:00:00+08:00",
    read_reach: {
      acknowledged_count: 30,
      enrolled_total: 42,
      percentage: 71.4,
      has_current_user_acknowledged: true,
    },
    publisher: AKI,
  },
  {
    id: 40,
    channel_id: 8,
    title: "Quiz Moved to Friday",
    content:
      "The ES211a quiz is moved from Wednesday to Friday, same time and room.",
    attachment_url: null,
    tags: ["CITC"],
    is_urgent: false,
    is_pinned: false,
    status: "published",
    is_edited: false,
    published_at: "2026-10-20T15:30:00+08:00",
    updated_at: "2026-10-20T15:30:00+08:00",
    read_reach: {
      acknowledged_count: 18,
      enrolled_total: 40,
      percentage: 45,
      has_current_user_acknowledged: false,
    },
    publisher: {
      id: 10493,
      name: "Maria Lourdes Reyes",
      role: "faculty",
      department: "CITC",
    },
  },
  {
    id: 39,
    channel_id: 7,
    title: "Class Suspension Due to Severe Weather",
    content:
      "All face-to-face classes are suspended tomorrow. Please check this channel for updates.",
    attachment_url: null,
    tags: ["URGENT NOTICE", "CDO CAMPUS"],
    is_urgent: true,
    is_pinned: true,
    status: "published",
    is_edited: false,
    published_at: "2026-10-19T18:00:00+08:00",
    updated_at: "2026-10-19T18:00:00+08:00",
    read_reach: {
      acknowledged_count: 12,
      enrolled_total: 42,
      percentage: 28.6,
      has_current_user_acknowledged: false,
    },
    publisher: AKI,
  },
  {
    id: 38,
    channel_id: 7,
    title: "Group Presentation Schedule",
    content:
      "The schedule for group presentations is attached. Please confirm your slot.",
    attachment_url:
      "https://api.clarify.ustp.edu.ph/storage/memos/schedule.pdf",
    tags: ["MEMORANDUM", "CITC"],
    is_urgent: false,
    is_pinned: false,
    status: "published",
    is_edited: false,
    published_at: "2026-10-15T10:00:00+08:00",
    updated_at: "2026-10-15T10:00:00+08:00",
    read_reach: {
      acknowledged_count: 40,
      enrolled_total: 42,
      percentage: 95.2,
      has_current_user_acknowledged: true,
    },
    publisher: AKI,
  },
  {
    // A DRAFT: students must never see this one. Faculty can.
    id: 37,
    channel_id: 7,
    title: "Draft: Midterm Reminders",
    content: "Work in progress. Not yet published.",
    attachment_url: null,
    tags: ["OFFICIAL MEMO"],
    is_urgent: false,
    is_pinned: false,
    status: "draft",
    is_edited: false,
    published_at: "2026-10-14T08:00:00+08:00",
    updated_at: "2026-10-14T08:00:00+08:00",
    read_reach: {
      acknowledged_count: 0,
      enrolled_total: 42,
      percentage: 0,
      has_current_user_acknowledged: false,
    },
    publisher: AKI,
  },
];
