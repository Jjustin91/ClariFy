export type UserRole = 'student' | 'faculty' | 'dept_head' | 'it_admin';

export interface ReadReach {
  acknowledged_count: number;
  enrolled_total: number;
  percentage: number;
  has_current_user_acknowledged: boolean;
}

export interface Publisher {
  id: number;
  name: string;
  role: 'student' | 'faculty' | 'it_admin';
  department: string;
}

export interface Announcement {
  id: number;
  channel_id: number;
  title: string;
  content: string;
  attachment_url: string | null;
  tags: string[];
  is_urgent: boolean;
  is_pinned: boolean;
  status: 'published' | 'draft';
  is_edited: boolean;
  published_at: string;
  updated_at: string;
  read_reach: ReadReach;
  publisher: { id: number; name: string; role: UserRole; department: string };
}

export interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export interface AnnouncementFilters {
  channel_id?: number;
  search?: string;
  department?: string;
  tag?: string;
  sort?: 'latest' | 'oldest';
  page?: number;
}

export interface ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;
}

export type ThreadStatus = 'open' | 'resolved';

export interface ThreadReply {
  id: number;
  content: string;
  author_id: number;
  author_name: string;
  created_at: string;
}

export interface QaThread {
  id: number;
  channel_id: number;
  announcement_id: number | null;
  subject_hashtag: string;
  content: string;
  is_private: boolean;
  status: ThreadStatus;
  is_pinned_faq: boolean;
  author_id: number;
  author_name: string;
  created_at: string;
  updated_at: string;
  replies: ThreadReply[];
}

export interface ClassFaq {
  id: number;
  subject_hashtag: string;
  question: string;
  answer: string;
  published_at: string;
}

export interface CreateThreadInput {
  announcement_id: number | null;
  subject_hashtag: string;
  content: string;
  is_private: boolean;
}

export interface ThreadReplyInput {
  content: string;
  mark_resolved: boolean;
  pin_to_faq: boolean;
}

export interface InstructorDirectoryEntry {
  id: number;
  name: string;
  campus: string;
  department: string;
}

export interface InstructorFilters {
  search?: string;
  department?: string;
  sort?: 'name';
  page?: number;
}
