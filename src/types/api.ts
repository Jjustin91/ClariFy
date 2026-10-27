export type UserRole = 'student' | 'faculty' | 'dept_head' | 'it_admin';

export interface ReadReach {
  acknowledged_count: number;
  enrolled_total: number;
  percentage: number;
  has_current_user_acknowledged: boolean;
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