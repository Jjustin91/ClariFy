import type {
  AdminMetricsResponse,
  Announcement,
  ApiError,
  Channel,
  ChatMessage,
  Instructor,
  PaginatedResponse,
  PasswordOtpRequestResponse,
  PasswordOtpVerifyResponse,
  PasswordResetResponse,
  PersistenceStatus,
  PrismsSyncLog,
  QaThread,
  SingleResourceResponse,
  User,
  UserRole,
  VerificationStatus,
} from '../types/api.ts';
import {
  buildChatMessageFormData,
  type NativeUploadFile,
} from './domain-logic.ts';
import {
  clearSecureToken,
  getCachedBearerToken,
  setSecureToken,
} from './secure-token.ts';
import {
  prepareFormDataForUpload,
  sanitizeUploadErrorDetail,
} from './upload-file.ts';

const RAW_API_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.ustpclarify.tech/api/v1';

export const API_BASE_URL = RAW_API_URL.replace(/\/+$/, '');

export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 60000;

/**
 * Extracts the scheme + host origin from an API base URL (e.g., https://api.ustpclarify.tech/api/v1 -> https://api.ustpclarify.tech).
 */
export function getApiOrigin(apiBaseUrl: string = API_BASE_URL): string {
  const trimmed = (apiBaseUrl || '').trim().replace(/\/+$/, '');
  const match = trimmed.match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : trimmed.replace(/\/api\/v\d+$/i, '');
}

/**
 * Resolves relative `/storage/...` or `/assets/...` attachment/avatar paths against the API origin
 * while preserving absolute `https://`, `http://`, `data:`, `file:`, and `content:` URIs.
 */
export function resolveApiAssetUrl(
  rawUrl: string | null | undefined,
  apiBaseUrl: string = API_BASE_URL
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|blob:|file:|content:)/i.test(trimmed)) {
    return trimmed;
  }
  const origin = getApiOrigin(apiBaseUrl);
  if (!origin) return trimmed;
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${origin}${normalizedPath}`;
}

/**
 * Resolves a stored avatar URL for display while rejecting legacy base64 `data:` URIs
 * so avatars fall back cleanly to initials during transition.
 */
export function resolveAvatarUrl(
  rawUrl: string | null | undefined,
  apiBaseUrl: string = API_BASE_URL
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /^data:/i.test(trimmed)) {
    return null;
  }
  return resolveApiAssetUrl(trimmed, apiBaseUrl);
}

type SessionExpiredListener = (message: string) => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Registers a listener invoked whenever an authenticated API request returns HTTP 401.
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function notifySessionExpired(message: string): void {
  sessionExpiredListeners.forEach((listener) => {
    try {
      listener(message);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function setMobileBearerToken(token: string | null): void {
  void setSecureToken(token);
}

export function getMobileBearerToken(): string | null {
  return getCachedBearerToken();
}

/**
 * Parses the HTTP Retry-After header (seconds or HTTP-date) into positive integer seconds.
 */
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined
): number {
  if (!headerValue) {
    return 60;
  }
  const trimmed = headerValue.trim();
  const parsedNumeric = Number(trimmed);
  if (!Number.isNaN(parsedNumeric) && parsedNumeric > 0) {
    return Math.ceil(parsedNumeric);
  }
  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isNaN(parsedDateMs)) {
    const diffSec = Math.ceil((parsedDateMs - Date.now()) / 1000);
    return Math.max(1, diffSec);
  }
  return 60;
}

/**
 * Maps an HTTP error status + JSON payload + Retry-After header into a normalized ApiError.
 */
export function mapHttpErrorToApiError(params: {
  status: number;
  json?: Record<string, unknown> | null;
  retryAfterHeader?: string | null;
  endpoint?: string;
}): ApiError {
  const { status, json, retryAfterHeader, endpoint } = params;
  const serverMessage =
    typeof json?.message === 'string' && json.message.trim().length > 0
      ? json.message.trim()
      : null;
  const verificationStatus = json?.verification_status as
    | VerificationStatus
    | undefined;
  const rawErrors =
    json?.errors && typeof json.errors === 'object'
      ? (json.errors as Record<string, string[]>)
      : undefined;

  if (status === 401) {
    const isLoginEndpoint = endpoint === '/auth/login';
    return {
      status: 401,
      message: isLoginEndpoint
        ? serverMessage || 'Invalid Institutional ID or password.'
        : 'Your session has expired. Please sign in again.',
    };
  }

  if (status === 403) {
    return {
      status: 403,
      verification_status: verificationStatus,
      message:
        serverMessage ||
        'Access Denied: You do not have permission for this action.',
      data: json?.data,
    };
  }

  if (status === 404) {
    return {
      status: 404,
      message: serverMessage || 'The requested resource was not found.',
    };
  }

  if (status === 409) {
    return {
      status: 409,
      message:
        serverMessage ||
        'This request has already been handled. Refreshing latest state.',
      data: json?.data,
    };
  }

  if (status === 413) {
    return {
      status: 413,
      message:
        serverMessage ||
        'Upload failed: file is too large for the server. Please choose a smaller file.',
    };
  }

  if (status === 422) {
    let firstFieldError: string | null = null;
    if (rawErrors) {
      for (const field of Object.keys(rawErrors)) {
        const list = rawErrors[field];
        if (Array.isArray(list) && list.length > 0 && list[0]) {
          firstFieldError = list[0];
          break;
        }
      }
    }
    return {
      status: 422,
      message:
        serverMessage ||
        firstFieldError ||
        'Please check the highlighted form fields.',
      errors: rawErrors,
    };
  }

  if (status === 429) {
    let retryAfter = retryAfterHeader
      ? parseRetryAfterSeconds(retryAfterHeader)
      : null;
    if (
      !retryAfter &&
      typeof json?.retry_after === 'number' &&
      Number.isFinite(json.retry_after) &&
      json.retry_after > 0
    ) {
      retryAfter = Math.ceil(json.retry_after);
    }
    if (!retryAfter && serverMessage) {
      const match = serverMessage.match(/(\d+)\s*seconds?/i);
      if (match && match[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          retryAfter = Math.ceil(parsed);
        }
      }
    }
    const resolvedRetryAfter = retryAfter ?? 60;
    return {
      status: 429,
      retryAfter: resolvedRetryAfter,
      message: `Too many attempts, try again in ${resolvedRetryAfter} seconds`,
    };
  }

  return {
    status: status || 500,
    message:
      serverMessage ||
      'Unable to complete the request due to a server error. Please try again.',
    data: json?.data,
  };
}

function isNormalizedClientApiError(err: unknown): err is ApiError {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as Partial<ApiError>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.message === 'string' &&
    candidate.message.trim().length > 0 &&
    typeof candidate.code === 'string'
  );
}

/**
 * Normalizes a client-side or `fetch()` rejection into an `ApiError` (`status: 0`)
 * while preserving the non-secret original error (`causeName`, `causeMessage`) and
 * classifying timeouts, unreadable files, offline errors, and upload serialization issues.
 */
export function mapClientErrorToApiError(
  error: unknown,
  options: { isUpload?: boolean } = {}
): ApiError {
  const isUpload = Boolean(options.isUpload);

  if (isNormalizedClientApiError(error)) {
    return {
      ...error,
      ...(error.causeMessage
        ? { causeMessage: sanitizeUploadErrorDetail(error.causeMessage) }
        : {}),
    };
  }

  const errObj = error instanceof Error ? error : null;
  const causeName =
    errObj?.name?.trim() ||
    (error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name.trim()
      : '') ||
    'Error';

  const rawMessage =
    errObj?.message ||
    (error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : typeof error === 'string'
        ? error
        : '');

  const causeMessage = sanitizeUploadErrorDetail(rawMessage);
  const lower = (causeMessage || '').toLowerCase();

  const isConnectionAbort = lower.includes('connection abort');
  const isAbortOrTimeout =
    !isConnectionAbort &&
    (causeName === 'AbortError' ||
      lower.includes('abort') ||
      lower.includes('timed out') ||
      lower.includes('timeout'));

  if (isAbortOrTimeout) {
    return {
      status: 0,
      code: 'timeout',
      message: isUpload
        ? 'Upload timed out. Check your connection or try a smaller file.'
        : 'Request timed out. Please check your connection and try again.',
      causeName,
      ...(causeMessage ? { causeMessage } : {}),
    };
  }

  const isFileUnreadable =
    lower.includes('enoent') ||
    lower.includes('filenotfound') ||
    lower.includes('no such file') ||
    lower.includes('does not exist') ||
    lower.includes('could not read') ||
    lower.includes('unable to open input stream') ||
    lower.includes('permission denied') ||
    lower.includes('securityexception');

  if (isFileUnreadable) {
    return {
      status: 0,
      code: 'file_unreadable',
      message:
        'Upload failed: could not read file. Please re-select the file and try again.',
      causeName,
      ...(causeMessage ? { causeMessage } : {}),
    };
  }

  const isFormDataError =
    lower.includes('formdata') || lower.includes('unsupported bodyinit');

  if (isFormDataError) {
    return {
      status: 0,
      code: 'upload_failed',
      message: 'Upload failed: could not prepare attachment data.',
      causeName,
      ...(causeMessage ? { causeMessage } : {}),
    };
  }

  const isOfflineConnectivity =
    isConnectionAbort ||
    lower.includes('unable to resolve host') ||
    lower.includes('unknownhostexception') ||
    lower.includes('no address associated') ||
    lower.includes('network is unreachable') ||
    lower.includes('failed to connect') ||
    lower.includes('connectexception') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('enetunreach') ||
    lower.includes('offline') ||
    lower.includes('network request failed') ||
    lower.includes('connection reset') ||
    lower.includes('broken pipe') ||
    lower.includes('socketexception');

  if (isOfflineConnectivity) {
    return {
      status: 0,
      code: 'offline',
      message: isUpload
        ? 'Upload failed: no network connection. Check your internet and try again.'
        : 'No network connection. Please check your internet and try again.',
      causeName,
      ...(causeMessage ? { causeMessage } : {}),
    };
  }

  if (isUpload) {
    const shortReason = sanitizeUploadErrorDetail(
      (causeMessage || '').replace(/^fetch failed:\s*/i, ''),
      80
    );
    return {
      status: 0,
      code: 'upload_failed',
      message: shortReason
        ? `Upload failed: ${shortReason}`
        : 'Upload failed. Please check your connection and try again.',
      causeName,
      ...(causeMessage ? { causeMessage } : {}),
    };
  }

  return {
    status: 0,
    code: 'offline',
    message: 'No network connection. Please check your internet and try again.',
    causeName,
    ...(causeMessage ? { causeMessage } : {}),
  };
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
}

/**
 * Single centralized HTTP client for ClariFy Mobile.
 * Automatically attaches `Accept: application/json`, `Authorization: Bearer <token>`,
 * enforces a request timeout, runs SDK 58 pre-flight staging for FormData file uploads,
 * and normalizes all error statuses to `ApiError`.
 */
export async function apiClient<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    skipAuth = false,
    ...fetchOptions
  } = options;

  const token = skipAuth ? null : getCachedBearerToken();
  const isFormData =
    typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;

  let preparedBody = fetchOptions.body;
  let isUploadRequest = false;
  let cleanupPreparedUpload: () => void = () => {};

  if (isFormData) {
    try {
      const prepared = await prepareFormDataForUpload(
        fetchOptions.body as FormData
      );
      preparedBody = prepared.formData;
      isUploadRequest = prepared.hasFileAttachment;
      cleanupPreparedUpload = prepared.cleanup;
    } catch (preflightErr) {
      throw mapClientErrorToApiError(preflightErr, { isUpload: true });
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...((fetchOptions.headers as Record<string, string> | undefined) || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      body: preparedBody,
      headers,
      signal: fetchOptions.signal || controller.signal,
    });
  } catch (networkErr) {
    clearTimeout(timeoutId);
    throw mapClientErrorToApiError(networkErr, { isUpload: isUploadRequest });
  } finally {
    clearTimeout(timeoutId);
    cleanupPreparedUpload();
  }

  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const retryAfterHeader =
      typeof response.headers?.get === 'function'
        ? response.headers.get('Retry-After') ||
          response.headers.get('retry-after')
        : null;

    const apiError = mapHttpErrorToApiError({
      status: response.status,
      json,
      retryAfterHeader,
      endpoint,
    });

    if (response.status === 401 && !skipAuth && endpoint !== '/auth/login') {
      await clearSecureToken();
      notifySessionExpired(apiError.message);
    }

    throw apiError;
  }

  return json as T;
}

// ============================================================================
// WORKFLOW 1: AUTH, REGISTRATION & PROFILE
// ============================================================================

export async function registerApi(payload: {
  first_name: string;
  last_name: string;
  institutional_id: string;
  email: string;
  contact_number?: string;
  password: string;
  password_confirmation?: string;
  role: 'student' | 'faculty';
  department: string;
  section: string;
}): Promise<SingleResourceResponse<User>> {
  const { contact_number, first_name, last_name, ...rest } = payload;
  const trimmedContact = contact_number?.trim();
  return apiClient<SingleResourceResponse<User>>('/auth/register', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      ...rest,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      ...(trimmedContact ? { contact_number: trimmedContact } : {}),
      password_confirmation: payload.password_confirmation || payload.password,
    }),
  });
}

export async function requestPasswordOtpApi(
  institutional_id: string
): Promise<PasswordOtpRequestResponse> {
  return apiClient<PasswordOtpRequestResponse>('/auth/password/request-otp', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      institutional_id: institutional_id.trim(),
    }),
  });
}

export async function verifyPasswordOtpApi(
  institutional_id: string,
  code: string
): Promise<PasswordOtpVerifyResponse> {
  return apiClient<PasswordOtpVerifyResponse>('/auth/password/verify-otp', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      institutional_id: institutional_id.trim(),
      otp: code.trim(),
    }),
  });
}

export async function resetPasswordApi(payload: {
  institutional_id: string;
  reset_token: string;
  password: string;
  password_confirmation: string;
}): Promise<PasswordResetResponse> {
  return apiClient<PasswordResetResponse>('/auth/password/reset', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      institutional_id: payload.institutional_id.trim(),
      reset_token: payload.reset_token,
      password: payload.password,
      password_confirmation: payload.password_confirmation,
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
  const res = await apiClient<{ token: string; data: User }>('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      institutional_id: institutional_id.trim(),
      password,
    }),
  });
  await setSecureToken(res.token);
  return { token: res.token, user: res.data };
}

export async function logoutApi(): Promise<{ message: string }> {
  try {
    await apiClient('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors if token was already invalidated on server
  }
  await clearSecureToken();
  return { message: 'Logged out successfully.' };
}

export async function getMeApi(): Promise<SingleResourceResponse<User>> {
  return apiClient<SingleResourceResponse<User>>('/auth/me');
}

export async function updateProfileApi(
  formData: FormData
): Promise<SingleResourceResponse<User>> {
  formData.append('_method', 'PATCH');
  return apiClient<SingleResourceResponse<User>>('/profile', {
    method: 'POST',
    body: formData,
    timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
  });
}

// ============================================================================
// WORKFLOW 5: SCOPED CHANNELS & ROSTER MANAGEMENT
// ============================================================================

export async function getChannelsApi(params?: {
  search?: string;
  type?: string;
  include?: 'roster';
}): Promise<SingleResourceResponse<Channel[]>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.type) qs.set('type', params.type);
  if (params?.include) qs.set('include', params.include);
  const queryString = qs.toString();
  return apiClient<SingleResourceResponse<Channel[]>>(
    `/channels${queryString ? `?${queryString}` : ''}`
  );
}

export async function getChannelRosterApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  return apiClient<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/roster`
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
  return apiClient<SingleResourceResponse<Channel>>('/channels', {
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
  return apiClient<SingleResourceResponse<Channel>>(`/channels/${channelId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteChannelApi(
  channelId: number
): Promise<{ message: string }> {
  return apiClient<{ message: string }>(`/channels/${channelId}`, {
    method: 'DELETE',
  });
}

export async function joinChannelApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  return apiClient<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/join`,
    { method: 'POST' }
  );
}

export async function leaveChannelApi(
  channelId: number
): Promise<SingleResourceResponse<Channel>> {
  return apiClient<SingleResourceResponse<Channel>>(
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
  return apiClient<SingleResourceResponse<Channel>>(
    `/channels/${channelId}/members`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function markChannelSeenApi(
  channelId: number
): Promise<string | null> {
  const numericId = Number(channelId);
  if (!numericId || numericId <= 0) return null;

  try {
    const res = await apiClient<
      SingleResourceResponse<{ previous_seen_at?: string | null }> | undefined
    >(`/channels/${numericId}/seen?include_previous=1`, {
      method: 'POST',
    });
    return res?.data?.previous_seen_at ?? null;
  } catch (err) {
    const apiErr = err as ApiError;
    if (apiErr?.status === 404) {
      return null;
    }
    throw err;
  }
}

// ============================================================================
// WORKFLOWS 2 & 3: SCOPED ANNOUNCEMENTS, READ REACH & AUDITS
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
  if (params?.department && params.department !== 'ALL') {
    qs.set('department', params.department);
  }
  if (params?.tag && params.tag !== 'ALL') {
    qs.set('tag', params.tag);
  }
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.per_page) qs.set('per_page', String(params.per_page));
  const queryString = qs.toString();
  return apiClient<PaginatedResponse<Announcement>>(
    `/announcements${queryString ? `?${queryString}` : ''}`
  );
}

export async function createAnnouncementApi(
  formData: FormData
): Promise<SingleResourceResponse<Announcement>> {
  return apiClient<SingleResourceResponse<Announcement>>('/announcements', {
    method: 'POST',
    body: formData,
    timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
  });
}

export async function updateAnnouncementApi(
  id: number,
  formData: FormData
): Promise<SingleResourceResponse<Announcement>> {
  formData.append('_method', 'PATCH');
  return apiClient<SingleResourceResponse<Announcement>>(
    `/announcements/${id}`,
    {
      method: 'POST',
      body: formData,
      timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
    }
  );
}

export async function deleteAnnouncementApi(
  id: number
): Promise<{ message: string }> {
  return apiClient<{ message: string }>(`/announcements/${id}`, {
    method: 'DELETE',
  });
}

export async function getAnnouncementApi(
  id: number
): Promise<SingleResourceResponse<Announcement>> {
  return apiClient<SingleResourceResponse<Announcement>>(
    `/announcements/${id}`
  );
}

export async function acknowledgeAnnouncementApi(
  id: number
): Promise<SingleResourceResponse<Announcement>> {
  return apiClient<SingleResourceResponse<Announcement>>(
    `/announcements/${id}/acknowledge`,
    { method: 'POST' }
  );
}

// ============================================================================
// WORKFLOW 4: ISOLATED Q&A THREADS & 1-CLICK ANONYMIZED FAQS
// ============================================================================

export async function getChannelThreadsApi(
  channelId: number,
  params?: { status?: 'all' | 'resolved' | 'open' }
): Promise<SingleResourceResponse<QaThread[]>> {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== 'all') {
    qs.set('status', params.status);
  }
  const queryString = qs.toString();
  return apiClient<SingleResourceResponse<QaThread[]>>(
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
  return apiClient<SingleResourceResponse<QaThread>>(
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
  return apiClient<SingleResourceResponse<QaThread>>(`/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteThreadApi(
  threadId: number
): Promise<{ message: string }> {
  return apiClient<{ message: string }>(`/threads/${threadId}`, {
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
  return apiClient<SingleResourceResponse<QaThread>>(
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
  return apiClient<SingleResourceResponse<QaThread>>(
    `/threads/${threadId}/convert-faq`,
    { method: 'POST' }
  );
}

export async function resolveThreadApi(
  threadId: number
): Promise<SingleResourceResponse<QaThread>> {
  return apiClient<SingleResourceResponse<QaThread>>(
    `/threads/${threadId}/resolve`,
    { method: 'PATCH' }
  );
}

// ============================================================================
// INSTRUCTOR DIRECTORY
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
  if (params?.department && params.department !== 'ALL') {
    qs.set('department', params.department);
  }
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.per_page) qs.set('per_page', String(params.per_page));
  const queryString = qs.toString();
  return apiClient<PaginatedResponse<Instructor>>(
    `/instructors${queryString ? `?${queryString}` : ''}`
  );
}

// ============================================================================
// WORKFLOW 6: IT ADMIN CONSOLE
// ============================================================================

export async function getPendingUsersApi(params?: {
  search?: string;
  status?: 'pending' | 'rejected' | 'all';
  role?: string;
  department?: string;
  per_page?: number;
}): Promise<PaginatedResponse<User>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status) qs.set('status', params.status);
  if (params?.role && params.role !== 'all') qs.set('role', params.role);
  if (params?.department && params.department !== 'ALL') {
    qs.set('department', params.department);
  }
  if (params?.per_page) qs.set('per_page', String(params.per_page));
  const queryString = qs.toString();
  return apiClient<PaginatedResponse<User>>(
    `/admin/users/pending${queryString ? `?${queryString}` : ''}`
  );
}

export async function verifyUserAccountApi(
  userId: number,
  verification_status: 'approved' | 'rejected'
): Promise<SingleResourceResponse<User>> {
  return apiClient<SingleResourceResponse<User>>(
    `/admin/users/${userId}/verify`,
    {
      method: 'PATCH',
      body: JSON.stringify({ verification_status }),
    }
  );
}

export async function getAllUsersApi(params?: {
  search?: string;
  role?: string;
  department?: string;
}): Promise<SingleResourceResponse<User[]>> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.role && params.role !== 'all') qs.set('role', params.role);
  if (params?.department && params.department !== 'ALL') {
    qs.set('department', params.department);
  }
  const queryString = qs.toString();
  return apiClient<SingleResourceResponse<User[]>>(
    `/admin/users${queryString ? `?${queryString}` : ''}`
  );
}

export async function updateUserRoleApi(
  userId: number,
  payload: { role: UserRole; department: string }
): Promise<SingleResourceResponse<User>> {
  return apiClient<SingleResourceResponse<User>>(`/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function triggerPrismsSyncApi(
  semester_code: string
): Promise<{
  message: string;
  total_updated: number;
  log: PrismsSyncLog;
}> {
  return apiClient<{
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
  return apiClient<SingleResourceResponse<AdminMetricsResponse>>(
    '/admin/metrics'
  );
}

// ============================================================================
// COURSE HUB MESSENGER CHAT & PERSISTENCE STATUS
// ============================================================================

export interface PaginatedChatMessagesResponse
  extends SingleResourceResponse<ChatMessage[]> {
  meta?: {
    has_more: boolean;
    next_before: number | null;
  };
}

export async function getChannelChatMessagesApi(
  channelId: number,
  params?: { before?: number; limit?: number }
): Promise<PaginatedChatMessagesResponse> {
  const qs = new URLSearchParams();
  if (params?.before) qs.set('before', String(params.before));
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryString = qs.toString();
  return apiClient<PaginatedChatMessagesResponse>(
    `/channels/${channelId}/messages${queryString ? `?${queryString}` : ''}`
  );
}

export async function sendChannelChatMessageApi(
  channelId: number,
  content: string,
  tempId?: string,
  attachmentFile?: NativeUploadFile | File | Blob | null
): Promise<SingleResourceResponse<ChatMessage>> {
  const body = attachmentFile
    ? buildChatMessageFormData({
        content,
        tempId,
        attachment: attachmentFile,
        attachmentFileName:
          ('name' in attachmentFile && typeof attachmentFile.name === 'string'
            ? attachmentFile.name
            : undefined) || 'attachment.bin',
      })
    : JSON.stringify({
        content,
        ...(tempId ? { temp_id: tempId } : {}),
      });

  return apiClient<SingleResourceResponse<ChatMessage>>(
    `/channels/${channelId}/messages`,
    {
      method: 'POST',
      body,
      ...(attachmentFile ? { timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS } : {}),
    }
  );
}

export async function unsendChannelChatMessageApi(
  channelId: number,
  messageId: number | string
): Promise<SingleResourceResponse<ChatMessage>> {
  return apiClient<SingleResourceResponse<ChatMessage>>(
    `/channels/${channelId}/messages/${messageId}`,
    {
      method: 'DELETE',
    }
  );
}

export async function getPersistenceStatusApi(): Promise<
  SingleResourceResponse<PersistenceStatus>
> {
  return apiClient<SingleResourceResponse<PersistenceStatus>>(
    '/persistence/status'
  );
}

// ============================================================================
// PUSH NOTIFICATIONS DEVICE TOKEN REGISTRATION
// ============================================================================

function formatSanitizedModuleError(error: unknown): string {
  const errObj = error instanceof Error ? error : null;
  const name =
    errObj?.name?.trim() ||
    (error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name.trim()
      : '') ||
    'Error';
  const rawMessage =
    errObj?.message ||
    (error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : typeof error === 'string'
        ? error
        : 'Unknown error');

  const sanitizedMessage = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/Expo(?:nent)?PushToken\[[^\]]+\]/gi, 'ExpoPushToken[[REDACTED]]')
    .replace(/(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n;,]+/gi, '$1: [REDACTED]')
    .replace(/https?:\/\/[^\s)'"`]+/gi, '[URL_REDACTED]')
    .replace(/([?&](?:token|access_token|auth|key|secret|password|jwt)=)[^&\s)'"`]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return `${name}: ${sanitizedMessage || 'Unknown error'}`;
}

export async function registerExpoPushTokenApi(
  expoPushToken: string,
  platformOverride?: 'ios' | 'android' | 'web'
): Promise<void> {
  const trimmed = expoPushToken.trim();
  if (!trimmed || !getCachedBearerToken()) {
    return;
  }

  let platform: 'ios' | 'android' | 'web' = platformOverride || 'android';
  if (!platformOverride) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Platform } = require('react-native');
      platform =
        Platform.OS === 'ios'
          ? 'ios'
          : Platform.OS === 'android'
            ? 'android'
            : 'web';
    } catch (error) {
      console.warn(
        `[api-client] Failed to load react-native Platform; defaulting push platform to android (${formatSanitizedModuleError(error)})`
      );
      platform = 'android';
    }
  }

  await apiClient('/devices/token', {
    method: 'POST',
    body: JSON.stringify({
      expo_push_token: trimmed,
      platform,
    }),
  });
}

export async function registerDeviceForPushNotificationsAsync(): Promise<void> {
  try {
    if (!getCachedBearerToken()) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ConstantsModule = require('expo-constants');

    if (Platform.OS === 'web' || !Device.isDevice) {
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('urgent-alerts', {
        name: 'Urgent Campus Alerts',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return;
    }

    const Constants = ConstantsModule.default ?? ConstantsModule;
    const extra = Constants?.expoConfig?.extra as
      | { eas?: { projectId?: string } }
      | undefined;
    const easConfig = (
      Constants as { easConfig?: { projectId?: string } } | undefined
    )?.easConfig;
    const rawProjectId = extra?.eas?.projectId ?? easConfig?.projectId;
    const projectId =
      typeof rawProjectId === 'string' && rawProjectId.trim().length > 0
        ? rawProjectId.trim()
        : undefined;

    if (!projectId) {
      return;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const pushToken = tokenResult?.data?.trim();
    if (pushToken) {
      await registerExpoPushTokenApi(pushToken);
    }
  } catch (error) {
    // Non-fatal: never block login or session restore on push registration errors
    console.warn(
      `[api-client] Push notification device registration failed (${formatSanitizedModuleError(error)})`
    );
  }
}

export async function restoreMobileSession(
  token: string | null
): Promise<void> {
  await setSecureToken(token);
  if (token) {
    await registerDeviceForPushNotificationsAsync();
  }
}
