import type {
  Announcement,
  Channel,
  NewActivityBreakdown,
  QaThread,
  ReadReach,
  RealtimeEvent,
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
 * Only Department Heads can publish Campus-Wide Announcements on Announcements / Dashboard.
 * Instructors/Faculty publish course-specific announcements inside their handled Course Hubs.
 */
export function canPublishCampusWideAnnouncements(role: UserRole): boolean {
  return role === 'dept_head';
}

/**
 * Returns the muted placeholder string for an unsent chat message ("You unsent a message" or "<Name> unsent a message"),
 * or null if the message is not unsent.
 */
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
 * Privacy filter for Isolated Q&A Threads:
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

export const USTP_EMAIL_ERROR_MESSAGE =
  'Only @ustp.edu.ph email addresses can create an account.';

/**
 * Normalizes an institutional email address by trimming whitespace and lowercasing.
 */
export function normalizeUstpEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

/**
 * Validates that an email address has a non-empty local part and an exact `@ustp.edu.ph` domain.
 * Rejects `@gmail.com`, `@mail.ustp.edu.ph`, `@ustp.edu.ph.evil.com`, and `@ustp.edu.ph` without a local part.
 */
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
  if (!localPart || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) {
    return false;
  }
  return domainPart === 'ustp.edu.ph';
}

/**
 * Returns the validation error message if the email is not a valid `@ustp.edu.ph` address, or null if valid.
 */
export function validateUstpEmail(raw: string): string | null {
  return isValidUstpEmail(raw) ? null : USTP_EMAIL_ERROR_MESSAGE;
}

/**
 * Normalizes a Philippine mobile number (`09XXXXXXXXX`, `9XXXXXXXXX`, `639XXXXXXXXX`, `+63 9XX XXX XXXX`)
 * into canonical `+639XXXXXXXXX` format, or returns null if invalid.
 */
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

/**
 * Formats non-zero activity breakdown categories into small labeled chips
 * ("2 chat", "1 Q&A", "1 announcement").
 */
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

/**
 * Resolves the deep-link destination URL for a Course Hub card on the Dashboard:
 * - If new_activity_breakdown is absent or all counts are 0, falls back to `/channels/{id}`.
 * - If one category has activity, routes directly to it:
 *   - chat -> `/channels/{new_activity_sub_channel_id || firstSubChannelId || id}?tab=messenger` (or `/channels/{subId}` for a sub-channel)
 *   - announcements -> `/channels/{id}?tab=feed`
 *   - qa -> `/channels/{id}?tab=threads`
 * - If multiple categories have activity, picks the highest count; tie-break order: qa, chat, announcements.
 */
export function resolveHubUpdateDestination(
  channel: Channel,
  subChannels: Channel[] = []
): string {
  const breakdown = channel.new_activity_breakdown;
  if (!breakdown) {
    return `/channels/${channel.id}`;
  }

  const qa = Math.max(0, Number(breakdown.qa || 0));
  const chat = Math.max(0, Number(breakdown.chat || 0));
  const announcements = Math.max(0, Number(breakdown.announcements || 0));

  if (qa === 0 && chat === 0 && announcements === 0) {
    return `/channels/${channel.id}`;
  }

  // Tie-break order: qa, chat, announcements
  const ordered: { category: HubActivityCategory; count: number }[] = [
    { category: 'qa', count: qa },
    { category: 'chat', count: chat },
    { category: 'announcements', count: announcements },
  ];

  let winner: HubActivityCategory = 'qa';
  let maxCount = -1;
  for (const entry of ordered) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      winner = entry.category;
    }
  }

  if (winner === 'qa') {
    return `/channels/${channel.id}?tab=threads`;
  }
  if (winner === 'announcements') {
    return `/channels/${channel.id}?tab=feed`;
  }

  // winner === 'chat'
  const preferredSubId =
    typeof channel.new_activity_sub_channel_id === 'number' &&
    channel.new_activity_sub_channel_id > 0 &&
    channel.new_activity_sub_channel_id !== channel.id
      ? channel.new_activity_sub_channel_id
      : subChannels.length > 0
      ? subChannels[0].id
      : null;

  if (preferredSubId !== null) {
    return `/channels/${preferredSubId}`;
  }

  return `/channels/${channel.id}?tab=messenger`;
}

export type QaThreadStatusFilter = 'all' | 'unresolved' | 'resolved';

/**
 * Resolved: thread.is_resolved === true (which includes is_pinned_faq === true threads).
 */
export function isThreadResolved(thread: QaThread): boolean {
  return Boolean(thread.is_resolved || thread.is_pinned_faq);
}

/**
 * Unresolved: thread.is_resolved === false (and not a pinned FAQ).
 * A reply alone does NOT change status unless the thread is resolved.
 */
export function isThreadUnresolved(thread: QaThread): boolean {
  return !isThreadResolved(thread);
}

/**
 * Returns the canonical status badge label for Isolated Q&A cards and filter bar.
 */
export function getThreadStatusLabel(thread: QaThread): 'RESOLVED' | 'UNRESOLVED' {
  return isThreadResolved(thread) ? 'RESOLVED' : 'UNRESOLVED';
}

/**
 * Unread: thread (or a reply on it) from someone other than the current user,
 * updated/created strictly after the user's previous last_seen_at for that hub.
 */
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

/**
 * Computes All / Unresolved / Resolved / Unread counts strictly across threads visible to `user`
 * (reusing `isThreadVisibleToUser` so students never see other students' private threads or their unread counts).
 */
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

/**
 * Filters Q&A threads by visibility (`isThreadVisibleToUser`), status (`all` | `unresolved` | `resolved`),
 * and optional `unreadOnly` toggle.
 */
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

/**
 * Formats an unread/open Q&A badge count using tabular-friendly text (`99+` when > 99).
 */
export function formatUnreadBadgeCount(count: number | undefined): string {
  if (typeof count !== 'number' || Number.isNaN(count) || count <= 0) {
    return '0';
  }
  if (count > 99) {
    return '99+';
  }
  return String(Math.floor(count));
}

/**
 * Returns sorted unique IDs of all top-level Course Hubs that the user is approved in or administers,
 * used to subscribe to `clarify.channel.{id}` for every approved hub the user belongs to.
 */
export function getSubscribableCourseHubIds(
  channels: Channel[],
  user: User | undefined
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

/**
 * Pure helper that patches `channels` locally on `thread.*` realtime events:
 * - `+1` on `thread.created` if `isThreadVisibleToUser` and actor is not the current user
 * - `-1` on resolve (`thread.replied`/`thread.updated` with `is_resolved: true`, or `thread.faq_pinned`)
 *   and on `thread.deleted` (when the thread was unresolved and visible to the user), clamped `>= 0`
 * - Also increments `has_updates`, `new_activity_count`, and `new_activity_breakdown.qa` when the hub
 *   is not currently viewed and the actor is not the current user.
 */
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

/**
 * Guards against an in-flight channel list refetch (started before a realtime event)
 * overwriting a newer local realtime patch on `unread_count` or unseen activity counters.
 */
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



