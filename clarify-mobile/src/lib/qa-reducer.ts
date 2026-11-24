import type { ApiError, Channel, QaThread } from '../types/api.ts';

export interface CourseQaState {
  channelId: number;
  threads: QaThread[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  hasLoadedOnce: boolean;
}

export type CourseQaAction =
  | { type: 'RESET_FOR_CHANNEL'; channelId: number }
  | { type: 'LOAD_START' }
  | { type: 'REFRESH_START' }
  | { type: 'LOAD_SUCCESS'; channelId: number; threads: QaThread[] }
  | { type: 'LOAD_ERROR'; error: ApiError }
  | { type: 'UPSERT_THREAD'; thread: QaThread }
  | { type: 'REMOVE_THREAD'; threadId: number };

export function createInitialCourseQaState(channelId: number): CourseQaState {
  return {
    channelId,
    threads: [],
    isLoading: channelId > 0,
    isRefreshing: false,
    error: null,
    hasLoadedOnce: false,
  };
}

/**
 * Enforces the non-negotiable FAQ privacy boundary:
 * Whenever `is_pinned_faq === true`, the UI must strictly display "Anonymous Student"
 * with a masked avatar and NEVER retain or display `sender_id` or the student's real name.
 */
export function sanitizeThreadForPrivacy(thread: QaThread): QaThread {
  if (!thread.is_pinned_faq) {
    return {
      ...thread,
      replies: Array.isArray(thread.replies) ? thread.replies : [],
    };
  }

  return {
    ...thread,
    is_private: false,
    author: {
      id: null,
      name: 'Anonymous Student',
      role: 'student',
      avatar_url: null,
    },
    replies: Array.isArray(thread.replies) ? thread.replies : [],
  };
}

function compareThreadsNewestFirst(a: QaThread, b: QaThread): number {
  const aTime = Date.parse(a.created_at);
  const bTime = Date.parse(b.created_at);
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  return Number(b.id) - Number(a.id);
}

export function mergeAndDedupeThreads(threads: QaThread[]): QaThread[] {
  const byId = new Map<number, QaThread>();
  for (const raw of threads) {
    const numericId = Number(raw.id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      continue;
    }
    byId.set(numericId, sanitizeThreadForPrivacy(raw));
  }
  return Array.from(byId.values()).sort(compareThreadsNewestFirst);
}

export function upsertThreadInList(
  existing: QaThread[],
  incoming: QaThread
): QaThread[] {
  const sanitized = sanitizeThreadForPrivacy(incoming);
  const numericId = Number(sanitized.id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return existing;
  }

  const next = existing.filter((t) => Number(t.id) !== numericId);
  next.push(sanitized);
  return next.sort(compareThreadsNewestFirst);
}

export function removeThreadFromList(
  existing: QaThread[],
  threadId: number
): QaThread[] {
  const numericId = Number(threadId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return existing;
  }
  return existing.filter((t) => Number(t.id) !== numericId);
}

export function courseQaReducer(
  state: CourseQaState,
  action: CourseQaAction
): CourseQaState {
  switch (action.type) {
    case 'RESET_FOR_CHANNEL':
      return createInitialCourseQaState(action.channelId);

    case 'LOAD_START':
      return {
        ...state,
        isLoading: !state.hasLoadedOnce,
        error: null,
      };

    case 'REFRESH_START':
      return {
        ...state,
        isRefreshing: true,
        error: null,
      };

    case 'LOAD_SUCCESS':
      if (action.channelId !== state.channelId) {
        return state;
      }
      return {
        ...state,
        threads: mergeAndDedupeThreads(action.threads),
        isLoading: false,
        isRefreshing: false,
        error: null,
        hasLoadedOnce: true,
      };

    case 'LOAD_ERROR':
      return {
        ...state,
        isLoading: false,
        isRefreshing: false,
        error: action.error,
      };

    case 'UPSERT_THREAD':
      if (
        action.thread.channel_id &&
        Number(action.thread.channel_id) !== state.channelId
      ) {
        return state;
      }
      return {
        ...state,
        threads: upsertThreadInList(state.threads, action.thread),
        error: null,
      };

    case 'REMOVE_THREAD':
      return {
        ...state,
        threads: removeThreadFromList(state.threads, action.threadId),
      };

    default:
      return state;
  }
}

/**
 * Resolves the unique list of real chat sub-channels for a Course Hub without
 * ever creating a synthetic "# general" entry or falling back to the parent hub.
 *
 * Parity with clarify-web/app/channels/[channelId]/page.tsx:
 * - When a Course Hub has real sub-channels (e.g. #general, #media), chat channels are
 *   strictly those real sub-channels (defaulting to #general if present, else the first).
 * - When a Course Hub has zero real sub-channels, returns `{ chatChannels: [], defaultChatChannel: undefined }`.
 */
export function resolveHubChatChannels(
  activeHub: Channel | undefined,
  subChannels: Channel[]
): {
  chatChannels: Channel[];
  defaultChatChannel: Channel | undefined;
} {
  if (!activeHub) {
    return { chatChannels: [], defaultChatChannel: undefined };
  }

  const hubId = Number(activeHub.id);
  const seenIds = new Set<number>();
  const uniqueSubs: Channel[] = [];
  for (const sub of subChannels) {
    const id = Number(sub.id);
    if (!Number.isFinite(id) || id <= 0 || id === hubId || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    uniqueSubs.push(sub);
  }

  if (uniqueSubs.length > 0) {
    const generalSub = uniqueSubs.find(
      (sub) => sub.name.replace(/^#\s*/, '').trim().toLowerCase() === 'general'
    );
    return {
      chatChannels: uniqueSubs,
      defaultChatChannel: generalSub ?? uniqueSubs[0],
    };
  }

  return {
    chatChannels: [],
    defaultChatChannel: undefined,
  };
}

/**
 * Resolves the active chat sub-channel for a Course Hub, sanitizing stale or invalid
 * IDs (including a stale ID equal to `activeHub.id` or a deleted sub-channel) by
 * resetting to `defaultChatChannel` or `undefined` when no sub-channels exist.
 */
export function resolveActiveChatChannelId(
  activeHub: Channel | undefined,
  subChannels: Channel[],
  candidateChatChannelId?: number | null
): {
  chatChannels: Channel[];
  defaultChatChannel: Channel | undefined;
  activeChatChannel: Channel | undefined;
  activeChatChannelId: number | undefined;
} {
  const { chatChannels, defaultChatChannel } = resolveHubChatChannels(
    activeHub,
    subChannels
  );

  if (!activeHub || chatChannels.length === 0) {
    return {
      chatChannels,
      defaultChatChannel: undefined,
      activeChatChannel: undefined,
      activeChatChannelId: undefined,
    };
  }

  const hubId = Number(activeHub.id);
  if (
    typeof candidateChatChannelId === 'number' &&
    Number.isFinite(candidateChatChannelId) &&
    candidateChatChannelId > 0 &&
    candidateChatChannelId !== hubId
  ) {
    const matched = chatChannels.find(
      (c) => Number(c.id) === candidateChatChannelId
    );
    if (matched) {
      return {
        chatChannels,
        defaultChatChannel,
        activeChatChannel: matched,
        activeChatChannelId: matched.id,
      };
    }
  }

  return {
    chatChannels,
    defaultChatChannel,
    activeChatChannel: defaultChatChannel,
    activeChatChannelId: defaultChatChannel?.id,
  };
}

/**
 * Extracts published Class FAQs from a Course Hub's thread list and enforces
 * strict "Anonymous Student" masking (never retains sender_id, real name, or avatar).
 */
export function extractPublishedFaqs(threads: QaThread[]): QaThread[] {
  return mergeAndDedupeThreads(threads.filter((t) => Boolean(t.is_pinned_faq)));
}

/**
 * Formats a Course Hub display name for POST/PATCH /channels without duplicating
 * the course_code prefix (matches clarify-web ChannelRosterModal).
 */
export function formatCourseHubSubmitName(
  courseCode: string,
  hubName: string
): string {
  const cleanCode = courseCode.trim().toUpperCase();
  const cleanTitle = hubName.replace(/^#\s*/, '').trim();
  if (!cleanTitle) {
    return cleanCode;
  }
  if (
    cleanCode &&
    !cleanTitle.toLowerCase().startsWith(cleanCode.toLowerCase())
  ) {
    return `${cleanCode} ${cleanTitle}`;
  }
  return cleanTitle;
}

/**
 * Normalizes a sub-channel name into a lowercase hyphenated slug without a leading '#'.
 * Matches clarify-web ChannelRosterModal.handleCreateSubChannel.
 */
export function normalizeSubChannelSlug(rawName: string): string {
  return rawName
    .replace(/^#\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/**
 * Removes a handled pending join request from a channel roster snapshot
 * (used on approval, rejection, and HTTP 409 already-handled recovery).
 */
export function removePendingRequestFromChannel(
  channel: Channel,
  institutionalId: string
): Channel {
  const normalizedTarget = institutionalId.trim().toLowerCase();
  const filteredPending = (channel.pending_requests || []).filter(
    (req) => req.institutional_id.trim().toLowerCase() !== normalizedTarget
  );
  return {
    ...channel,
    pending_requests: filteredPending,
  };
}

