import type {
  AdminMetricsResponse,
  Announcement,
  Channel,
  ChatMessage,
  Instructor,
  LaravelValidationError,
  PaginatedResponse,
  PersistenceStatus,
  PrismsSyncLog,
  QaThread,
  SingleResourceResponse,
  User,
  UserRole,
  VerificationStatus,
} from '../types/api';

// Always route browser requests through same-origin /api/v1 (which connects to PostgreSQL directly or proxies to LARAVEL_BACKEND_URL)
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://clarify-api-4jwj.onrender.com/api/v1';
export const API_BASE_URL = RAW_API_URL.replace(/\/+$/, '');

const STORAGE_KEYS = {
  TOKEN: 'clarify_bearer_token',
  ROLE: 'clarify_active_role',
  USER: 'clarify_active_user',
};

const UNAUTHENTICATED_PLACEHOLDER_USER: User = {
  id: 0,
  institutional_id: '',
  name: 'Guest',
  email: '',
  contact_number: null,
  role: 'student',
  verification_status: 'pending',
  academic_profile: {
    campus: 'CDO Campus',
    college: 'CITC',
    department: 'CITC',
    program: null,
    year_level: null,
    section: null,
    semester_code: '2026-1ST-SEM',
  },
};

/**
 * Returns the authenticated user for the current browser tab (from sessionStorage),
 * or null if this tab is not signed in.
 */
export function getStoredSessionUser(): User | null {
  if (typeof window !== 'undefined') {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as User;
        if (parsed && parsed.institutional_id && parsed.role) {
          return parsed;
        }
      } catch {
        // Ignore corrupted JSON
      }
    }
  }
  return null;
}

export function getStoredUser(): User {
  return getStoredSessionUser() || UNAUTHENTICATED_PLACEHOLDER_USER;
}

export function setStoredUser(user: User | null): void {
  if (typeof window !== 'undefined') {
    // Clean up any legacy shared localStorage keys so tabs remain strictly isolated
    try {
      window.localStorage.removeItem(STORAGE_KEYS.USER);
      window.localStorage.removeItem(STORAGE_KEYS.ROLE);
    } catch {
      // Ignore storage access errors
    }

    if (user && user.institutional_id) {
      window.sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      window.sessionStorage.setItem(STORAGE_KEYS.ROLE, user.role);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEYS.USER);
      window.sessionStorage.removeItem(STORAGE_KEYS.ROLE);
    }
  }
}

export function getStoredToken(): string | null {
  if (typeof window !== 'undefined') {
    const saved = window.sessionStorage.getItem(STORAGE_KEYS.TOKEN);
    if (saved) return saved;
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.TOKEN);
    } catch {
      // Ignore storage access errors
    }

    if (token) {
      window.sessionStorage.setItem(STORAGE_KEYS.TOKEN, token);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
    }
  }
}

export function clearStoredSession(): void {
  setStoredToken(null);
  setStoredUser(null);
}

async function requestLaravel<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const activeUser = getStoredSessionUser();
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeUser?.institutional_id
      ? { 'X-Clarify-Institutional-Id': activeUser.institutional_id }
      : {}),
    ...(activeUser?.id ? { 'X-Clarify-User-Id': String(activeUser.id) } : {}),
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  let response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    cache: 'no-store',
  });

  if (response.status === 401) {
    clearStoredSession();
    const err: LaravelValidationError = {
      status: 401,
      message: 'Please sign in to access ClariFy.',
    };
    throw err;
  }

  let json = await response.json().catch(() => ({}));

  // Self-healing recovery if remote PostgreSQL has not yet added channel_user.approval_status
  if (
    !response.ok &&
    response.status >= 500 &&
    typeof json?.message === 'string' &&
    json.message.includes('approval_status')
  ) {
    try {
      const matchChannelId = json.message.match(
        /where\s+"channel_user"\."channel_id"\s+in\s+\((\d+)\)/i
      );
      const targetMigrateChannelId = matchChannelId ? Number(matchChannelId[1]) : 1;

      await fetch(`${API_BASE_URL}/channels/${targetMigrateChannelId}/join`, {
        method: 'POST',
        headers,
        cache: 'no-store',
      });

      if (
        endpoint === '/channels' &&
        (options.method || 'GET').toUpperCase() === 'POST' &&
        matchChannelId
      ) {
        const listRes = await fetch(`${API_BASE_URL}/channels`, {
          method: 'GET',
          headers,
          cache: 'no-store',
        });
        if (listRes.ok) {
          const listJson = await listRes.json().catch(() => ({}));
          const createdChannel = Array.isArray(listJson?.data)
            ? listJson.data.find(
                (ch: { id?: number }) => Number(ch?.id) === targetMigrateChannelId
              )
            : null;
          if (createdChannel) {
            return {
              message: 'Scoped channel created successfully.',
              data: createdChannel,
            } as unknown as T;
          }
        }
      }

      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        cache: 'no-store',
      });
      json = await response.json().catch(() => ({}));
    } catch {
      // Fall through to standard error handling if recovery fails
    }
  }

  if (!response.ok) {
    const err: LaravelValidationError & {
      verification_status?: VerificationStatus;
    } = {
      status: response.status,
      verification_status: json.verification_status,
      message:
        json.message ||
        (response.status === 403
          ? 'Access Denied: You do not have permission for this action.'
          : 'An unexpected server error occurred.'),
      errors: json.errors,
    };
    throw err;
  }

  const method = (options.method || 'GET').toUpperCase();
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    typeof window !== 'undefined' &&
    'BroadcastChannel' in window
  ) {
    try {
      const bc = new BroadcastChannel('clarify_realtime_sync');
      bc.postMessage({
        type: 'mutation',
        endpoint,
        data: json?.data,
        timestamp: Date.now(),
      });
      bc.close();
    } catch {
      // Ignore BroadcastChannel errors
    }
  }

  return json as T;
}

// ============================================================================
// WORKFLOW 1: AUTH, REGISTRATION & PROFILE
// ============================================================================

export async function registerApi(payload: {
  name: string;
  institutional_id: string;
  email: string;
  password: string;
  password_confirmation?: string;
  role: 'student' | 'faculty';
  department: string;
  section: string;
}): Promise<SingleResourceResponse<User>> {
  return requestLaravel<SingleResourceResponse<User>>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      password_confirmation: payload.password_confirmation || payload.password,
    }),
  });
}

export async function loginApi(
  institutional_id: string,
  password: string
): Promise<{
  token: string;
  user: User;
}> {
  const res = await requestLaravel<{ token: string; data: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ institutional_id, password }),
  });
  setStoredUser(res.data);
  setStoredToken(res.token);
  return { token: res.token, user: res.data };
}

export async function logoutApi(): Promise<{ message: string }> {
  try {
    await requestLaravel('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors if token already invalidated
  }
  clearStoredSession();
  return { message: 'Logged out successfully.' };
}

export async function getMeApi(): Promise<SingleResourceResponse<User>> {
  const res = await requestLaravel<SingleResourceResponse<User>>('/auth/me');
  if (res?.data) {
    setStoredUser(res.data);
  }
  return res;
}

export async function updateProfileApi(
  formData: FormData
): Promise<SingleResourceResponse<User>> {
  formData.set('_method', 'PATCH');
  const res = await requestLaravel<SingleResourceResponse<User>>('/profile', {
    method: 'POST',
    body: formData,
  });
  if (res?.data) {
    setStoredUser(res.data);
  }
  return res;
}

// ============================================================================
// WORKFLOW 5: SCOPED CHANNELS & ROSTER MANAGEMENT (FR-01_REV)
// ============================================================================

export async function getChannelsApi(params?: {
  search?: string;
  type?: string;
}): Promise<SingleResourceResponse<Channel[]>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.type) qs.set('type', params.type);
  const queryString = qs.toString();
  return requestLaravel<SingleResourceResponse<Channel[]>>(
    `/channels${queryString ? `?${queryString}` : ''}`
  );
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
  return requestLaravel<SingleResourceResponse<Channel>>('/channels', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateChannelApi(
  channelId: number,
  payload: {
    course_code: string;
    name: string;
    description?: string;
    scope_college?: string;
    scope_department?: string;
    scope_section?: string;
  }
): Promise<SingleResourceResponse<Channel>> {
  return requestLaravel<SingleResourceResponse<Channel>>(
    `/channels/${channelId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteChannelApi(
  channelId: number
): Promise<{ message: string }> {
  return requestLaravel<{ message: string }>(`/channels/${channelId}`, {
    method: 'DELETE',
  });
}

export async function joinChannelApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  return requestLaravel<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/join`,
    { method: 'POST' }
  );
}

export async function leaveChannelApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  return requestLaravel<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/leave`,
    { method: 'POST' }
  );
}

export async function manageChannelMemberApi(
  channelId: number,
  payload: {
    institutional_id: string;
    name?: string;
    section?: string;
    action: 'add' | 'remove' | 'approve' | 'reject';
  }
): Promise<SingleResourceResponse<Channel>> {
  return requestLaravel<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/members`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
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

export async function createAnnouncementApi(
  formData: FormData
): Promise<SingleResourceResponse<Announcement>> {
  return requestLaravel<SingleResourceResponse<Announcement>>('/announcements', {
    method: 'POST',
    body: formData,
  });
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
  return requestLaravel<SingleResourceResponse<Announcement>>(
    `/announcements/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteAnnouncementApi(
  id: number
): Promise<{ message: string }> {
  return requestLaravel<{ message: string }>(`/announcements/${id}`, {
    method: 'DELETE',
  });
}

export async function acknowledgeAnnouncementApi(
  id: number
): Promise<SingleResourceResponse<Announcement>> {
  return requestLaravel<SingleResourceResponse<Announcement>>(
    `/announcements/${id}/acknowledge`,
    { method: 'POST' }
  );
}

// ============================================================================
// WORKFLOW 4: ISOLATED Q&A THREADS & 1-CLICK ANONYMIZED FAQS (FR-03_REV, FR-07, NFR-05)
// ============================================================================

export async function getChannelThreadsApi(
  channelId: number,
  params?: { status?: 'all' | 'resolved' | 'open' }
): Promise<SingleResourceResponse<QaThread[]>> {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== 'all') qs.set('status', params.status);
  const queryString = qs.toString();
  return requestLaravel<SingleResourceResponse<QaThread[]>>(
    `/channels/${channelId}/threads${queryString ? `?${queryString}` : ''}`
  );
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
  return requestLaravel<SingleResourceResponse<QaThread>>(
    `/channels/${channelId}/threads`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function updateThreadApi(
  threadId: number,
  payload: { subject_hashtag?: string; content: string }
): Promise<SingleResourceResponse<QaThread>> {
  return requestLaravel<SingleResourceResponse<QaThread>>(`/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteThreadApi(
  threadId: number
): Promise<{ message: string }> {
  return requestLaravel<{ message: string }>(`/threads/${threadId}`, {
    method: 'DELETE',
  });
}

export async function replyToThreadApi(
  threadId: number,
  payload: {
    content: string;
    mark_resolved: boolean;
    pin_to_faq: boolean;
  }
): Promise<SingleResourceResponse<QaThread>> {
  return requestLaravel<SingleResourceResponse<QaThread>>(
    `/threads/${threadId}/replies`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function convertThreadToFaqApi(
  threadId: number
): Promise<SingleResourceResponse<QaThread>> {
  return requestLaravel<SingleResourceResponse<QaThread>>(
    `/threads/${threadId}/convert-faq`,
    { method: 'POST' }
  );
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

// ============================================================================
// WORKFLOW 6: IT ADMIN CONSOLE (FR-08, FR-09, FR-10, NFR-03_REV)
// ============================================================================

export async function getPendingUsersApi(params?: {
  search?: string;
}): Promise<PaginatedResponse<User>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  const queryString = qs.toString();
  return requestLaravel<PaginatedResponse<User>>(
    `/admin/users/pending${queryString ? `?${queryString}` : ''}`
  );
}

export async function verifyUserAccountApi(
  userId: number,
  verification_status: 'approved' | 'rejected'
): Promise<SingleResourceResponse<User>> {
  return requestLaravel<SingleResourceResponse<User>>(
    `/admin/users/${userId}/verify`,
    {
      method: 'PATCH',
      body: JSON.stringify({ verification_status }),
    }
  );
}

export async function getAllUsersApi(params?: {
  search?: string;
}): Promise<SingleResourceResponse<User[]>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  const queryString = qs.toString();
  return requestLaravel<SingleResourceResponse<User[]>>(
    `/admin/users${queryString ? `?${queryString}` : ''}`
  );
}

export async function updateUserRoleApi(
  userId: number,
  payload: { role: UserRole; department: string }
): Promise<SingleResourceResponse<User>> {
  return requestLaravel<SingleResourceResponse<User>>(
    `/admin/users/${userId}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function triggerPrismsSyncApi(
  semester_code: string
): Promise<{
  message: string;
  total_updated: number;
  log: PrismsSyncLog;
}> {
  return requestLaravel<{
    message: string;
    total_updated: number;
    log: PrismsSyncLog;
  }>('/admin/sync-prisms', {
    method: 'POST',
    body: JSON.stringify({ semester_code }),
  });
}

export async function getAdminMetricsApi(): Promise<
  SingleResourceResponse<AdminMetricsResponse>
> {
  return requestLaravel<SingleResourceResponse<AdminMetricsResponse>>(
    '/admin/metrics'
  );
}

// ============================================================================
// COURSE HUB MESSENGER CHAT & PERSISTENCE STATUS
// ============================================================================

export async function getChannelChatMessagesApi(
  channelId: number
): Promise<SingleResourceResponse<ChatMessage[]>> {
  try {
    return await requestLaravel<SingleResourceResponse<ChatMessage[]>>(
      `/channels/${channelId}/messages`
    );
  } catch (err) {
    const apiErr = err as LaravelValidationError;
    if (apiErr?.status === 404) {
      return requestLaravel<SingleResourceResponse<ChatMessage[]>>(
        `/channels/${channelId}/chat`
      );
    }
    throw err;
  }
}

export async function sendChannelChatMessageApi(
  channelId: number,
  content: string,
  tempId?: string
): Promise<SingleResourceResponse<ChatMessage>> {
  const body = JSON.stringify({
    content,
    ...(tempId ? { temp_id: tempId } : {}),
  });

  try {
    return await requestLaravel<SingleResourceResponse<ChatMessage>>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body,
      }
    );
  } catch (err) {
    const apiErr = err as LaravelValidationError;
    if (apiErr?.status === 404) {
      return requestLaravel<SingleResourceResponse<ChatMessage>>(
        `/channels/${channelId}/chat`,
        {
          method: 'POST',
          body,
        }
      );
    }
    throw err;
  }
}

export async function getPersistenceStatusApi(): Promise<
  SingleResourceResponse<PersistenceStatus>
> {
  return requestLaravel<SingleResourceResponse<PersistenceStatus>>(
    '/persistence/status'
  );
}
