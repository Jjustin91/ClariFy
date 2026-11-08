import type {
  Announcement,
  Channel,
  QaThread,
  ReadReach,
  User,
  UserRole,
} from '../types/api';

const HUB_PREFIX_REGEX = /^\[HUB:(\d+)\]\s*/i;

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
  user: User | undefined
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
  user: User | undefined
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
  user: User | undefined
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
  user: User | undefined
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
 * Strictly prevents unenrolled users from viewing any Course Hub they have not joined.
 */
export function resolveCourseHubSelection(
  channels: Channel[],
  requestedChannelId: number,
  user?: User
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

  // When a user is provided and has not joined any Course Hubs yet, never expose any hub
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
    // Check if the requested channel is a sub-channel of a joined Course Hub
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

    // Check if the requested channel is a joined top-level Course Hub
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

/**
 * Validates a File/Blob candidate before staging or uploading to Course Hub chat.
 * Enforces <= 10 MB and allowed extension/MIME types.
 */
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
 * Never base64-encodes the file inside `content`.
 */
export function buildChatMessageFormData(params: {
  content: string;
  tempId?: string;
  attachment: File | Blob;
  attachmentFileName?: string;
}): FormData {
  const formData = new FormData();
  formData.append('content', params.content);
  if (params.tempId) {
    formData.append('temp_id', params.tempId);
  }
  const fileName =
    params.attachmentFileName ||
    ('name' in params.attachment && typeof params.attachment.name === 'string'
      ? params.attachment.name
      : 'attachment.bin');
  formData.append('attachment', params.attachment, fileName);
  return formData;
}

/**
 * Retains pending/failed upload File references keyed by optimistic `temp_id`
 * so that retrying a failed chat message re-sends the exact same File object.
 */
export function createRetryableChatFileStore<TFile = File>() {
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

const CHAT_MEDIA_PREFIX = '__CLARIFY_MEDIA__';

/**
 * Legacy helper preserved only for backward compatibility.
 * New chat messages upload real files via `buildChatMessageFormData`.
 */
export function encodeChatMessageWithAttachment(
  text: string,
  attachment: ChatMediaAttachment | null
): string {
  const trimmed = text.trim();
  if (!attachment) {
    return trimmed;
  }
  const metaJson = JSON.stringify(attachment);
  return `${CHAT_MEDIA_PREFIX}${metaJson}\n${trimmed}`;
}

/**
 * Parses a raw chat message content string into its text body and optional legacy media attachment.
 * Used as a fallback for historical messages created before dedicated attachment columns.
 */
export function parseChatMessageContent(rawContent: string): {
  text: string;
  attachment: ChatMediaAttachment | null;
} {
  if (!rawContent) {
    return { text: '', attachment: null };
  }
  if (rawContent.startsWith(CHAT_MEDIA_PREFIX)) {
    const newlineIdx = rawContent.indexOf('\n');
    const jsonPart =
      newlineIdx === -1
        ? rawContent.slice(CHAT_MEDIA_PREFIX.length)
        : rawContent.slice(CHAT_MEDIA_PREFIX.length, newlineIdx);
    const textPart =
      newlineIdx === -1 ? '' : rawContent.slice(newlineIdx + 1).trim();
    try {
      const parsed = JSON.parse(jsonPart) as ChatMediaAttachment;
      if (parsed && parsed.kind && parsed.dataUrl) {
        return { text: textPart, attachment: parsed };
      }
    } catch {
      // Fallback to plain text if malformed
    }
  }
  return { text: rawContent, attachment: null };
}

export interface AnnouncementAttachmentMeta {
  name: string;
  type: 'image' | 'document';
  dataUrl: string;
}

const ANNOUNCEMENT_MEDIA_PREFIX = '__CLARIFY_ANN_MEDIA__';

/**
 * Encodes an announcement content string with an optional self-contained attachment (image or document)
 * so that attachments persist reliably in the TEXT `content` column even before database migrations run.
 */
export function encodeAnnouncementContentWithAttachment(
  text: string,
  attachment: AnnouncementAttachmentMeta | null
): string {
  const trimmed = text.trim();
  if (!attachment || !attachment.dataUrl) {
    return trimmed;
  }
  const metaJson = JSON.stringify(attachment);
  return `${ANNOUNCEMENT_MEDIA_PREFIX}${metaJson}\n${trimmed}`;
}

/**
 * Returns the formatted label of approved Faculty / Dept Heads in a Course Hub.
 * Reads from `channel.faculty` returned by `ChannelResource` so it never depends on `channel.roster`.
 */
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

/**
 * Formats the Enrolled Roster summary from `members_count` and `students_count`
 * (e.g., "7 members (6 students)"). Never uses `roster.length` unless `members_count` is omitted.
 */
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

/**
 * Parses an announcement's text content and attachment metadata, resolving either dedicated
 * `attachment_url` / `attachment_name` / `attachment_type` columns or a legacy embedded header.
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

/**
 * Computes the updated ReadReach state when a student acknowledges an announcement.
 * Enforces idempotent acknowledgment, clamps acknowledged_count to enrolled_total,
 * and returns 0 / 0% when enrolled_total is 0 (no artificial floor).
 */
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

/**
 * Enforces FR-07 and NFR-05 (RA 10173 Data Privacy Act):
 * When a thread is converted/pinned to Class FAQs (`is_pinned_faq === true`),
 * the student's identity must be strictly masked as "Anonymous Student".
 */
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

/**
 * Formats a student inquiry subject into a valid hashtag (auto-prefixing # and replacing spaces).
 */
export function formatSubjectHashtag(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const withoutLeadingHashes = trimmed.replace(/^#+/, '').trim();
  if (!withoutLeadingHashes) return '';
  return `#${withoutLeadingHashes}`;
}

/**
 * Role-Based Access Control:
 * Only Faculty and Department Heads can create, edit, or delete announcements.
 * Students and IT Administrators are prohibited from publishing announcements.
 */
export function canPublishOrManageAnnouncements(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head';
}

/**
 * Only Department Heads can publish Campus-Wide Announcements on All Announcements / Dashboard.
 * Instructors/Faculty publish course-specific announcements inside their handled Course Hubs.
 */
export function canPublishCampusWideAnnouncements(role: UserRole): boolean {
  return role === 'dept_head';
}

/**
 * Role-Based Access Control:
 * Only Faculty and Department Heads can resolve tickets or pin to Class FAQs.
 */
export function canResolveOrPinThreads(role: UserRole): boolean {
  return role === 'faculty' || role === 'dept_head';
}

/**
 * Workflow 3 Activity Diagram:
 * A student can edit or delete their own inquiry only while `is_resolved === false`.
 */
export function canStudentModifyOwnInquiry(user: User, thread: QaThread): boolean {
  if (user.role !== 'student') return false;
  if (thread.is_resolved || thread.is_pinned_faq) return false;
  return thread.author.id === user.id;
}

/**
 * Privacy filter for Isolated Q&A Threads (Stakeholder Review Table E):
 * Private inquiries (`is_private === true`) are visible only to instructors/admins
 * or the student who authored them.
 */
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

/**
 * Filters and sorts announcements according to FR-04_REV and FR-05.
 * Urgent/Pinned notices always appear at the top unless explicitly sorted by oldest.
 */
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
    // Always prioritize urgent notices first, then pinned notices (FR-04_REV)
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
