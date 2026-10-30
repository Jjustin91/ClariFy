import type {
  AdminMetricsResponse,
  Announcement,
  Channel,
  Instructor,
  LaravelValidationError,
  PaginatedResponse,
  PrismsSyncLog,
  QaThread,
  SingleResourceResponse,
  User,
  UserRole,
  VerificationStatus,
} from '../types/api';
import {
  DEMO_USERS,
  INITIAL_ADMIN_METRICS,
  INITIAL_ALL_USERS,
  INITIAL_ANNOUNCEMENTS,
  INITIAL_CHANNELS,
  INITIAL_INSTRUCTORS,
  INITIAL_PENDING_USERS,
  INITIAL_THREADS,
} from '../mocks/seed-data';
import {
  calculateAcknowledgedReadReach,
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  enforceFaqAnonymity,
  filterAndSortAnnouncements,
  formatSubjectHashtag,
} from './domain-logic';

// Always route browser requests through same-origin /api/v1 (which proxies server-side to LARAVEL_BACKEND_URL when active or executes the ClariFy API v1 engine)
export const API_BASE_URL = '/api/v1';

// Default to false so clarify-web connects directly to the /api/v1 REST API routes
export let USE_MOCK_API = false;

const STORAGE_KEYS = {
  USE_MOCK: 'clarify_use_mock_api',
  TOKEN: 'clarify_bearer_token',
  ROLE: 'clarify_active_role',
};

// In-memory mutable store for Mock API mode so all user journeys persist across views
let mockCurrentUser: User = { ...DEMO_USERS.student };
let mockChannels: Channel[] = structuredClone(INITIAL_CHANNELS);
let mockAnnouncements: Announcement[] = structuredClone(INITIAL_ANNOUNCEMENTS);
let mockThreads: QaThread[] = structuredClone(INITIAL_THREADS);
let mockInstructors: Instructor[] = structuredClone(INITIAL_INSTRUCTORS);
let mockPendingUsers: User[] = structuredClone(INITIAL_PENDING_USERS);
let mockAllUsers: User[] = structuredClone(INITIAL_ALL_USERS);
let mockMetrics: AdminMetricsResponse = structuredClone(INITIAL_ADMIN_METRICS);

export function getUseMockApi(): boolean {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(STORAGE_KEYS.USE_MOCK);
    if (saved !== null) {
      USE_MOCK_API = saved === 'true';
    }
  }
  return USE_MOCK_API;
}

export function setUseMockApi(value: boolean): void {
  USE_MOCK_API = value;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEYS.USE_MOCK, String(value));
  }
}

export function getStoredToken(): string {
  if (typeof window !== 'undefined') {
    return (
      window.localStorage.getItem(STORAGE_KEYS.TOKEN) ||
      `clarify-jwt-${mockCurrentUser.role}-${mockCurrentUser.institutional_id}`
    );
  }
  return `clarify-jwt-${mockCurrentUser.role}-${mockCurrentUser.institutional_id}`;
}

export function setStoredToken(token: string | null): void {
  if (typeof window !== 'undefined') {
    if (token) {
      window.localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.TOKEN);
    }
  }
}

export function switchDemoRole(role: 'student' | 'faculty' | 'it_admin'): User {
  mockCurrentUser = { ...DEMO_USERS[role] };
  setStoredToken(`clarify-jwt-${role}-${mockCurrentUser.institutional_id}`);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEYS.ROLE, role);
  }
  return mockCurrentUser;
}

export function getCurrentMockUser(): User {
  if (typeof window !== 'undefined') {
    const savedRole = window.localStorage.getItem(STORAGE_KEYS.ROLE) as
      | 'student'
      | 'faculty'
      | 'it_admin'
      | null;
    if (savedRole && DEMO_USERS[savedRole] && mockCurrentUser.role !== savedRole) {
      mockCurrentUser = { ...DEMO_USERS[savedRole] };
    }
  }
  return mockCurrentUser;
}

async function requestLaravel<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    setStoredToken(null);
    const err: LaravelValidationError = {
      status: 401,
      message: 'Your session has expired. Please log in again.',
    };
    throw err;
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err: LaravelValidationError & {
      verification_status?: VerificationStatus;
    } = {
      status: response.status,
      verification_status: json.verification_status,
      message:
        json.message ||
        (response.status === 403
          ? 'Access Denied: You do not have permission for this action (NFR-01_REV).'
          : 'An unexpected server error occurred.'),
      errors: json.errors,
    };
    throw err;
  }

  return json as T;
}

function createValidationError(
  message: string,
  errors: Record<string, string[]>
): LaravelValidationError {
  return {
    status: 422,
    message,
    errors,
  };
}

function createForbiddenError(message: string): LaravelValidationError {
  return {
    status: 403,
    message,
  };
}

// ============================================================================
// WORKFLOW 1: AUTH & PROFILE (NFR-01_REV, FR-06, FR-08)
// ============================================================================

export async function loginApi(
  institutional_id: string,
  password: string
): Promise<{
  token: string;
  user: User;
}> {
  if (!getUseMockApi()) {
    const res = await requestLaravel<{ token: string; data: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ institutional_id, password }),
    });
    mockCurrentUser = { ...res.data };
    setStoredToken(res.token);
    if (typeof window !== 'undefined') {
      const normalizedRole =
        res.data.role === 'faculty' || res.data.role === 'dept_head'
          ? 'faculty'
          : res.data.role === 'it_admin'
          ? 'it_admin'
          : 'student';
      window.localStorage.setItem(STORAGE_KEYS.ROLE, normalizedRole);
    }
    return { token: res.token, user: res.data };
  }

  const trimmedId = institutional_id.trim();
  const fieldErrors: Record<string, string[]> = {};
  if (!trimmedId) {
    fieldErrors.institutional_id = ['The institutional ID field is required.'];
  }
  if (!password.trim()) {
    fieldErrors.password = ['The password field is required.'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationError('The given data was invalid.', fieldErrors);
  }

  // Check if account is in pending verification queue (FR-08 / TC-FR08)
  const pendingMatch = mockPendingUsers.find(
    (u) => u.institutional_id === trimmedId && u.verification_status === 'pending'
  );
  if (pendingMatch || trimmedId === 'pending') {
    const pendingError: LaravelValidationError & {
      verification_status?: VerificationStatus;
    } = {
      status: 403,
      message:
        'Your account is pending IT Administrator registrar verification (FR-08).',
      verification_status: 'pending',
    };
    throw pendingError;
  }

  if (trimmedId === '10492' || trimmedId.toLowerCase().includes('aki')) {
    mockCurrentUser = { ...DEMO_USERS.faculty };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.ROLE, 'faculty');
    }
  } else if (trimmedId === '90001' || trimmedId.toLowerCase().includes('admin')) {
    mockCurrentUser = { ...DEMO_USERS.it_admin };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.ROLE, 'it_admin');
    }
  } else {
    mockCurrentUser = {
      ...DEMO_USERS.student,
      institutional_id: trimmedId || '2020202020',
    };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.ROLE, 'student');
    }
  }

  const token = `clarify-jwt-${mockCurrentUser.role}-${mockCurrentUser.institutional_id}`;
  setStoredToken(token);
  return { token, user: mockCurrentUser };
}

export async function logoutApi(): Promise<{ message: string }> {
  if (!getUseMockApi()) {
    await requestLaravel('/auth/logout', { method: 'POST' });
  }
  setStoredToken(null);
  return { message: 'Logged out successfully.' };
}

export async function getMeApi(): Promise<SingleResourceResponse<User>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<User>>('/auth/me');
  }
  return {
    data: getCurrentMockUser(),
  };
}

export async function updateProfileApi(
  formData: FormData
): Promise<SingleResourceResponse<User>> {
  if (!getUseMockApi()) {
    formData.set('_method', 'PATCH');
    return requestLaravel<SingleResourceResponse<User>>('/profile', {
      method: 'POST',
      body: formData,
    });
  }

  const contactNumber = String(formData.get('contact_number') || '').trim();
  const name = String(formData.get('name') || mockCurrentUser.name).trim();
  const avatarUrl = formData.get('avatar_preview_url') as string | null;

  if (!contactNumber) {
    throw createValidationError('The contact number field is required.', {
      contact_number: ['Please provide a valid mobile number for SMS fallback alerts (FR-06).'],
    });
  }

  mockCurrentUser = {
    ...mockCurrentUser,
    name: name || mockCurrentUser.name,
    contact_number: contactNumber,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
  };

  DEMO_USERS[mockCurrentUser.role === 'dept_head' ? 'faculty' : mockCurrentUser.role] = {
    ...mockCurrentUser,
  };

  return {
    message: 'Profile settings and SMS fallback number updated (FR-06).',
    data: mockCurrentUser,
  };
}

// ============================================================================
// WORKFLOW 5: SCOPED CHANNELS & ROSTER MANAGEMENT (FR-01_REV)
// ============================================================================

export async function getChannelsApi(params?: {
  search?: string;
  type?: string;
}): Promise<SingleResourceResponse<Channel[]>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.type) qs.set('type', params.type);
    return requestLaravel<SingleResourceResponse<Channel[]>>(
      `/channels?${qs.toString()}`
    );
  }

  const q = (params?.search || '').trim().toLowerCase();
  const filtered = mockChannels.filter((ch) => {
    if (params?.type && params.type !== 'all' && ch.channel_type !== params.type) {
      return false;
    }
    if (q) {
      const text = `${ch.name} ${ch.course_code || ''} ${ch.description || ''} ${ch.scope_department || ''}`.toLowerCase();
      return text.includes(q);
    }
    return true;
  });

  return { data: filtered };
}

export async function createChannelApi(payload: {
  course_code: string;
  name: string;
  description: string;
  channel_type: Channel['channel_type'];
  scope_college: string;
  scope_department: string;
  scope_section: string;
}): Promise<SingleResourceResponse<Channel>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Channel>>('/channels', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  const errors: Record<string, string[]> = {};
  if (!payload.name.trim()) {
    errors.name = ['The channel name field is required.'];
  }
  if (!payload.course_code.trim()) {
    errors.course_code = ['The course code field is required (e.g., IT315).'];
  }
  if (Object.keys(errors).length > 0) {
    throw createValidationError('Channel validation failed.', errors);
  }

  const formattedName = payload.name.trim().startsWith('#')
    ? payload.name.trim()
    : `# ${payload.name.trim()}`;

  const newChannel: Channel = {
    id: Math.max(0, ...mockChannels.map((c) => c.id)) + 1,
    course_code: payload.course_code.trim().toUpperCase(),
    name: formattedName,
    description: payload.description.trim() || `${payload.scope_section} Scoped Course Hub`,
    channel_type: payload.channel_type,
    scope_college: payload.scope_college,
    scope_department: payload.scope_department,
    scope_section: payload.scope_section,
    unread_count: 0,
    members_count: 1,
    instructor_name: mockCurrentUser.name,
    latest_activity_preview: `${mockCurrentUser.name}: Channel provisioned and ready for scoped notices.`,
    latest_activity_at: 'Just now',
    roster: [
      {
        id: mockCurrentUser.id,
        institutional_id: mockCurrentUser.institutional_id,
        name: mockCurrentUser.name,
        role: mockCurrentUser.role,
        section: payload.scope_section,
        department: payload.scope_department,
      },
    ],
  };

  mockChannels = [newChannel, ...mockChannels];
  return {
    message: 'Scoped channel created successfully.',
    data: newChannel,
  };
}

export async function joinChannelApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Channel>>(
      `/channels/${channelId}/join`,
      { method: 'POST' }
    );
  }

  const idx = mockChannels.findIndex((c) => c.id === channelId);
  if (idx === -1) {
    throw createValidationError('Channel not found.', {
      channel_id: ['Selected channel does not exist.'],
    });
  }

  const channel = mockChannels[idx];
  const roster = channel.roster || [];
  const exists = roster.some((m) => m.institutional_id === mockCurrentUser.institutional_id);

  if (!exists) {
    const updatedRoster = [
      ...roster,
      {
        id: mockCurrentUser.id,
        institutional_id: mockCurrentUser.institutional_id,
        name: mockCurrentUser.name,
        role: mockCurrentUser.role,
        section: mockCurrentUser.academic_profile?.section || 'IT3R2',
        department: mockCurrentUser.academic_profile?.department || 'CITC',
      },
    ];
    mockChannels[idx] = {
      ...channel,
      roster: updatedRoster,
      members_count: (channel.members_count || 41) + 1,
    };
  }

  return {
    message: `Enrolled in ${channel.name} roster.`,
    data: mockChannels[idx],
  };
}

export async function manageChannelMemberApi(
  channelId: number,
  payload: {
    institutional_id: string;
    name?: string;
    section?: string;
    action: 'add' | 'remove';
  }
): Promise<SingleResourceResponse<Channel>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Channel>>(
      `/channels/${channelId}/members`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  const idx = mockChannels.findIndex((c) => c.id === channelId);
  if (idx === -1) {
    throw createValidationError('Channel not found.', {
      channel_id: ['Channel not found.'],
    });
  }

  const target = mockChannels[idx];
  const currentRoster = target.roster || [];

  if (payload.action === 'add') {
    if (!payload.institutional_id.trim()) {
      throw createValidationError('Institutional ID is required.', {
        institutional_id: ['Please enter a valid student or faculty Institutional ID.'],
      });
    }
    const newMember = {
      id: Date.now(),
      institutional_id: payload.institutional_id.trim(),
      name: payload.name?.trim() || `USTP Student (${payload.institutional_id.trim()})`,
      role: 'student' as UserRole,
      section: payload.section || target.scope_section || 'IT3R2',
      department: target.scope_department || 'CITC',
    };
    mockChannels[idx] = {
      ...target,
      roster: [...currentRoster, newMember],
      members_count: (target.members_count || currentRoster.length) + 1,
    };
  } else {
    mockChannels[idx] = {
      ...target,
      roster: currentRoster.filter((m) => m.institutional_id !== payload.institutional_id),
      members_count: Math.max(1, (target.members_count || currentRoster.length) - 1),
    };
  }

  return {
    message:
      payload.action === 'add'
        ? 'Member added to channel roster.'
        : 'Member removed from channel roster.',
    data: mockChannels[idx],
  };
}

// ============================================================================
// WORKFLOWS 2 & 3: SCOPED ANNOUNCEMENTS, READ REACH & AUDITS (FR-02, FR-04_REV, FR-05, NFR-03_REV)
// ============================================================================

export async function getAnnouncementsApi(params?: {
  channel_id?: number | null;
  search?: string;
  department?: string;
  tag?: string;
  sort?: 'latest' | 'oldest' | 'urgent_first' | 'read_reach';
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<Announcement>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.channel_id) qs.set('channel_id', String(params.channel_id));
    if (params?.search) qs.set('search', params.search);
    if (params?.department && params.department !== 'ALL')
      qs.set('department', params.department);
    if (params?.tag && params.tag !== 'ALL') qs.set('tag', params.tag);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    return requestLaravel<PaginatedResponse<Announcement>>(
      `/announcements?${qs.toString()}`
    );
  }

  const includeDrafts = canPublishOrManageAnnouncements(mockCurrentUser.role);
  const sorted = filterAndSortAnnouncements(mockAnnouncements, {
    channelId: params?.channel_id,
    search: params?.search,
    department: params?.department,
    tag: params?.tag,
    sort: params?.sort,
    includeDrafts,
  });

  const page = Math.max(1, params?.page || 1);
  const perPage = params?.per_page || 4;
  const total = sorted.length;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage;
  const sliced = params?.per_page ? sorted.slice(start, start + perPage) : sorted;

  return {
    data: sliced,
    meta: {
      current_page: page,
      last_page: lastPage,
      per_page: perPage,
      total,
    },
  };
}

export async function createAnnouncementApi(
  formData: FormData
): Promise<SingleResourceResponse<Announcement>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Announcement>>('/announcements', {
      method: 'POST',
      body: formData,
    });
  }

  if (!canPublishOrManageAnnouncements(mockCurrentUser.role)) {
    throw createForbiddenError(
      'HTTP 403 Forbidden: Students are not authorized to publish announcements (TC-NFR01).'
    );
  }

  const title = String(formData.get('title') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const channelId = Number(formData.get('channel_id') || 7);
  const isUrgent = formData.get('is_urgent') === 'true';
  const triggerSms = formData.get('trigger_sms_fallback') === 'true';
  const status = (formData.get('status') as 'published' | 'draft') || 'published';
  const rawTags = formData.get('tags');
  const attachmentName = formData.get('attachment_name') as string | null;
  const attachmentType = formData.get('attachment_type') as 'image' | 'document' | null;

  const errors: Record<string, string[]> = {};
  if (!title) {
    errors.title = ['The title field is required.'];
  }
  if (!content) {
    errors.content = ['The announcement content field is required.'];
  }
  if (Object.keys(errors).length > 0) {
    throw createValidationError(
      'The title field is required. Please complete all mandatory fields.',
      errors
    );
  }

  let parsedTags: string[] = ['CDO CAMPUS', 'CITC', 'Faculty'];
  if (typeof rawTags === 'string' && rawTags.trim()) {
    try {
      parsedTags = JSON.parse(rawTags);
    } catch {
      parsedTags = rawTags.split(',').map((t) => t.trim());
    }
  }
  if (isUrgent && !parsedTags.includes('URGENT NOTICE')) {
    parsedTags = ['URGENT NOTICE', ...parsedTags];
  }

  const nowIso = new Date().toISOString();
  const newAnnouncement: Announcement = {
    id: Math.max(0, ...mockAnnouncements.map((a) => a.id)) + 1,
    channel_id: channelId,
    title,
    subtitle: 'USTP Digital Transformation',
    content,
    attachment_url: attachmentName ? `/storage/memos/${attachmentName}` : null,
    attachment_name: attachmentName || null,
    attachment_type: attachmentType || null,
    tags: parsedTags,
    is_urgent: isUrgent,
    is_pinned: isUrgent,
    trigger_sms_fallback: triggerSms,
    status,
    is_edited: false,
    published_at: nowIso,
    updated_at: nowIso,
    read_reach: {
      acknowledged_count: 0,
      enrolled_total: 42,
      percentage: 0.0,
      has_current_user_acknowledged: false,
    },
    publisher: {
      id: mockCurrentUser.id,
      name: mockCurrentUser.name,
      role: mockCurrentUser.role,
      department: mockCurrentUser.academic_profile?.department || 'CITC',
    },
  };

  mockAnnouncements = [newAnnouncement, ...mockAnnouncements];

  if (triggerSms) {
    mockMetrics.sms_fallback_dispatched_count += 42;
  }

  return {
    message: isUrgent
      ? 'Urgent Announcement published! Push alerts queued (<= 2.0s) and pinned to top.'
      : 'Announcement published to Course Hub.',
    data: newAnnouncement,
  };
}

export async function updateAnnouncementApi(
  id: number,
  payload: {
    title: string;
    content: string;
    tags?: string[];
    is_urgent?: boolean;
    trigger_sms_fallback?: boolean;
    status?: 'published' | 'draft' | 'archived';
  }
): Promise<SingleResourceResponse<Announcement>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Announcement>>(
      `/announcements/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  if (!canPublishOrManageAnnouncements(mockCurrentUser.role)) {
    throw createForbiddenError(
      'HTTP 403 Forbidden: Students cannot edit announcements.'
    );
  }

  const idx = mockAnnouncements.findIndex((a) => a.id === id);
  if (idx === -1) {
    throw createValidationError('Announcement not found.', {
      title: ['Target announcement does not exist.'],
    });
  }

  const errors: Record<string, string[]> = {};
  if (!payload.title.trim()) {
    errors.title = ['The title field is required.'];
  }
  if (!payload.content.trim()) {
    errors.content = ['The announcement content field is required.'];
  }
  if (Object.keys(errors).length > 0) {
    throw createValidationError('Validation failed.', errors);
  }

  const prev = mockAnnouncements[idx];
  const nowIso = new Date().toISOString();

  // Record immutable audit trail (NFR-03_REV / TC-NFR03)
  mockMetrics.announcement_audits = [
    {
      id: Math.max(700, ...mockMetrics.announcement_audits.map((a) => a.id)) + 1,
      announcement_id: prev.id,
      previous_title: prev.title,
      new_title: payload.title.trim(),
      previous_content: prev.content,
      new_content: payload.content.trim(),
      editor_id: mockCurrentUser.id,
      editor_name: mockCurrentUser.name,
      editor_role: mockCurrentUser.role,
      edited_at: nowIso,
    },
    ...mockMetrics.announcement_audits,
  ];

  const updated: Announcement = {
    ...prev,
    title: payload.title.trim(),
    content: payload.content.trim(),
    tags: payload.tags || prev.tags,
    is_urgent: payload.is_urgent ?? prev.is_urgent,
    is_pinned: payload.is_urgent ?? prev.is_pinned,
    trigger_sms_fallback: payload.trigger_sms_fallback ?? prev.trigger_sms_fallback,
    status: payload.status || prev.status,
    is_edited: true,
    updated_at: nowIso,
  };

  mockAnnouncements[idx] = updated;
  return {
    message: 'Announcement updated and audit trail logged (NFR-03_REV).',
    data: updated,
  };
}

export async function deleteAnnouncementApi(
  id: number
): Promise<{ message: string }> {
  if (!getUseMockApi()) {
    return requestLaravel<{ message: string }>(`/announcements/${id}`, {
      method: 'DELETE',
    });
  }

  if (!canPublishOrManageAnnouncements(mockCurrentUser.role)) {
    throw createForbiddenError(
      'HTTP 403 Forbidden: Students cannot delete announcements.'
    );
  }

  mockAnnouncements = mockAnnouncements.filter((a) => a.id !== id);
  return { message: 'Announcement archived and removed from active noticeboard.' };
}

export async function acknowledgeAnnouncementApi(
  id: number
): Promise<SingleResourceResponse<Announcement>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<Announcement>>(
      `/announcements/${id}/acknowledge`,
      { method: 'POST' }
    );
  }

  const idx = mockAnnouncements.findIndex((a) => a.id === id);
  if (idx === -1) {
    throw createValidationError('Announcement not found.', {});
  }

  const current = mockAnnouncements[idx];
  const updatedReadReach = calculateAcknowledgedReadReach(current.read_reach);
  mockAnnouncements[idx] = {
    ...current,
    read_reach: updatedReadReach,
  };

  return {
    message: 'Announcement marked as read and acknowledged.',
    data: mockAnnouncements[idx],
  };
}

// ============================================================================
// WORKFLOW 4: ISOLATED Q&A THREADS & 1-CLICK ANONYMIZED FAQS (FR-03_REV, FR-07, NFR-05)
// ============================================================================

export async function getChannelThreadsApi(
  channelId: number,
  params?: { status?: 'all' | 'resolved' | 'open' }
): Promise<SingleResourceResponse<QaThread[]>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    return requestLaravel<SingleResourceResponse<QaThread[]>>(
      `/channels/${channelId}/threads?${qs.toString()}`
    );
  }

  const list = mockThreads
    .filter((t) => t.channel_id === channelId)
    .filter((t) => {
      if (params?.status === 'resolved') return t.is_resolved;
      if (params?.status === 'open') return !t.is_resolved;
      return true;
    })
    .map((t) => enforceFaqAnonymity(t));

  return { data: list };
}

export async function createThreadApi(
  channelId: number,
  payload: {
    announcement_id?: number | null;
    subject_hashtag: string;
    content: string;
    is_private: boolean;
  }
): Promise<SingleResourceResponse<QaThread>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<QaThread>>(
      `/channels/${channelId}/threads`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  const formattedHashtag = formatSubjectHashtag(payload.subject_hashtag);
  const trimmedContent = payload.content.trim();

  const errors: Record<string, string[]> = {};
  if (!formattedHashtag) {
    errors.subject_hashtag = ['Please enter a subject hashtag (e.g., #Defence).'];
  }
  if (!trimmedContent) {
    errors.content = ['Please enter your inquiry or clarification details.'];
  }
  if (Object.keys(errors).length > 0) {
    throw createValidationError('Please complete all required inquiry fields.', errors);
  }

  const nowIso = new Date().toISOString();
  const newThread: QaThread = {
    id: Math.max(200, ...mockThreads.map((t) => t.id)) + 1,
    channel_id: channelId,
    announcement_id: payload.announcement_id || null,
    subject_hashtag: formattedHashtag,
    content: trimmedContent,
    is_private: payload.is_private,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: nowIso,
    updated_at: nowIso,
    author: {
      id: mockCurrentUser.id,
      name: mockCurrentUser.name,
      role: mockCurrentUser.role,
      avatar_url: mockCurrentUser.avatar_url || null,
    },
    replies: [],
  };

  mockThreads = [newThread, ...mockThreads];
  return {
    message: 'Academic inquiry ticket submitted to Course Hub.',
    data: newThread,
  };
}

export async function updateThreadApi(
  threadId: number,
  payload: { subject_hashtag?: string; content: string }
): Promise<SingleResourceResponse<QaThread>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<QaThread>>(`/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  const idx = mockThreads.findIndex((t) => t.id === threadId);
  if (idx === -1) {
    throw createValidationError('Inquiry thread not found.', {});
  }

  if (!payload.content.trim()) {
    throw createValidationError('The inquiry content cannot be empty.', {
      content: ['The inquiry content cannot be empty.'],
    });
  }

  const existing = mockThreads[idx];
  if (existing.is_resolved) {
    throw createForbiddenError('Resolved inquiries can no longer be edited.');
  }

  mockThreads[idx] = {
    ...existing,
    subject_hashtag: payload.subject_hashtag
      ? formatSubjectHashtag(payload.subject_hashtag)
      : existing.subject_hashtag,
    content: payload.content.trim(),
    updated_at: new Date().toISOString(),
  };

  return {
    message: 'Inquiry updated.',
    data: mockThreads[idx],
  };
}

export async function deleteThreadApi(
  threadId: number
): Promise<{ message: string }> {
  if (!getUseMockApi()) {
    return requestLaravel<{ message: string }>(`/threads/${threadId}`, {
      method: 'DELETE',
    });
  }

  mockThreads = mockThreads.filter((t) => t.id !== threadId);
  return { message: 'Inquiry ticket deleted.' };
}

export async function replyToThreadApi(
  threadId: number,
  payload: {
    content: string;
    mark_resolved: boolean;
    pin_to_faq: boolean;
  }
): Promise<SingleResourceResponse<QaThread>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<QaThread>>(
      `/threads/${threadId}/replies`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  const trimmed = payload.content.trim();
  if (!trimmed) {
    throw createValidationError('The reply content field is required.', {
      content: ['Please enter a message before submitting.'],
    });
  }

  const idx = mockThreads.findIndex((t) => t.id === threadId);
  if (idx === -1) {
    throw createValidationError('Thread not found.', {});
  }

  const canResolve = canResolveOrPinThreads(mockCurrentUser.role);
  const nowIso = new Date().toISOString();
  const target = mockThreads[idx];
  const newReply = {
    id: Date.now(),
    thread_id: threadId,
    content: trimmed,
    created_at: nowIso,
    author: {
      id: mockCurrentUser.id,
      name: mockCurrentUser.name,
      role: mockCurrentUser.role,
    },
  };

  const updatedThread: QaThread = enforceFaqAnonymity({
    ...target,
    is_resolved: canResolve
      ? payload.mark_resolved || payload.pin_to_faq || target.is_resolved
      : target.is_resolved,
    is_pinned_faq: canResolve
      ? payload.pin_to_faq || target.is_pinned_faq
      : target.is_pinned_faq,
    updated_at: nowIso,
    replies: [...target.replies, newReply],
  });

  mockThreads[idx] = updatedThread;
  return {
    message:
      canResolve && payload.pin_to_faq
        ? 'Reply posted, ticket resolved, and converted to anonymized Class FAQ (FR-07).'
        : 'Message posted to thread.',
    data: updatedThread,
  };
}

export async function convertThreadToFaqApi(
  threadId: number
): Promise<SingleResourceResponse<QaThread>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<QaThread>>(
      `/threads/${threadId}/convert-faq`,
      { method: 'POST' }
    );
  }

  if (!canResolveOrPinThreads(mockCurrentUser.role)) {
    throw createForbiddenError(
      'HTTP 403 Forbidden: Only instructors can publish Class FAQs (FR-07).'
    );
  }

  const idx = mockThreads.findIndex((t) => t.id === threadId);
  if (idx === -1) {
    throw createValidationError('Thread not found.', {});
  }

  const updated = enforceFaqAnonymity({
    ...mockThreads[idx],
    is_resolved: true,
    is_pinned_faq: true,
    updated_at: new Date().toISOString(),
  });

  mockThreads[idx] = updated;
  return {
    message: 'Pinned to Class FAQs with student identity masked as "Anonymous Student" (RA 10173).',
    data: updated,
  };
}

// ============================================================================
// INSTRUCTOR DIRECTORY (WIREFRAMES PAGES 3 & 6)
// ============================================================================

export async function getInstructorsApi(params?: {
  search?: string;
  department?: string;
  sort?: 'name' | 'department';
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<Instructor>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.department && params.department !== 'ALL')
      qs.set('department', params.department);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    return requestLaravel<PaginatedResponse<Instructor>>(
      `/instructors?${qs.toString()}`
    );
  }

  const q = (params?.search || '').trim().toLowerCase();
  const dept = params?.department || 'ALL';

  const filtered = mockInstructors
    .filter((inst) => {
      if (dept !== 'ALL' && inst.department !== dept) return false;
      if (q) {
        const hay = `${inst.name} ${inst.department} ${inst.specialization} ${inst.courses_handled.join(' ')}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (params?.sort === 'department') {
        return a.department.localeCompare(b.department);
      }
      return a.name.localeCompare(b.name);
    });

  const page = Math.max(1, params?.page || 1);
  const perPage = params?.per_page || 12;
  const total = filtered.length;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage;

  return {
    data: filtered.slice(start, start + perPage),
    meta: {
      current_page: page,
      last_page: lastPage,
      per_page: perPage,
      total,
    },
  };
}

// ============================================================================
// WORKFLOW 6: IT ADMIN CONSOLE (FR-08, FR-09, FR-10, NFR-03_REV)
// ============================================================================

export async function getPendingUsersApi(params?: {
  search?: string;
}): Promise<PaginatedResponse<User>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    return requestLaravel<PaginatedResponse<User>>(
      `/admin/users/pending?${qs.toString()}`
    );
  }

  const q = (params?.search || '').trim().toLowerCase();
  const filtered = mockPendingUsers.filter((u) => {
    if (!q) return true;
    return `${u.name} ${u.institutional_id} ${u.email} ${u.academic_profile?.department || ''}`
      .toLowerCase()
      .includes(q);
  });

  return {
    data: filtered,
    meta: {
      current_page: 1,
      last_page: 1,
      per_page: 20,
      total: filtered.length,
    },
  };
}

export async function verifyUserAccountApi(
  userId: number,
  verification_status: 'approved' | 'rejected'
): Promise<SingleResourceResponse<User>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<User>>(
      `/admin/users/${userId}/verify`,
      {
        method: 'PATCH',
        body: JSON.stringify({ verification_status }),
      }
    );
  }

  const idx = mockPendingUsers.findIndex((u) => u.id === userId);
  if (idx === -1) {
    throw createValidationError('Pending account not found.', {});
  }

  const updated: User = {
    ...mockPendingUsers[idx],
    verification_status,
  };

  mockPendingUsers = mockPendingUsers.filter((u) => u.id !== userId);
  if (verification_status === 'approved') {
    mockAllUsers = [updated, ...mockAllUsers];
    mockMetrics.verified_accounts_count += 1;
  }
  mockMetrics.pending_verifications_count = mockPendingUsers.length;

  return {
    message:
      verification_status === 'approved'
        ? `Account ${updated.institutional_id} verified against registrar records (FR-08).`
        : `Account ${updated.institutional_id} registration rejected.`,
    data: updated,
  };
}

export async function getAllUsersApi(params?: {
  search?: string;
}): Promise<SingleResourceResponse<User[]>> {
  if (!getUseMockApi()) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    return requestLaravel<SingleResourceResponse<User[]>>(
      `/admin/users?${qs.toString()}`
    );
  }

  const q = (params?.search || '').trim().toLowerCase();
  const filtered = mockAllUsers.filter((u) => {
    if (!q) return true;
    return `${u.name} ${u.institutional_id} ${u.role} ${u.academic_profile?.department || ''}`
      .toLowerCase()
      .includes(q);
  });

  return { data: filtered };
}

export async function updateUserRoleApi(
  userId: number,
  payload: { role: UserRole; department: string }
): Promise<SingleResourceResponse<User>> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<User>>(
      `/admin/users/${userId}/role`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  const idx = mockAllUsers.findIndex((u) => u.id === userId);
  if (idx === -1) {
    throw createValidationError('User not found.', {});
  }

  const target = mockAllUsers[idx];
  const updated: User = {
    ...target,
    role: payload.role,
    academic_profile: {
      campus: target.academic_profile?.campus || 'CDO Campus',
      college: payload.department,
      department: payload.department,
      program: target.academic_profile?.program || null,
      year_level: target.academic_profile?.year_level || null,
      section: target.academic_profile?.section || `${payload.department} Scope`,
      semester_code: target.academic_profile?.semester_code || '2026-1ST-SEM',
    },
  };

  mockAllUsers[idx] = updated;
  return {
    message: `Updated ${updated.name} role to ${payload.role.toUpperCase()} (${payload.department}) (FR-09).`,
    data: updated,
  };
}

export async function triggerPrismsSyncApi(
  semester_code: string
): Promise<{
  message: string;
  total_updated: number;
  log: PrismsSyncLog;
}> {
  if (!getUseMockApi()) {
    return requestLaravel<{
      message: string;
      total_updated: number;
      log: PrismsSyncLog;
    }>('/admin/sync-prisms', {
      method: 'POST',
      body: JSON.stringify({ semester_code }),
    });
  }

  const trimmed = semester_code.trim();
  if (!trimmed) {
    throw createValidationError('The semester_code field is required.', {
      semester_code: ['Please specify a target PRISMS semester code (e.g., 2026-1ST-SEM).'],
    });
  }

  const logEntry: PrismsSyncLog = {
    id: Math.max(900, ...mockMetrics.sync_logs.map((l) => l.id)) + 1,
    semester_code: trimmed,
    triggered_by: `${mockCurrentUser.name} (${mockCurrentUser.institutional_id})`,
    sync_type: 'manual_admin',
    total_updated: 1432,
    channels_provisioned: 39,
    status: 'completed',
    duration_ms: 810,
    executed_at: new Date().toISOString(),
  };

  mockMetrics.sync_logs = [logEntry, ...mockMetrics.sync_logs];
  mockMetrics.active_users_count = 1432;

  return {
    message: `PRISMS batch synchronization completed for ${trimmed} (FR-10).`,
    total_updated: logEntry.total_updated,
    log: logEntry,
  };
}

export async function getAdminMetricsApi(): Promise<
  SingleResourceResponse<AdminMetricsResponse>
> {
  if (!getUseMockApi()) {
    return requestLaravel<SingleResourceResponse<AdminMetricsResponse>>(
      '/admin/metrics'
    );
  }
  return {
    data: mockMetrics,
  };
}
