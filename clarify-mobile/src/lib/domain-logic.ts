import type {
  AdminMetricsResponse,
  AdminRoleBreakdown,
  Announcement,
  AnnouncementAudit,
  Channel,
  NewActivityBreakdown,
  PrismsSyncLog,
  QaThread,
  ReadReach,
  RealtimeEvent,
  User,
  UserRole,
} from '../types/api.ts';

const HUB_PREFIX_REGEX = /^\[HUB:(\d+)\]\s*/i;

export interface NativeUploadFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

/**
 * Returns the parent Course Hub ID if the given channel record is a sub-channel
 * inside a Course Hub, or null if it is a top-level Course Hub.
 */
export function getChannelParentHubId(channel: Channel | undefined): number | null {
  if (!channel) return null;
  if (typeof channel.parent_hub_id === 'number' && channel.parent_hub_id > 0) {
    return channel.parent_hub_id;
  }
  if (channel.description) {
    const match = channel.description.match(HUB_PREFIX_REGEX);
    if (match && match[1]) {
      return Number(match[1]);
    }
  }
  return null;
}

/**
 * Returns true if the channel is a custom sub-channel inside a Course Hub.
 */
export function isSubChannel(channel: Channel | undefined): boolean {
  return getChannelParentHubId(channel) !== null;
}

/**
 * Returns only top-level Course Hubs (excluding inner sub-channels and university-wide containers).
 */
export function getTopLevelCourseHubs(channels: Channel[]): Channel[] {
  return channels.filter(
    (ch) =>
      (!ch.channel_type || ch.channel_type === 'course_hub') &&
      !isSubChannel(ch)
  );
}

/**
 * Checks whether the given user is a Course Admin for the Course Hub.
 * All Faculty/Dept Heads automatically have the Course Admin role, as well as the creator of the Course Hub.
 */
export function isUserCourseAdmin(
  hub: Channel | undefined,
  user: User | null | undefined
): boolean {
  if (!hub || !user || !user.id) return false;
  if (user.role === 'faculty' || user.role === 'dept_head') {
    return true;
  }
  return Boolean(hub.created_by && Number(hub.created_by) === Number(user.id));
}

/**
 * Checks whether the given user is currently enrolled (approved) in a Course Hub's roster.
 */
export function isUserEnrolledInCourseHub(
  hub: Channel | undefined,
  user: User | null | undefined
): boolean {
  if (!hub || !user || !user.id) return false;
  const roster = hub.roster || [];
  return roster.some(
    (m) =>
      Number(m.id) === Number(user.id) ||
      (user.institutional_id &&
        m.institutional_id.trim().toLowerCase() ===
          user.institutional_id.trim().toLowerCase())
  );
}

/**
 * Checks whether the given user has a pending join request for a Course Hub.
 */
export function isUserPendingInCourseHub(
  hub: Channel | undefined,
  user: User | null | undefined
): boolean {
  if (!hub || !user || !user.id) return false;
  const pending = hub.pending_requests || [];
  return pending.some(
    (m) =>
      Number(m.id) === Number(user.id) ||
      (user.institutional_id &&
        m.institutional_id.trim().toLowerCase() ===
          user.institutional_id.trim().toLowerCase())
  );
}

/**
 * Returns only the top-level Course Hubs that the user has joined (and been approved into) or created.
 */
export function getJoinedCourseHubs(
  channels: Channel[],
  user: User | null | undefined
): Channel[] {
  const allHubs = getTopLevelCourseHubs(channels);
  if (!user || !user.id) return [];
  return allHubs.filter((hub) => isUserEnrolledInCourseHub(hub, user));
}

/**
 * Returns all custom sub-channels belonging to a specific parent Course Hub ID.
 */
export function getSubChannelsForHub(
  channels: Channel[],
  hubId: number
): Channel[] {
  return channels.filter((ch) => getChannelParentHubId(ch) === hubId);
}

/**
 * Strips internal [HUB:id] metadata prefix from a channel's description for UI display.
 */
export function getCleanChannelDescription(
  description: string | null | undefined
): string {
  if (!description) return '';
  return description.replace(HUB_PREFIX_REGEX, '').trim();
}

/**
 * Formats a Course Hub display name cleanly without a leading '#' so hubs read as categories/servers.
 */
export function formatCourseHubName(hub: Channel | undefined): string {
  if (!hub) return 'Course Hub';
  return hub.name.replace(/^#\s*/, '').trim();
}

/**
 * Formats a sub-channel name in Discord style (lowercase hyphenated with leading '# ').
 */
export function formatSubChannelDisplayName(channel: Channel | undefined): string {
  if (!channel) return '# general';
  const raw = channel.name.replace(/^#\s*/, '').trim();
  return `# ${raw}`;
}

/**
 * Resolves the active parent Course Hub, optional active custom sub-channel,
 * and effective Course Hub ID for a given route channelId parameter.
 */
export function resolveCourseHubSelection(
  channels: Channel[],
  requestedChannelId: number,
  user?: User | null
): {
  courseHubs: Channel[];
  allCourseHubs: Channel[];
  activeChannel: Channel | undefined;
  activeSubChannel: Channel | undefined;
  parentHubId: number | null;
  channelId: number;
} {
  const allCourseHubs = getTopLevelCourseHubs(channels);
  const courseHubs = user
    ? getJoinedCourseHubs(channels, user)
    : allCourseHubs;

  if (user && courseHubs.length === 0) {
    return {
      courseHubs: [],
      allCourseHubs,
      activeChannel: undefined,
      activeSubChannel: undefined,
      parentHubId: null,
      channelId: 0,
    };
  }

  const rawRequested = channels.find((c) => c.id === requestedChannelId);
  const rawParentHubId = getChannelParentHubId(rawRequested);

  if (user) {
    if (rawRequested && rawParentHubId !== null) {
      const joinedParent = courseHubs.find((h) => h.id === rawParentHubId);
      if (joinedParent) {
        return {
          courseHubs,
          allCourseHubs,
          activeChannel: joinedParent,
          activeSubChannel: isSubChannel(rawRequested)
            ? rawRequested
            : undefined,
          parentHubId: rawParentHubId,
          channelId: joinedParent.id,
        };
      }
    }

    const joinedHub = courseHubs.find((h) => h.id === requestedChannelId);
    const activeChannel = joinedHub || courseHubs[0];
    return {
      courseHubs,
      allCourseHubs,
      activeChannel,
      activeSubChannel: undefined,
      parentHubId: null,
      channelId: activeChannel ? activeChannel.id : 0,
    };
  }

  const requestedChannel =
    rawRequested || courseHubs[0] || allCourseHubs[0] || channels[0];
  const parentHubId = getChannelParentHubId(requestedChannel);
  const activeChannel =
    parentHubId !== null
      ? allCourseHubs.find((h) => h.id === parentHubId) ||
        courseHubs[0] ||
        requestedChannel
      : requestedChannel;

  const activeSubChannel =
    parentHubId !== null && isSubChannel(requestedChannel)
      ? requestedChannel
      : undefined;

  const channelId = activeChannel?.id || requestedChannelId;

  return {
    courseHubs,
    allCourseHubs,
    activeChannel,
    activeSubChannel,
    parentHubId,
    channelId,
  };
}

export interface ChatMediaAttachment {
  kind: 'image' | 'file' | 'audio' | 'voice';
  name: string;
  mimeType: string;
  size?: number;
  sizeBytes?: number;
  durationSec?: number;
  dataUrl: string;
}

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export const CHAT_ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'txt',
  'csv',
  'zip',
  'webm',
  'ogg',
  'wav',
  'mp3',
  'm4a',
] as const;

const FORBIDDEN_CHAT_EXTENSIONS = new Set([
  'php',
  'phtml',
  'exe',
  'msi',
  'bat',
  'cmd',
  'sh',
  'js',
  'mjs',
  'cjs',
  'html',
  'htm',
  'vbs',
  'dll',
  'scr',
]);

export function validateChatAttachmentFile(file: {
  name: string;
  size: number;
  type?: string;
}): { valid: true; attachmentType: 'image' | 'document' | 'voice' } | { valid: false; error: string } {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return { valid: false, error: 'Selected attachment file is empty.' };
  }

  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return {
      valid: false,
      error: 'File exceeds the 10 MB limit. Please choose a file up to 10 MB.',
    };
  }

  const rawName = (file.name || '').trim();
  const ext = rawName.includes('.')
    ? rawName.split('.').pop()!.toLowerCase()
    : '';
  const mime = (file.type || '').toLowerCase();

  if (
    FORBIDDEN_CHAT_EXTENSIONS.has(ext) ||
    mime.includes('application/x-msdownload') ||
    mime.includes('application/x-executable') ||
    mime.includes('application/x-php') ||
    mime.includes('text/x-php')
  ) {
    return {
      valid: false,
      error: 'Executable and script files (.php, .exe, .sh, .bat) are not permitted.',
    };
  }

  const isAllowedExt = (CHAT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
  if (!isAllowedExt) {
    return {
      valid: false,
      error: `Unsupported file type (.${ext || 'unknown'}). Allowed: images, PDF, Office docs, TXT/CSV/ZIP, and voice/audio.`,
    };
  }

  if (
    ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ||
    mime.startsWith('image/')
  ) {
    return { valid: true, attachmentType: 'image' };
  }

  if (
    ['webm', 'ogg', 'wav', 'mp3', 'm4a'].includes(ext) ||
    mime.startsWith('audio/')
  ) {
    return { valid: true, attachmentType: 'voice' };
  }

  return { valid: true, attachmentType: 'document' };
}

/**
 * Builds a multipart/form-data payload for POST /api/v1/channels/{id}/messages.
 * Supports both React Native file descriptors ({ uri, name, type }) and standard Blob/File instances.
 */
export function buildChatMessageFormData(params: {
  content: string;
  tempId?: string;
  attachment: NativeUploadFile | File | Blob;
  attachmentFileName?: string;
}): FormData {
  const formData = new FormData();
  formData.append('content', params.content);
  if (params.tempId) {
    formData.append('temp_id', params.tempId);
  }

  const att = params.attachment as NativeUploadFile & { name?: string };
  if (att && typeof att.uri === 'string') {
    formData.append('attachment', {
      uri: att.uri,
      name: params.attachmentFileName || att.name || 'attachment.bin',
      type: att.type || 'application/octet-stream',
    } as unknown as Blob);
  } else {
    const fileName =
      params.attachmentFileName ||
      ('name' in params.attachment && typeof params.attachment.name === 'string'
        ? params.attachment.name
        : 'attachment.bin');
    formData.append('attachment', params.attachment as Blob, fileName);
  }
  return formData;
}

export function createRetryableChatFileStore<TFile = NativeUploadFile>() {
  const filesByTempId = new Map<string, TFile>();
  return {
    stage(tempId: string, file: TFile | null | undefined): void {
      if (!tempId || !file) return;
      filesByTempId.set(tempId, file);
    },
    getForRetry(tempId: string): TFile | undefined {
      return filesByTempId.get(tempId);
    },
    clear(tempId: string): void {
      filesByTempId.delete(tempId);
    },
    has(tempId: string): boolean {
      return filesByTempId.has(tempId);
    },
  };
}

export function getChannelFacultyLabel(channel: Channel | undefined): string {
  if (!channel) return 'No Faculty Assigned Yet';
  if (Array.isArray(channel.faculty)) {
    const names = Array.from(
      new Set(
        channel.faculty
          .filter(
            (m) =>
              m &&
              (m.role === 'faculty' || m.role === 'dept_head') &&
              typeof m.name === 'string' &&
              m.name.trim().length > 0
          )
          .map((m) => m.name.trim())
      )
    );
    return names.length > 0 ? names.join(', ') : 'No Faculty Assigned Yet';
  }
  const rosterFaculty = Array.from(
    new Set(
      (channel.roster || [])
        .filter((m) => m.role === 'faculty' || m.role === 'dept_head')
        .map((m) => m.name.trim())
        .filter(Boolean)
    )
  );
  return rosterFaculty.length > 0
    ? rosterFaculty.join(', ')
    : 'No Faculty Assigned Yet';
}

export function formatEnrolledRosterSummary(
  channel: Channel | undefined
): string {
  if (!channel) return '0 members (0 students)';
  const membersCount =
    typeof channel.members_count === 'number'
      ? Math.max(0, channel.members_count)
      : (channel.roster || []).length;
  const studentsCount =
    typeof channel.students_count === 'number'
      ? Math.max(0, channel.students_count)
      : (channel.roster || []).filter((m) => m.role === 'student').length;

  const memberWord = membersCount === 1 ? 'member' : 'members';
  const studentWord = studentsCount === 1 ? 'student' : 'students';
  return `${membersCount} ${memberWord} (${studentsCount} ${studentWord})`;
}

export function calculateAcknowledgedReadReach(current: ReadReach): ReadReach {
  const enrolledTotal = Math.max(0, Number(current.enrolled_total) || 0);
  if (enrolledTotal === 0) {
    return {
      acknowledged_count: 0,
      enrolled_total: 0,
      percentage: 0,
      has_current_user_acknowledged: true,
    };
  }
  const currentClamped = Math.min(
    enrolledTotal,
    Math.max(0, Number(current.acknowledged_count) || 0)
  );
  if (current.has_current_user_acknowledged) {
    return {
      acknowledged_count: currentClamped,
      enrolled_total: enrolledTotal,
      percentage: Number(((currentClamped / enrolledTotal) * 100).toFixed(1)),
      has_current_user_acknowledged: true,
    };
  }
  const nextCount = Math.min(enrolledTotal, currentClamped + 1);
  const percentage = Number(((nextCount / enrolledTotal) * 100).toFixed(1));
  return {
    acknowledged_count: nextCount,
    enrolled_total: enrolledTotal,
    percentage,
    has_current_user_acknowledged: true,
  };
}

export function enforceFaqAnonymity(thread: QaThread): QaThread {
  if (!thread.is_pinned_faq) {
    return thread;
  }
  return {
    ...thread,
    is_resolved: true,
    is_private: false,
    author: {
      id: null,
      name: 'Anonymous Student',
      role: 'student',
      avatar_url: null,
    },
  };
}

export function formatSubjectHashtag(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const withoutLeadingHashes = trimmed.replace(/^#+/, '').trim();
  if (!withoutLeadingHashes) return '';
  return `#${withoutLeadingHashes}`;
}

export function canPublishOrManageAnnouncements(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head';
}

export function canPublishCampusWideAnnouncements(role: UserRole): boolean {
  return role === 'dept_head';
}

export function getUnsentMessagePlaceholder(
  msg: {
    is_unsent?: boolean;
    sender_id?: number;
    author?: { id?: number | null; name?: string };
  },
  currentUserId?: number
): string | null {
  if (!msg.is_unsent) {
    return null;
  }
  const senderId = Number(msg.author?.id ?? msg.sender_id ?? 0);
  const viewerId = Number(currentUserId ?? 0);
  if (senderId > 0 && viewerId > 0 && senderId === viewerId) {
    return 'You unsent a message';
  }
  const senderName = (msg.author?.name || '').trim() || 'Campus Member';
  return `${senderName} unsent a message`;
}

export function canResolveOrPinThreads(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head';
}

export function canStudentModifyOwnInquiry(user: User, thread: QaThread): boolean {
  if (user.role !== 'student') return false;
  if (thread.is_resolved || thread.is_pinned_faq) return false;
  return thread.author.id === user.id;
}

export function isThreadVisibleToUser(thread: QaThread, user: User): boolean {
  if (!thread.is_private) return true;
  if (canResolveOrPinThreads(user.role)) return true;
  return thread.author.id === user.id;
}

export interface AnnouncementFilterOptions {
  channelId?: number | null;
  search?: string;
  tag?: string;
  department?: string;
  sort?: 'latest' | 'oldest' | 'urgent_first' | 'read_reach';
  includeDrafts?: boolean;
}

export function filterAndSortAnnouncements(
  announcements: Announcement[],
  options: AnnouncementFilterOptions = {}
): Announcement[] {
  const {
    channelId,
    search = '',
    tag = 'ALL',
    department = 'ALL',
    sort = 'latest',
    includeDrafts = false,
  } = options;

  const query = search.trim().toLowerCase();

  const filtered = announcements.filter((item) => {
    if (!includeDrafts && item.status !== 'published') {
      return false;
    }
    if (channelId && item.channel_id !== channelId) {
      return false;
    }
    if (tag && tag !== 'ALL') {
      if (tag.trim().toUpperCase() === 'COURSE HUB') {
        const isCourseHub =
          !item.channel_type || item.channel_type === 'course_hub';
        if (!isCourseHub) return false;
      } else {
        const hasTag = item.tags.some(
          (t) => t.toLowerCase() === tag.toLowerCase()
        );
        if (!hasTag) return false;
      }
    }
    if (department && department !== 'ALL') {
      const matchesDept =
        item.publisher.department.toLowerCase() === department.toLowerCase() ||
        item.tags.some((t) => t.toLowerCase() === department.toLowerCase());
      if (!matchesDept) return false;
    }
    if (query) {
      const haystack = [
        item.title,
        item.subtitle || '',
        item.course_code || '',
        item.channel_name || '',
        item.content,
        item.publisher.name,
        item.publisher.department,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    const aUrgent = a.is_urgent ? 1 : 0;
    const bUrgent = b.is_urgent ? 1 : 0;
    if (aUrgent !== bUrgent) {
      return bUrgent - aUrgent;
    }

    const aPinned = a.is_pinned ? 1 : 0;
    const bPinned = b.is_pinned ? 1 : 0;
    if (aPinned !== bPinned) {
      return bPinned - aPinned;
    }

    if (sort === 'read_reach') {
      return b.read_reach.percentage - a.read_reach.percentage;
    }

    const timeA = new Date(a.published_at).getTime();
    const timeB = new Date(b.published_at).getTime();
    return sort === 'oldest' ? timeA - timeB : timeB - timeA;
  });
}

/**
 * Extracts the first field validation message from a Laravel 422 response payload.
 */
export function getFieldValidationError(
  errors: Record<string, string[]> | undefined,
  field: string
): string | null {
  if (!errors || !errors[field] || errors[field].length === 0) {
    return null;
  }
  return errors[field][0];
}

export const USTP_EMAIL_ERROR_MESSAGE =
  'Only @ustp.edu.ph email addresses can create an account.';

export function normalizeUstpEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

export function isValidUstpEmail(raw: string): boolean {
  const normalized = normalizeUstpEmail(raw);
  if (!normalized || normalized.length > 255) {
    return false;
  }
  if (/\s/.test(normalized)) {
    return false;
  }
  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return false;
  }
  const [localPart, domainPart] = parts;
  if (
    !localPart ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) {
    return false;
  }
  return domainPart === 'ustp.edu.ph';
}

export function validateUstpEmail(raw: string): string | null {
  return isValidUstpEmail(raw) ? null : USTP_EMAIL_ERROR_MESSAGE;
}

export function normalizePhilippineMobileNumber(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/[^\d\s\-+()]/.test(trimmed)) {
    return null;
  }
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (!digits) {
    return null;
  }
  if (hasPlus) {
    const m = digits.match(/^63(9\d{9})$/);
    return m ? `+63${m[1]}` : null;
  }
  const m09 = digits.match(/^0(9\d{9})$/);
  if (m09) return `+63${m09[1]}`;
  const m63 = digits.match(/^63(9\d{9})$/);
  if (m63) return `+63${m63[1]}`;
  const m9 = digits.match(/^(9\d{9})$/);
  if (m9) return `+63${m9[1]}`;
  return null;
}

export type HubActivityCategory = 'qa' | 'chat' | 'announcements';

export interface HubActivityBreakdownChip {
  key: HubActivityCategory;
  label: string;
  count: number;
}

export function formatHubActivityBreakdownChips(
  breakdown?: NewActivityBreakdown | null
): HubActivityBreakdownChip[] {
  if (!breakdown) return [];
  const chips: HubActivityBreakdownChip[] = [];
  const qa = Number(breakdown.qa || 0);
  const chat = Number(breakdown.chat || 0);
  const announcements = Number(breakdown.announcements || 0);

  if (qa > 0) {
    chips.push({ key: 'qa', label: `${qa} Q&A`, count: qa });
  }
  if (chat > 0) {
    chips.push({ key: 'chat', label: `${chat} chat`, count: chat });
  }
  if (announcements > 0) {
    chips.push({
      key: 'announcements',
      label: `${announcements} ${announcements === 1 ? 'announcement' : 'announcements'}`,
      count: announcements,
    });
  }
  return chips;
}

export type QaThreadStatusFilter = 'all' | 'unresolved' | 'resolved';

export function isThreadResolved(thread: QaThread): boolean {
  return Boolean(thread.is_resolved || thread.is_pinned_faq);
}

export function isThreadUnresolved(thread: QaThread): boolean {
  return !isThreadResolved(thread);
}

export function getThreadStatusLabel(thread: QaThread): 'RESOLVED' | 'UNRESOLVED' {
  return isThreadResolved(thread) ? 'RESOLVED' : 'UNRESOLVED';
}

export function isThreadUnread(
  thread: QaThread,
  currentUserId: number,
  previousSeenAt?: string | null
): boolean {
  if (!previousSeenAt) return false;
  const cutoffMs = Date.parse(previousSeenAt);
  if (Number.isNaN(cutoffMs)) return false;

  const isOtherAuthor = Number(thread.author?.id ?? 0) !== Number(currentUserId);
  const createdMs = Date.parse(thread.created_at);
  if (isOtherAuthor && !Number.isNaN(createdMs) && createdMs > cutoffMs) {
    return true;
  }

  const replies = Array.isArray(thread.replies) ? thread.replies : [];
  for (const reply of replies) {
    const isOtherReplier = Number(reply.author?.id ?? 0) !== Number(currentUserId);
    const replyMs = Date.parse(reply.created_at);
    if (isOtherReplier && !Number.isNaN(replyMs) && replyMs > cutoffMs) {
      return true;
    }
  }

  if (replies.length === 0 && thread.updated_at) {
    const updatedMs = Date.parse(thread.updated_at);
    if (isOtherAuthor && !Number.isNaN(updatedMs) && updatedMs > cutoffMs) {
      return true;
    }
  }

  return false;
}

export interface QaThreadFilterCounts {
  all: number;
  unresolved: number;
  resolved: number;
  unread: number;
}

export function getQaThreadFilterCounts(
  threads: QaThread[],
  user: User | null,
  previousSeenAt?: string | null
): QaThreadFilterCounts {
  const visible = threads.filter((t) =>
    user ? isThreadVisibleToUser(t, user) : !t.is_private
  );
  let unresolved = 0;
  let resolved = 0;
  let unread = 0;

  for (const t of visible) {
    if (isThreadResolved(t)) {
      resolved += 1;
    } else {
      unresolved += 1;
    }
    if (user && isThreadUnread(t, user.id, previousSeenAt)) {
      unread += 1;
    }
  }

  return {
    all: visible.length,
    unresolved,
    resolved,
    unread,
  };
}

export function filterQaThreads(
  threads: QaThread[],
  user: User | null,
  options: {
    statusFilter?: QaThreadStatusFilter;
    unreadOnly?: boolean;
    previousSeenAt?: string | null;
  } = {}
): QaThread[] {
  const { statusFilter = 'all', unreadOnly = false, previousSeenAt = null } = options;
  return threads.filter((t) => {
    const isVisible = user ? isThreadVisibleToUser(t, user) : !t.is_private;
    if (!isVisible) return false;
    if (statusFilter === 'resolved' && !isThreadResolved(t)) return false;
    if (statusFilter === 'unresolved' && !isThreadUnresolved(t)) return false;
    if (unreadOnly) {
      if (!user || !isThreadUnread(t, user.id, previousSeenAt)) return false;
    }
    return true;
  });
}

export function formatUnreadBadgeCount(count: number | undefined): string {
  if (typeof count !== 'number' || Number.isNaN(count) || count <= 0) {
    return '0';
  }
  if (count > 99) {
    return '99+';
  }
  return String(Math.floor(count));
}

export function getSubscribableCourseHubIds(
  channels: Channel[],
  user: User | null | undefined
): number[] {
  if (!user || !user.id || user.role === 'it_admin') {
    return [];
  }
  const topHubs = getTopLevelCourseHubs(channels);
  const ids = new Set<number>();
  for (const hub of topHubs) {
    const hid = Number(hub.id);
    if (
      hid > 0 &&
      (isUserEnrolledInCourseHub(hub, user) ||
        (hub.created_by && Number(hub.created_by) === Number(user.id)))
    ) {
      ids.add(hid);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export function patchChannelsOnThreadEvent(
  channels: Channel[],
  event: RealtimeEvent,
  currentUser: User,
  currentlyViewedHubId = 0
): { channels: Channel[]; mutated: boolean } {
  const rawChannelId = Number(
    event.channel_id || event.thread?.channel_id || 0
  );
  if (rawChannelId <= 0) {
    return { channels, mutated: false };
  }

  const matchedChannel = channels.find((c) => Number(c.id) === rawChannelId);
  const targetHubId =
    matchedChannel?.parent_hub_id && Number(matchedChannel.parent_hub_id) > 0
      ? Number(matchedChannel.parent_hub_id)
      : rawChannelId;

  const thread = event.thread;
  const isVisible = thread ? isThreadVisibleToUser(thread, currentUser) : true;
  if (!isVisible) {
    return { channels, mutated: false };
  }

  const actorId = Number(event.actor_id || thread?.author?.id || 0);
  const isOtherActor = actorId === 0 || actorId !== Number(currentUser.id);

  let unreadDelta = 0;
  if (event.type === 'thread.created') {
    if (isOtherActor) {
      unreadDelta = 1;
    }
  } else if (
    event.type === 'thread.faq_pinned' ||
    ((event.type === 'thread.replied' || event.type === 'thread.updated') &&
      Boolean(thread?.is_resolved || thread?.is_pinned_faq))
  ) {
    if (thread?.was_unresolved !== false) {
      unreadDelta = -1;
    }
  } else if (event.type === 'thread.deleted') {
    const wasAlreadyResolved =
      thread?.was_unresolved === false ||
      (thread?.was_unresolved === undefined && Boolean(thread?.is_resolved));
    if (!wasAlreadyResolved) {
      unreadDelta = -1;
    }
  }

  const shouldBumpUnseenActivity =
    (event.type === 'thread.created' || event.type === 'thread.replied') &&
    isOtherActor &&
    targetHubId !== Number(currentlyViewedHubId);

  if (unreadDelta === 0 && !shouldBumpUnseenActivity && !thread?.content) {
    return { channels, mutated: false };
  }

  let mutated = false;
  const nextChannels = channels.map((ch) => {
    if (Number(ch.id) !== targetHubId) return ch;
    mutated = true;

    const currentUnread = Math.max(0, Number(ch.unread_count ?? 0));
    const nextUnread = Math.max(0, currentUnread + unreadDelta);

    const prevBreakdown = ch.new_activity_breakdown ?? {
      chat: 0,
      announcements: 0,
      qa: 0,
    };

    const nextActivityCount = shouldBumpUnseenActivity
      ? (ch.new_activity_count ?? 0) + 1
      : ch.new_activity_count ?? 0;

    const nextBreakdown = shouldBumpUnseenActivity
      ? {
          ...prevBreakdown,
          qa: (prevBreakdown.qa ?? 0) + 1,
        }
      : prevBreakdown;

    return {
      ...ch,
      unread_count: nextUnread,
      has_updates: shouldBumpUnseenActivity ? true : ch.has_updates,
      new_activity_count: nextActivityCount,
      new_activity_breakdown: nextBreakdown,
    };
  });

  return { channels: mutated ? nextChannels : channels, mutated };
}

export function reconcileFetchedChannelsWithStaleGuard(params: {
  fetchedChannels: Channel[];
  currentChannels: Channel[];
  requestGeneration: number;
  currentMutationGeneration: number;
  requestStartedAt?: number;
  lastRealtimeMutationAt?: number;
}): { channels: Channel[]; isStale: boolean } {
  const {
    fetchedChannels,
    currentChannels,
    requestGeneration,
    currentMutationGeneration,
    requestStartedAt,
    lastRealtimeMutationAt,
  } = params;

  const isStaleByGen = requestGeneration < currentMutationGeneration;
  const isStaleByTime =
    typeof requestStartedAt === 'number' &&
    typeof lastRealtimeMutationAt === 'number' &&
    requestStartedAt < lastRealtimeMutationAt;
  const isStale = isStaleByGen || isStaleByTime;

  if (!isStale || currentChannels.length === 0) {
    return { channels: fetchedChannels, isStale };
  }

  const currentById = new Map<number, Channel>();
  for (const ch of currentChannels) {
    currentById.set(Number(ch.id), ch);
  }

  const merged = fetchedChannels.map((fetched) => {
    const local = currentById.get(Number(fetched.id));
    if (!local) return fetched;
    return {
      ...fetched,
      unread_count:
        typeof local.unread_count === 'number'
          ? local.unread_count
          : fetched.unread_count,
      has_updates:
        typeof local.has_updates === 'boolean'
          ? local.has_updates
          : fetched.has_updates,
      new_activity_count:
        typeof local.new_activity_count === 'number'
          ? local.new_activity_count
          : fetched.new_activity_count,
      new_activity_breakdown:
        local.new_activity_breakdown ?? fetched.new_activity_breakdown,
      new_activity_sub_channel_id:
        local.new_activity_sub_channel_id !== undefined
          ? local.new_activity_sub_channel_id
          : fetched.new_activity_sub_channel_id,
    };
  });

  return { channels: merged, isStale: true };
}

// ============================================================================
// ANNOUNCEMENT ATTACHMENTS, COMPOSER FORM DATA & PROFILE AVATAR HELPERS
// ============================================================================

const ANNOUNCEMENT_MEDIA_PREFIX = '__CLARIFY_ANN_MEDIA__';

export const MAX_ANNOUNCEMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

export const ANNOUNCEMENT_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
] as const;

export const ANNOUNCEMENT_DOCUMENT_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'txt',
] as const;

export const ANNOUNCEMENT_ALLOWED_EXTENSIONS = [
  ...ANNOUNCEMENT_IMAGE_EXTENSIONS,
  ...ANNOUNCEMENT_DOCUMENT_EXTENSIONS,
] as const;

export const PROFILE_AVATAR_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
] as const;

export const CAMPUS_WIDE_AVAILABLE_TAGS = [
  'URGENT NOTICE',
  'OFFICIAL MEMO',
  'CDO CAMPUS',
  'CITC',
  'CEA',
  'COT',
  'CSM',
  'Faculty',
  'MEMORANDUM',
] as const;

export const CAMPUS_DEPARTMENTS = ['CITC', 'CEA', 'COT', 'CSM'] as const;

/**
 * Parses an announcement's text content and attachment metadata, resolving either dedicated
 * `attachment_url` / `attachment_name` / `attachment_type` columns or a legacy embedded header.
 * Ported from clarify-web/src/lib/domain-logic.ts.
 */
export function parseAnnouncementAttachment(announcement: {
  content: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: 'image' | 'pdf' | 'document' | null;
}): {
  cleanContent: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: 'image' | 'document' | null;
} {
  const rawContent = announcement.content || '';
  let cleanContent = rawContent;
  let embeddedMeta: {
    name?: string;
    type?: 'image' | 'pdf' | 'document';
    dataUrl?: string;
    url?: string;
  } | null = null;

  if (rawContent.startsWith(ANNOUNCEMENT_MEDIA_PREFIX)) {
    const newlineIdx = rawContent.indexOf('\n');
    const jsonPart =
      newlineIdx === -1
        ? rawContent.slice(ANNOUNCEMENT_MEDIA_PREFIX.length)
        : rawContent.slice(ANNOUNCEMENT_MEDIA_PREFIX.length, newlineIdx);
    cleanContent =
      newlineIdx === -1 ? '' : rawContent.slice(newlineIdx + 1).trim();
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed && (parsed.dataUrl || parsed.url)) {
        embeddedMeta = parsed;
      }
    } catch {
      cleanContent = rawContent;
    }
  }

  const rawUrl = announcement.attachment_url || null;
  const embeddedUrl = embeddedMeta?.dataUrl || embeddedMeta?.url || null;
  const isSyntheticStoragePath =
    rawUrl && rawUrl.startsWith('/storage/memos/') && embeddedUrl;

  const attachmentUrl = isSyntheticStoragePath
    ? embeddedUrl
    : rawUrl || embeddedUrl;

  const attachmentName =
    announcement.attachment_name || embeddedMeta?.name || null;

  const inferType = (): 'image' | 'document' | null => {
    if (announcement.attachment_type === 'image') return 'image';
    if (
      announcement.attachment_type === 'pdf' ||
      announcement.attachment_type === 'document'
    ) {
      return 'document';
    }
    if (embeddedMeta?.type === 'image') return 'image';
    if (embeddedMeta?.type === 'pdf' || embeddedMeta?.type === 'document') {
      return 'document';
    }
    if (attachmentUrl?.startsWith('data:image/')) return 'image';
    if (
      attachmentUrl &&
      /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(attachmentUrl)
    ) {
      return 'image';
    }
    if (
      attachmentName &&
      /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(attachmentName)
    ) {
      return 'image';
    }
    if (attachmentUrl || attachmentName) return 'document';
    return null;
  };

  return {
    cleanContent,
    attachmentUrl,
    attachmentName,
    attachmentType: inferType(),
  };
}

function extractLowerExtension(fileName: string): string {
  const trimmed = (fileName || '').trim();
  if (!trimmed.includes('.')) return '';
  return trimmed.split('.').pop()!.toLowerCase();
}

/**
 * Validates a selected file for an announcement attachment against clarify-api rules:
 * max 10 MB, allowed image/document extensions, no executable/script files.
 */
export function validateAnnouncementAttachmentFile(
  file: {
    name: string;
    size?: number;
    type?: string;
  },
  preferredKind?: 'image' | 'document'
):
  | { valid: true; attachmentType: 'image' | 'document' }
  | { valid: false; error: string } {
  if (!file || !file.name || !file.name.trim()) {
    return { valid: false, error: 'Selected attachment file is invalid.' };
  }

  if (typeof file.size === 'number') {
    if (file.size <= 0) {
      return { valid: false, error: 'Selected attachment file is empty.' };
    }
    if (file.size > MAX_ANNOUNCEMENT_ATTACHMENT_BYTES) {
      return {
        valid: false,
        error: 'Attachment file size must not exceed 10 MB.',
      };
    }
  }

  const ext = extractLowerExtension(file.name);
  const mime = (file.type || '').toLowerCase();

  if (
    FORBIDDEN_CHAT_EXTENSIONS.has(ext) ||
    mime.includes('php') ||
    mime.includes('x-msdownload') ||
    mime.includes('x-executable') ||
    mime.includes('javascript') ||
    mime.includes('text/html')
  ) {
    return {
      valid: false,
      error: 'Executable or script files are not allowed as announcement attachments.',
    };
  }

  const isAllowed = (ANNOUNCEMENT_ALLOWED_EXTENSIONS as readonly string[]).includes(
    ext
  );
  if (!isAllowed) {
    return {
      valid: false,
      error:
        'Unsupported file type. Allowed: JPG, PNG, WEBP, GIF, PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, or TXT.',
    };
  }

  const isImage =
    (ANNOUNCEMENT_IMAGE_EXTENSIONS as readonly string[]).includes(ext) ||
    mime.startsWith('image/');

  if (preferredKind === 'image' && !isImage) {
    return {
      valid: false,
      error: 'Please select a valid image file (JPG, PNG, WEBP, or GIF).',
    };
  }

  return { valid: true, attachmentType: isImage ? 'image' : 'document' };
}

/**
 * Validates a profile avatar image against clarify-api ProfileController rules:
 * max 5 MB, jpg/jpeg/png/webp only.
 */
export function validateProfileAvatarFile(file: {
  name: string;
  size?: number;
  type?: string;
}): { valid: true } | { valid: false; error: string } {
  if (!file || !file.name || !file.name.trim()) {
    return { valid: false, error: 'Selected image is invalid.' };
  }
  if (typeof file.size === 'number') {
    if (file.size <= 0) {
      return { valid: false, error: 'Selected image file is empty.' };
    }
    if (file.size > MAX_PROFILE_AVATAR_BYTES) {
      return {
        valid: false,
        error: 'Profile photo must not exceed 5 MB.',
      };
    }
  }
  const ext = extractLowerExtension(file.name);
  const mime = (file.type || '').toLowerCase();
  const isAllowedExt = (PROFILE_AVATAR_EXTENSIONS as readonly string[]).includes(
    ext
  );
  const isAllowedMime =
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/png' ||
    mime === 'image/webp';

  if (!isAllowedExt && !isAllowedMime) {
    return {
      valid: false,
      error: 'Profile photo must be a JPG, PNG, or WEBP image.',
    };
  }
  return { valid: true };
}

/**
 * Formats byte sizes into concise human-readable labels (e.g., 1.4 MB, 320 KB).
 */
export function formatFileSize(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Determines whether the signed-in user should see Edit/Delete UX controls for an announcement.
 * Strictly returns false for students and IT admins; matches clarify-web AnnouncementCard.
 */
export function canManageAnnouncement(
  announcement: Announcement,
  user: User | null | undefined,
  channels: Channel[] = []
): boolean {
  if (!user || user.role === 'student' || user.role === 'it_admin') {
    return false;
  }
  const matchedChannel = channels.find(
    (c) => Number(c.id) === Number(announcement.channel_id)
  );
  const isCampusWideMemo =
    announcement.channel_type === 'university' ||
    matchedChannel?.channel_type === 'university';
  return isCampusWideMemo
    ? user.role === 'dept_head'
    : canPublishOrManageAnnouncements(user.role);
}

/**
 * Builds a multipart/form-data payload for POST /announcements or PATCH /announcements/{id}
 * matching clarify-web AnnouncementFormModal and clarify-api AnnouncementController.
 */
export function buildAnnouncementFormData(params: {
  title: string;
  content: string;
  isCampusWide: boolean;
  isEditing: boolean;
  tags: string[];
  isUrgent: boolean;
  triggerSmsFallback: boolean;
  status: 'published' | 'draft';
  selectedChannelIds?: number[];
  attachment?: NativeUploadFile | null;
  attachmentType?: 'image' | 'document' | null;
  removeExistingAttachment?: boolean;
}): FormData {
  const formData = new FormData();
  const outgoingTags = params.isCampusWide ? params.tags : [];

  formData.append('title', params.title.trim());
  formData.append('content', params.content.trim());
  formData.append('tags', JSON.stringify(outgoingTags));
  formData.append('is_urgent', params.isUrgent ? '1' : '0');
  formData.append(
    'trigger_sms_fallback',
    params.triggerSmsFallback ? '1' : '0'
  );
  formData.append('status', params.status);

  if (params.attachment) {
    formData.append('attachment', {
      uri: params.attachment.uri,
      name: params.attachment.name,
      type: params.attachment.type || 'application/octet-stream',
    } as unknown as Blob);
    formData.append('attachment_name', params.attachment.name);
    if (params.attachmentType) {
      formData.append('attachment_type', params.attachmentType);
    }
  } else if (params.removeExistingAttachment) {
    formData.append('remove_attachment', '1');
  }

  if (!params.isEditing) {
    formData.append(
      'scope_mode',
      params.isCampusWide ? 'campus_wide' : 'course_hub'
    );
    if (!params.isCampusWide) {
      const targetIds = (params.selectedChannelIds || []).filter(
        (id) => Number.isInteger(id) && id > 0
      );
      if (targetIds.length > 0) {
        formData.append('channel_id', String(targetIds[0]));
        formData.append('channel_ids', JSON.stringify(targetIds));
      }
    }
  }

  return formData;
}

/**
 * Builds a multipart/form-data payload for POST /profile (_method=PATCH appended by updateProfileApi).
 */
export function buildProfileUpdateFormData(params: {
  contactNumber: string;
  avatarFile?: NativeUploadFile | null;
  removeAvatar?: boolean;
  existingAvatarUrl?: string | null;
}): FormData {
  const formData = new FormData();
  formData.append('contact_number', params.contactNumber.trim());

  if (params.avatarFile) {
    formData.append('avatar', {
      uri: params.avatarFile.uri,
      name: params.avatarFile.name,
      type: params.avatarFile.type || 'image/jpeg',
    } as unknown as Blob);
  } else if (params.removeAvatar) {
    // Empty string instructs ProfileController to set avatar_url = null
    formData.append('avatar_preview_url', '');
  } else if (params.existingAvatarUrl) {
    formData.append('avatar_preview_url', params.existingAvatarUrl);
  }

  return formData;
}

/**
 * Formats an audio duration in seconds as `M:SS` using safe non-negative integers.
 */
export function formatAudioDuration(
  seconds: number | null | undefined
): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const rounded = Math.floor(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const VOICE_EXTENSION_TO_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
};

/**
 * Builds a validated NativeUploadFile descriptor for a recorded voice note
 * so Laravel's `mimes:...,webm,ogg,wav,mp3,m4a` validation always succeeds.
 */
export function buildVoiceRecordingDescriptor(params: {
  uri: string;
  durationSec: number;
  fileSize?: number | null;
}): {
  uri: string;
  name: string;
  type: string;
  size: number;
  durationSec: number;
} {
  const cleanUri = (params.uri || '').trim();
  const pathWithoutQuery = cleanUri.split('?')[0] || '';
  const rawExt = pathWithoutQuery.includes('.')
    ? pathWithoutQuery.split('.').pop()!.toLowerCase()
    : '';
  const ext = Object.prototype.hasOwnProperty.call(
    VOICE_EXTENSION_TO_MIME,
    rawExt
  )
    ? rawExt
    : 'm4a';
  const mime = VOICE_EXTENSION_TO_MIME[ext] || 'audio/mp4';

  const safeDuration =
    typeof params.durationSec === 'number' &&
    Number.isFinite(params.durationSec) &&
    params.durationSec > 0
      ? Math.max(1, Math.round(params.durationSec))
      : 1;
  const clockLabel = formatAudioDuration(safeDuration).replace(':', 'm');
  const safeSize =
    typeof params.fileSize === 'number' &&
    Number.isFinite(params.fileSize) &&
    params.fileSize > 0
      ? Math.round(params.fileSize)
      : Math.max(1024, safeDuration * 16000);

  return {
    uri: cleanUri,
    name: `Voice_Note_${clockLabel}s.${ext}`,
    type: mime,
    size: safeSize,
    durationSec: safeDuration,
  };
}

const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Normalizes an ImagePicker asset into a Laravel-safe `{ uri, name, type, size }` descriptor.
 */
export function normalizePickedChatImage(params: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): {
  uri: string;
  name: string;
  type: string;
  size: number;
} {
  const cleanUri = (params.uri || '').trim();
  const rawName = (params.fileName || '').trim();
  const uriBase = (cleanUri.split('?')[0] || '').split('/').pop() || '';
  const candidateName = rawName || uriBase || `chat_photo_${Date.now()}.jpg`;
  const rawExt = candidateName.includes('.')
    ? candidateName.split('.').pop()!.toLowerCase()
    : '';
  const lowerMime = (params.mimeType || '').toLowerCase();

  let ext = rawExt;
  if (!Object.prototype.hasOwnProperty.call(IMAGE_EXTENSION_TO_MIME, ext)) {
    if (lowerMime.includes('png')) ext = 'png';
    else if (lowerMime.includes('webp')) ext = 'webp';
    else if (lowerMime.includes('gif')) ext = 'gif';
    else ext = 'jpg';
  }

  const baseWithoutExt = candidateName.includes('.')
    ? candidateName.replace(/\.[^.]+$/, '')
    : candidateName;
  const safeBase = baseWithoutExt.replace(/[^\w\-. ()[\]]+/g, '_') || 'photo';
  const name = `${safeBase}.${ext}`;
  const type = IMAGE_EXTENSION_TO_MIME[ext] || 'image/jpeg';
  const size =
    typeof params.fileSize === 'number' &&
    Number.isFinite(params.fileSize) &&
    params.fileSize > 0
      ? Math.round(params.fileSize)
      : 1024;

  return {
    uri: cleanUri,
    name,
    type,
    size,
  };
}

// ============================================================================
// IT ADMIN CONSOLE: TAB ROUTING, SEARCH & FILTER TAGS, LIVE LATENCY FORMATTING
// ============================================================================

export type AdminSectionTab = 'verifications' | 'rbac' | 'roster-sync' | 'metrics';

export const ADMIN_DEPARTMENT_TAGS = ['CITC', 'CEA', 'COT', 'CSM'] as const;

export function parseAdminSectionTab(
  raw: string | null | undefined
): AdminSectionTab {
  const normalized = (raw || '').trim().toLowerCase();
  if (normalized === 'rbac') return 'rbac';
  if (normalized === 'roster-sync' || normalized === 'prisms') return 'roster-sync';
  if (normalized === 'metrics' || normalized === 'audits') return 'metrics';
  return 'verifications';
}

export function getAdminSectionTitle(tab: AdminSectionTab): string {
  switch (tab) {
    case 'verifications':
      return 'IT Admin — Account Verification Queue';
    case 'rbac':
      return 'IT Admin — RBAC Role Management';
    case 'roster-sync':
      return 'IT Admin — Account & Roster Sync Console';
    case 'metrics':
      return 'IT Admin — System Metrics & Audit Trail';
  }
}

export type VerificationStatusFilter = 'pending' | 'rejected' | 'all';

export function filterVerificationQueueUsers(
  users: User[],
  options: {
    search?: string;
    status?: VerificationStatusFilter;
    role?: 'all' | 'student' | 'faculty';
    department?: string;
  } = {}
): User[] {
  const {
    search = '',
    status = 'pending',
    role = 'all',
    department = 'ALL',
  } = options;
  const query = search.trim().toLowerCase();
  const deptFilter = department.trim().toUpperCase();

  return users.filter((u) => {
    if (status === 'pending' && u.verification_status !== 'pending') return false;
    if (status === 'rejected' && u.verification_status !== 'rejected') return false;
    if (
      status === 'all' &&
      u.verification_status !== 'pending' &&
      u.verification_status !== 'rejected'
    ) {
      return false;
    }

    if (role !== 'all' && u.role !== role) return false;

    const userDept = (u.academic_profile?.department || '').trim().toUpperCase();
    if (deptFilter !== 'ALL' && userDept !== deptFilter) return false;

    if (query) {
      const haystack = [
        u.name,
        u.institutional_id,
        u.email,
        u.contact_number || '',
        u.role,
        u.academic_profile?.department || '',
        u.academic_profile?.section || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export function filterRbacUsers(
  users: User[],
  options: {
    search?: string;
    role?: 'all' | UserRole;
    department?: string;
  } = {}
): User[] {
  const { search = '', role = 'all', department = 'ALL' } = options;
  const query = search.trim().toLowerCase();
  const deptFilter = department.trim().toUpperCase();

  return users.filter((u) => {
    if (role !== 'all' && u.role !== role) return false;

    const userDept = (u.academic_profile?.department || '').trim().toUpperCase();
    if (deptFilter !== 'ALL' && userDept !== deptFilter) return false;

    if (query) {
      const haystack = [
        u.name,
        u.institutional_id,
        u.email,
        u.contact_number || '',
        u.role,
        u.academic_profile?.department || '',
        u.academic_profile?.section || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export function filterSyncLogs(
  logs: PrismsSyncLog[],
  options: {
    search?: string;
    syncType?: 'all' | 'manual_admin' | 'scheduled_midnight';
    status?: 'all' | 'completed' | 'partial_warning' | 'failed';
  } = {}
): PrismsSyncLog[] {
  const { search = '', syncType = 'all', status = 'all' } = options;
  const query = search.trim().toLowerCase();

  return logs.filter((log) => {
    if (syncType !== 'all' && log.sync_type !== syncType) return false;
    if (status !== 'all' && log.status !== status) return false;

    if (query) {
      const haystack = [
        String(log.id),
        `#${log.id}`,
        log.semester_code,
        log.triggered_by,
        log.sync_type,
        log.status,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export type AuditChangeTypeFilter = 'all' | 'title_changed' | 'content_changed';

export function filterAnnouncementAudits(
  audits: AnnouncementAudit[],
  options: {
    search?: string;
    editorRole?: 'all' | UserRole;
    changeType?: AuditChangeTypeFilter;
  } = {}
): AnnouncementAudit[] {
  const { search = '', editorRole = 'all', changeType = 'all' } = options;
  const query = search.trim().toLowerCase();

  return audits.filter((audit) => {
    if (editorRole !== 'all' && audit.editor_role !== editorRole) return false;

    const titleChanged =
      (audit.previous_title || '').trim() !== (audit.new_title || '').trim();
    const contentChanged =
      (audit.previous_content || '').trim() !== (audit.new_content || '').trim();

    if (changeType === 'title_changed' && !titleChanged) return false;
    if (changeType === 'content_changed' && !contentChanged) return false;

    if (query) {
      const haystack = [
        String(audit.id),
        `#${audit.id}`,
        `post #${audit.announcement_id}`,
        String(audit.announcement_id),
        audit.previous_title || '',
        audit.new_title || '',
        audit.previous_content || '',
        audit.new_content || '',
        audit.editor_name || '',
        audit.editor_role || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

/**
 * Formats measured backend/round-trip API latency against the <=2.0s SLA target.
 * Never returns hardcoded mock values.
 */
export function formatMeasuredLatency(params: {
  apiLatencyMs?: number | null;
  clientRoundTripMs?: number | null;
}): {
  primaryDisplay: string;
  secondaryMs: number | null;
  seconds: number | null;
  withinSla: boolean;
} {
  const rawMs =
    typeof params.apiLatencyMs === 'number' &&
    Number.isFinite(params.apiLatencyMs) &&
    params.apiLatencyMs >= 0
      ? params.apiLatencyMs
      : typeof params.clientRoundTripMs === 'number' &&
        Number.isFinite(params.clientRoundTripMs) &&
        params.clientRoundTripMs >= 0
      ? params.clientRoundTripMs
      : null;

  if (rawMs === null) {
    return {
      primaryDisplay: '—',
      secondaryMs: null,
      seconds: null,
      withinSla: true,
    };
  }

  const roundedMs = Math.max(1, Math.round(rawMs));
  const seconds = Number((roundedMs / 1000).toFixed(2));
  const primaryDisplay =
    roundedMs < 1000 ? `${roundedMs}ms` : `${seconds.toFixed(2)}s`;

  return {
    primaryDisplay,
    secondaryMs: roundedMs,
    seconds,
    withinSla: seconds <= 2.0,
  };
}

/**
 * Returns the RBAC department options matching clarify-web:
 * ADMIN_DEPARTMENT_TAGS plus the target account's current department if outside those 4.
 */
export function getRbacDepartmentOptions(
  currentDepartment?: string | null
): string[] {
  const normalized =
    (currentDepartment || 'CITC').trim().toUpperCase() || 'CITC';
  return Array.from(new Set([...ADMIN_DEPARTMENT_TAGS, normalized]));
}

export interface AdminMetricsSnapshotInput {
  metrics?: AdminMetricsResponse | null;
  queueUsers?: User[] | null;
  allUsers?: User[] | null;
  clientRoundTripMs?: number | null;
}

export interface AdminMetricsSnapshot {
  pendingCount: number | null;
  rejectedCount: number | null;
  verifiedAccountsCount: number | null;
  totalRegisteredAccountsCount: number | null;
  roleCounts: AdminRoleBreakdown | null;
  departmentCounts: Record<string, number> | null;
  auditsTotal: number | null;
  verificationRatePercent: number | null;
  latency: {
    primaryDisplay: string;
    secondaryMs: number | null;
    seconds: number | null;
    withinSla: boolean;
  };
  kpi: {
    pendingDisplay: string;
    pendingSubline: string;
    isPendingWarning: boolean;
    registeredDisplay: string;
    registeredSubline: string;
    latencyDisplay: string;
    latencySubline: string;
    isLatencySlaMet: boolean;
    hasLatencyMeasurement: boolean;
    auditsDisplay: string;
    auditsSubline: string;
  };
  rosterSummary: {
    liveRegisteredLabel: string;
    departmentDisplayByTag: Record<string, string>;
    scopedChannelsDisplay: string;
    courseHubsSubline: string;
  };
  health: {
    verificationRatioDisplay: string;
    verificationRatioSubline: string;
    overallReadReachDisplay: string;
    overallReadReachSubline: string;
    urgentNoticesDisplay: string;
    urgentNoticesSubline: string;
    activeChannelsDisplay: string;
    activeChannelsSubline: string;
  };
}

/**
 * Computes all IT Admin KPI cards, Roster Sync summary cards, and Platform Health cards
 * strictly from real database metrics/lists, rendering "—" whenever a field is missing.
 */
export function computeAdminMetricsSnapshot(
  input: AdminMetricsSnapshotInput = {}
): AdminMetricsSnapshot {
  const { metrics, queueUsers, allUsers, clientRoundTripMs } = input;

  const isFiniteNonNegative = (val: unknown): val is number =>
    typeof val === 'number' && Number.isFinite(val) && val >= 0;

  const pendingCount = isFiniteNonNegative(metrics?.pending_verifications_count)
    ? metrics.pending_verifications_count
    : Array.isArray(queueUsers)
      ? queueUsers.filter((u) => u.verification_status === 'pending').length
      : null;

  const rejectedCount = isFiniteNonNegative(metrics?.rejected_verifications_count)
    ? metrics.rejected_verifications_count
    : Array.isArray(queueUsers)
      ? queueUsers.filter((u) => u.verification_status === 'rejected').length
      : null;

  const verifiedAccountsCount = isFiniteNonNegative(
    metrics?.verified_accounts_count
  )
    ? metrics.verified_accounts_count
    : Array.isArray(allUsers)
      ? allUsers.length
      : null;

  const totalRegisteredAccountsCount = isFiniteNonNegative(
    metrics?.total_registered_users_count
  )
    ? metrics.total_registered_users_count
    : verifiedAccountsCount !== null &&
        pendingCount !== null &&
        rejectedCount !== null
      ? verifiedAccountsCount + pendingCount + rejectedCount
      : null;

  let roleCounts: AdminRoleBreakdown | null = null;
  if (metrics?.role_breakdown) {
    roleCounts = metrics.role_breakdown;
  } else if (Array.isArray(allUsers)) {
    const counts: AdminRoleBreakdown = {
      student: 0,
      faculty: 0,
      dept_head: 0,
      it_admin: 0,
    };
    for (const u of allUsers) {
      if (u.role in counts) {
        counts[u.role] += 1;
      }
    }
    roleCounts = counts;
  }

  let departmentCounts: Record<string, number> | null = null;
  if (
    metrics?.department_breakdown &&
    Object.keys(metrics.department_breakdown).length > 0
  ) {
    departmentCounts = metrics.department_breakdown;
  } else if (Array.isArray(allUsers)) {
    const map: Record<string, number> = {};
    for (const u of allUsers) {
      const dept =
        (u.academic_profile?.department || 'UNASSIGNED').trim().toUpperCase() ||
        'UNASSIGNED';
      map[dept] = (map[dept] || 0) + 1;
    }
    departmentCounts = map;
  }

  const auditsTotal = isFiniteNonNegative(metrics?.announcement_audits_total)
    ? metrics.announcement_audits_total
    : Array.isArray(metrics?.announcement_audits)
      ? metrics.announcement_audits.length
      : null;

  const verificationRatePercent =
    verifiedAccountsCount !== null && totalRegisteredAccountsCount !== null
      ? totalRegisteredAccountsCount > 0
        ? Math.round(
            (verifiedAccountsCount / totalRegisteredAccountsCount) * 100
          )
        : 0
      : null;

  const latency = formatMeasuredLatency({
    apiLatencyMs: metrics?.api_latency_ms ?? null,
    clientRoundTripMs,
  });

  const departmentDisplayByTag: Record<string, string> = {};
  for (const dept of ADMIN_DEPARTMENT_TAGS) {
    departmentDisplayByTag[dept] =
      departmentCounts !== null
        ? (departmentCounts[dept] || 0).toLocaleString()
        : '—';
  }

  return {
    pendingCount,
    rejectedCount,
    verifiedAccountsCount,
    totalRegisteredAccountsCount,
    roleCounts,
    departmentCounts,
    auditsTotal,
    verificationRatePercent,
    latency,
    kpi: {
      pendingDisplay:
        pendingCount !== null ? pendingCount.toLocaleString() : '—',
      pendingSubline:
        rejectedCount === null
          ? '—'
          : rejectedCount > 0
            ? `${rejectedCount} rejected in archive`
            : 'Registrar queue live',
      isPendingWarning: pendingCount !== null && pendingCount > 0,
      registeredDisplay:
        verifiedAccountsCount !== null
          ? verifiedAccountsCount.toLocaleString()
          : '—',
      registeredSubline:
        totalRegisteredAccountsCount !== null && roleCounts !== null
          ? `${totalRegisteredAccountsCount.toLocaleString()} total • ${roleCounts.student} students, ${roleCounts.faculty + roleCounts.dept_head} faculty`
          : '—',
      latencyDisplay: latency.primaryDisplay,
      latencySubline: isFiniteNonNegative(metrics?.urgent_announcements_count)
        ? `${metrics.urgent_announcements_count} urgent alerts sent`
        : latency.seconds !== null
          ? 'Live DB round-trip'
          : '—',
      isLatencySlaMet: latency.withinSla,
      hasLatencyMeasurement: latency.seconds !== null,
      auditsDisplay:
        auditsTotal !== null ? auditsTotal.toLocaleString() : '—',
      auditsSubline: isFiniteNonNegative(metrics?.published_announcements_count)
        ? `${metrics.published_announcements_count} published notices`
        : auditsTotal !== null
          ? 'Append-only revision log'
          : '—',
    },
    rosterSummary: {
      liveRegisteredLabel:
        verifiedAccountsCount !== null
          ? `${verifiedAccountsCount} Live Registered Accounts`
          : '— Live Registered Accounts',
      departmentDisplayByTag,
      scopedChannelsDisplay: isFiniteNonNegative(metrics?.active_channels_count)
        ? metrics.active_channels_count.toLocaleString()
        : '—',
      courseHubsSubline: isFiniteNonNegative(metrics?.course_hubs_count)
        ? `${metrics.course_hubs_count} course hubs`
        : '—',
    },
    health: {
      verificationRatioDisplay:
        verificationRatePercent !== null ? `${verificationRatePercent}%` : '—',
      verificationRatioSubline:
        verifiedAccountsCount !== null && totalRegisteredAccountsCount !== null
          ? `${verifiedAccountsCount} approved of ${totalRegisteredAccountsCount} registered`
          : '—',
      overallReadReachDisplay: isFiniteNonNegative(
        metrics?.overall_read_reach_percentage
      )
        ? `${metrics.overall_read_reach_percentage.toFixed(1)}%`
        : '—',
      overallReadReachSubline: isFiniteNonNegative(
        metrics?.published_announcements_count
      )
        ? `Across ${metrics.published_announcements_count} published notices`
        : '—',
      urgentNoticesDisplay: isFiniteNonNegative(
        metrics?.urgent_announcements_count
      )
        ? metrics.urgent_announcements_count.toLocaleString()
        : '—',
      urgentNoticesSubline: isFiniteNonNegative(
        metrics?.sms_fallback_dispatched_count
      )
        ? `${metrics.sms_fallback_dispatched_count} with SMS fallback`
        : '—',
      activeChannelsDisplay: isFiniteNonNegative(metrics?.active_channels_count)
        ? metrics.active_channels_count.toLocaleString()
        : '—',
      activeChannelsSubline: isFiniteNonNegative(metrics?.course_hubs_count)
        ? `${metrics.course_hubs_count} top-level Course Hubs`
        : '—',
    },
  };
}

// ============================================================================
// SMS OTP PASSWORD RESET HELPERS (ported from clarify-web)
// ============================================================================

export type PasswordResetStep = 'request' | 'verify' | 'reset' | 'done';

/**
 * Strips non-digit characters and caps OTP input to 6 digits so pasting
 * formatted codes like "123 456" or "123-456" works cleanly.
 */
export function sanitizeOtpInput(raw: string): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

/**
 * Extracts a positive retry-after countdown in seconds from an ApiError / HTTP 429 payload.
 */
export function extractRetryAfterSeconds(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 0;
  }
  const errObj = error as {
    retryAfter?: unknown;
    retry_after?: unknown;
    data?: { retry_after?: unknown };
  };
  const candidate =
    typeof errObj.retryAfter === 'number'
      ? errObj.retryAfter
      : typeof errObj.retry_after === 'number'
        ? errObj.retry_after
        : typeof errObj.data?.retry_after === 'number'
          ? errObj.data.retry_after
          : 0;
  return Number.isFinite(candidate) && candidate > 0
    ? Math.ceil(candidate)
    : 0;
}

/**
 * Client-side validation for the new password + confirmation step (mirrors Laravel min:8 + confirmed).
 */
export function validatePasswordResetFields(
  password: string,
  confirmPassword: string
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!password) {
    errors.password = ['Please enter a new password.'];
  } else if (password.length < 8) {
    errors.password = ['Password must be at least 8 characters long.'];
  }
  if (!confirmPassword) {
    errors.password_confirmation = ['Please confirm your new password.'];
  } else if (password !== confirmPassword) {
    errors.password_confirmation = [
      'Password confirmation does not match your new password.',
    ];
  }
  return errors;
}

/**
 * Formats the resend OTP button label with live countdown.
 */
export function formatOtpCooldownLabel(cooldownSeconds: number): string {
  if (cooldownSeconds > 0) {
    return `Resend code in ${Math.ceil(cooldownSeconds)}s`;
  }
  return 'Resend SMS Code';
}

