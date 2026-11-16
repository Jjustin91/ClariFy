// src/types/api.ts
// Single source of truth for API request/response shapes.
// All JSON keys are snake_case to match the Laravel 13 API (playbook §5.1).
//
// DOCUMENTED = shown in the playbook (§6.2 / §6.5).
// ASSUMED    = playbook mentions it but never shows the JSON.
//              Confirm with the backend lead before real API integration.

// ───────────────────────── Shared basics (DOCUMENTED) ─────────────────────────

export type UserRole = "student" | "faculty" | "dept_head" | "it_admin";

/** Wrapper for a single resource or action result (playbook §6.2). */
export interface ApiItemResponse<T> {
  message?: string; // ASSUMED optional: the sample shows it on a publish action
  data: T;
}

export interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

/** Paginated list wrapper (playbook §6.2). */
export interface ApiListResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/** HTTP 422 validation error body (playbook §6.3). */
export interface ValidationErrorResponse {
  message: string;
  errors: Record<string, string[]>;
}

// ───────────────────────── Announcements (DOCUMENTED) ─────────────────────────

export interface ReadReach {
  acknowledged_count: number;
  enrolled_total: number;
  percentage: number;
  has_current_user_acknowledged: boolean;
}

export interface AnnouncementPublisher {
  id: number;
  name: string;
  role: UserRole;
  department: string;
}

export type AnnouncementStatus = "published" | "draft";

export interface Announcement {
  id: number;
  channel_id: number;
  title: string;
  content: string;
  attachment_url: string | null; // null when no attachment is ASSUMED
  tags: string[];
  is_urgent: boolean;
  is_pinned: boolean;
  status: AnnouncementStatus; // 'archived' is not documented
  is_edited: boolean;
  published_at: string; // ISO 8601, e.g. "2026-10-22T12:35:00+08:00"
  updated_at: string;
  read_reach: ReadReach;
  publisher: AnnouncementPublisher;
}

/** Query params for GET /announcements. Only `latest` is documented for sort. */
export interface AnnouncementQuery {
  channel_id?: number;
  search?: string;
  department?: string;
  tag?: string;
  sort?: string;
  page?: number;
}

/** A picked file, as returned by the phone's image/document picker. */
export interface PickedFile {
  uri: string;
  name: string;
  mime_type: string;
}

/**
 * Values for POST /announcements (sent as FormData, playbook §6.5).
 * Faculty only; the backend enforces this (HTTP 403 for students).
 */
export interface CreateAnnouncementInput {
  channel_id: number;
  title: string;
  content: string;
  tags: string[];
  is_urgent: boolean;
  trigger_sms_fallback: boolean;
  status: AnnouncementStatus;
  attachment?: PickedFile;
}

/** Body for PATCH /announcements/{id} (playbook §6.5). */
export interface UpdateAnnouncementInput {
  title?: string;
  content?: string;
  is_urgent?: boolean;
  /** ASSUMED: not in the playbook. Used to publish a saved draft. Confirm with the backend lead. */
  status?: AnnouncementStatus;
}

// ───────────────────────── Devices / push (DOCUMENTED) ─────────────────────────

export interface DeviceTokenRequest {
  expo_push_token: string; // "ExponentPushToken[...]"
  platform: "android" | "ios";
}

// ───────────────────────── Auth (request DOCUMENTED, rest ASSUMED) ─────────────────────────

/** DOCUMENTED: POST /auth/login body. */
export interface LoginRequest {
  institutional_id: string;
  password: string;
}

/** ASSUMED: academic fields. The playbook only says /auth/me returns "academic_profile". */
export interface AcademicProfile {
  college?: string | null;
  department?: string | null;
  program?: string | null;
  year_level?: string | null;
}

/** ASSUMED: shape of the signed-in user (GET /auth/me). */
export interface AuthUser {
  id: number;
  name: string;
  role: UserRole;
  academic_profile: AcademicProfile | null;
  contact_number?: string | null; // FR-06
  avatar_url?: string | null; // FR-06
}

/** ASSUMED: where the token comes back from POST /auth/login is not documented. */
export interface LoginResult {
  token: string;
  user: AuthUser;
}

// ───────────────────────── Channels / Course Hubs (query DOCUMENTED, object ASSUMED) ─────────────────────────

/** DOCUMENTED: GET /channels query params. */
export interface ChannelQuery {
  search?: string;
  type?: "course_hub";
}

/** ASSUMED: channel object. Request fields name/description/channel_type are documented; the response is not. */
export interface Channel {
  id: number;
  name: string; // e.g. "#IT314 SoftEng"
  description: string | null;
  channel_type: string;
}

// ───────────────────────── Q&A threads (requests DOCUMENTED, object ASSUMED) ─────────────────────────

export type ThreadStatus = "open" | "resolved"; // from the documented ?status= filter

/** DOCUMENTED: GET /channels/{id}/threads query params. */
export interface ThreadQuery {
  announcement_id?: number;
  status?: ThreadStatus;
}

/** DOCUMENTED: POST /channels/{id}/threads body. */
export interface CreateThreadInput {
  announcement_id: number | null;
  subject_hashtag: string; // e.g. "#Defence"
  content: string;
  is_private: boolean;
}

/** DOCUMENTED: PATCH /threads/{id} body (student edits own inquiry). */
export interface UpdateThreadInput {
  content: string;
}

/** DOCUMENTED: POST /threads/{id}/replies body (faculty). */
export interface ReplyInput {
  content: string;
  mark_resolved: boolean;
  pin_to_faq: boolean;
}

/** ASSUMED: the faculty reply block shown inside a thread card. */
export interface ThreadReply {
  content: string;
  author_name: string;
  created_at: string;
}

/** ASSUMED: thread object. Field names are guessed from the playbook's UI description. */
export interface Thread {
  id: number;
  channel_id: number;
  announcement_id: number | null;
  subject_hashtag: string;
  content: string;
  is_private: boolean;
  status: ThreadStatus;
  is_pinned_faq: boolean;
  /** Real student name, or "Anonymous Student" when is_pinned_faq is true. */
  author_name: string;
  /** ASSUMED: true when the signed-in user wrote this inquiry (drives Edit/Delete visibility). */
  is_own: boolean;
  created_at: string;
  reply: ThreadReply | null;
}

// ───────────────────────── Instructors (query DOCUMENTED, object ASSUMED) ─────────────────────────

/** DOCUMENTED: GET /instructors query params. */
export interface InstructorQuery {
  search?: string;
  department?: string;
  sort?: string;
  page?: number;
}

/** ASSUMED: wireframes show avatar, name, campus, and department badge. */
export interface Instructor {
  id: number;
  name: string;
  avatar_url: string | null;
  campus: string | null;
  department: string;
}

// ───────────────────────── Profile (request DOCUMENTED, response ASSUMED) ─────────────────────────

/** POST /profile as multipart form data with _method "PATCH" (playbook §6.5, FR-06). */
export interface UpdateProfileInput {
  contact_number: string;
  avatar?: PickedFile;
}
