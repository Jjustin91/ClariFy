export type UserRole = 'student' | 'faculty' | 'dept_head' | 'it_admin';
export type VerificationStatus = 'pending' | 'approved' | 'rejected';

export interface AcademicProfile {
  campus: string;
  college: string;
  department: string;
  program: string | null;
  year_level: number | null;
  section: string | null;
  semester_code: string;
}

export interface User {
  id: number;
  institutional_id: string;
  name: string;
  email: string;
  contact_number?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  verification_status: VerificationStatus;
  academic_profile?: AcademicProfile;
}

export interface ChannelMember {
  id: number;
  institutional_id: string;
  name: string;
  role: UserRole;
  section: string | null;
  department: string;
}

export interface Channel {
  id: number;
  course_code: string | null;
  name: string;
  description: string | null;
  channel_type: 'university' | 'college' | 'department' | 'course_hub';
  scope_college: string | null;
  scope_department: string | null;
  scope_section: string | null;
  unread_count?: number;
  members_count?: number;
  latest_activity_preview?: string;
  latest_activity_at?: string;
  instructor_name?: string;
  roster?: ChannelMember[];
}

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
  subtitle?: string;
  attachment_url: string | null;
  attachment_name?: string | null;
  attachment_type?: 'image' | 'document' | null;
  tags: string[];
  is_urgent: boolean;
  is_pinned: boolean;
  trigger_sms_fallback?: boolean;
  status: 'draft' | 'published' | 'archived';
  is_edited: boolean;
  published_at: string;
  updated_at: string;
  read_reach: ReadReach;
  publisher: {
    id: number;
    name: string;
    role: UserRole;
    department: string;
    avatar_url?: string | null;
  };
}

export interface ThreadReply {
  id: number;
  thread_id: number;
  content: string;
  created_at: string;
  author: {
    id: number;
    name: string;
    role: UserRole;
    avatar_url?: string | null;
  };
}

export interface QaThread {
  id: number;
  channel_id: number;
  announcement_id: number | null;
  subject_hashtag: string;
  content: string;
  is_private: boolean;
  is_resolved: boolean;
  is_pinned_faq: boolean;
  created_at: string;
  updated_at: string;
  author: {
    id: number | null;
    name: string; // Strictly "Anonymous Student" when is_pinned_faq === true
    role: UserRole;
    avatar_url: string | null;
  };
  replies: ThreadReply[];
}

export interface Instructor {
  id: number;
  institutional_id: string;
  name: string;
  email: string;
  campus: string;
  college: string;
  department: 'CITC' | 'CEA' | 'COT' | 'CSM';
  specialization: string;
  office_location: string;
  consultation_hours: string;
  courses_handled: string[];
  avatar_url: string | null;
}

export interface AnnouncementAudit {
  id: number;
  announcement_id: number;
  previous_title: string;
  new_title: string;
  previous_content: string;
  new_content: string;
  editor_id: number;
  editor_name: string;
  editor_role: UserRole;
  edited_at: string;
}

export interface PrismsSyncLog {
  id: number;
  semester_code: string;
  triggered_by: string;
  sync_type: 'scheduled_midnight' | 'manual_admin';
  total_updated: number;
  channels_provisioned: number;
  status: 'completed' | 'partial_warning' | 'failed';
  duration_ms: number;
  executed_at: string;
}

export interface AdminMetricsResponse {
  active_users_count: number;
  verified_accounts_count: number;
  pending_verifications_count: number;
  push_queue_latency_seconds: number;
  sms_fallback_dispatched_count: number;
  overall_read_reach_percentage: number;
  sync_logs: PrismsSyncLog[];
  announcement_audits: AnnouncementAudit[];
}

export interface PaginatedMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface SingleResourceResponse<T> {
  message?: string;
  data: T;
}

export interface ChatMessage {
  id: number | string;
  channel_id: number;
  content: string;
  created_at: string;
  author: {
    id: number;
    name: string;
    role: UserRole;
    avatar_url?: string | null;
  };
}

export interface RealtimeEvent {
  revision: number;
  type:
    | 'connected'
    | 'announcement.created'
    | 'announcement.updated'
    | 'announcement.deleted'
    | 'announcement.acknowledged'
    | 'chat.message'
    | 'thread.created'
    | 'thread.updated'
    | 'thread.deleted'
    | 'thread.replied'
    | 'thread.faq_pinned'
    | 'channel.created'
    | 'channel.updated'
    | 'admin.updated'
    | 'db.changed';
  channel_id?: number;
  actor_id?: number;
  timestamp: string;
}

export interface PersistenceStatus {
  driver: 'postgresql-direct' | 'laravel-postgresql' | 'memory-fallback';
  database?: string;
  host?: string;
  connected: boolean;
  revision: number;
}

export interface LaravelValidationError {
  status: number;
  message: string;
  errors?: Record<string, string[]>;
}

