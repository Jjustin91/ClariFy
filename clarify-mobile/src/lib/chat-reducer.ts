import type { ApiError, ChatMessage, User } from '../types/api.ts';

export interface CourseChatState {
  channelId: number;
  /** Stored chronologically (oldest -> newest) matching GET /channels/{id}/messages. */
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: number | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingOlder: boolean;
  error: ApiError | null;
  failedErrorByTempId: Record<string, string>;
  unsendingIds: number[];
}

export function createInitialCourseChatState(channelId = 0): CourseChatState {
  return {
    channelId,
    messages: [],
    hasMore: false,
    nextBefore: null,
    isLoading: channelId > 0,
    isRefreshing: false,
    isLoadingOlder: false,
    error: null,
    failedErrorByTempId: {},
    unsendingIds: [],
  };
}

export type CourseChatAction =
  | { type: 'RESET'; channelId: number }
  | { type: 'LOAD_START' }
  | { type: 'REFRESH_START' }
  | { type: 'LOAD_OLDER_START' }
  | {
      type: 'LOAD_SUCCESS';
      messages: ChatMessage[];
      hasMore: boolean;
      nextBefore: number | null;
    }
  | {
      type: 'LOAD_OLDER_SUCCESS';
      messages: ChatMessage[];
      hasMore: boolean;
      nextBefore: number | null;
    }
  | { type: 'LOAD_ERROR'; error: ApiError }
  | { type: 'LOAD_OLDER_ERROR'; error: ApiError }
  | { type: 'OPTIMISTIC_ADD'; message: ChatMessage }
  | { type: 'SEND_SUCCESS'; tempId: string; message: ChatMessage }
  | { type: 'SEND_FAILED'; tempId: string; errorMessage: string }
  | { type: 'RETRY_START'; tempId: string }
  | { type: 'DISMISS_FAILED'; tempId: string }
  | { type: 'REALTIME_MESSAGE'; message: ChatMessage }
  | { type: 'UNSEND_START'; messageId: number }
  | { type: 'UNSEND_ERROR'; messageId: number }
  | { type: 'MARK_UNSENT'; messageId: number; serverMessage?: ChatMessage };

function getNumericId(id: number | string | undefined | null): number | null {
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
    return id;
  }
  if (typeof id === 'string' && /^\d+$/.test(id.trim())) {
    const parsed = Number(id.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function getMessageSortTimestamp(msg: ChatMessage): number {
  const parsed = Date.parse(msg.created_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortChronological(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const aNum = getNumericId(a.id);
    const bNum = getNumericId(b.id);
    // Keep pending/failed optimistic messages (non-numeric id) after confirmed server messages
    if (aNum !== null && bNum === null) return -1;
    if (aNum === null && bNum !== null) return 1;
    if (aNum !== null && bNum !== null && aNum !== bNum) {
      return aNum - bNum;
    }
    return getMessageSortTimestamp(a) - getMessageSortTimestamp(b);
  });
}

/**
 * Deduplicates chat messages by numeric server `id` and `temp_id`, preserving chronological order.
 * Newer records overwrite older duplicates for the same key so server state wins over optimistic placeholders.
 */
export function mergeAndDedupeChatMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const byNumericId = new Map<number, ChatMessage>();
  const byTempId = new Map<string, ChatMessage>();

  const upsert = (msg: ChatMessage) => {
    const numId = getNumericId(msg.id);
    const tempId = typeof msg.temp_id === 'string' && msg.temp_id.trim() ? msg.temp_id.trim() : null;

    if (numId !== null) {
      if (tempId) {
        byTempId.delete(tempId);
      }
      const prev = byNumericId.get(numId);
      // Never downgrade an already-unsent message back to non-unsent
      const isUnsent = Boolean(prev?.is_unsent || msg.is_unsent);
      byNumericId.set(numId, {
        ...prev,
        ...msg,
        id: numId,
        is_unsent: isUnsent,
        content: isUnsent ? '' : msg.content,
        attachment: isUnsent ? null : (msg.attachment ?? null),
        status: 'sent',
      });
      return;
    }

    const fallbackTempKey = tempId || String(msg.id);
    // If a confirmed message already reconciled this temp_id, ignore the stale optimistic entry
    for (const confirmed of byNumericId.values()) {
      if (confirmed.temp_id && confirmed.temp_id === fallbackTempKey) {
        return;
      }
    }
    byTempId.set(fallbackTempKey, msg);
  };

  for (const item of existing) {
    upsert(item);
  }
  for (const item of incoming) {
    upsert(item);
  }

  return sortChronological([
    ...Array.from(byNumericId.values()),
    ...Array.from(byTempId.values()),
  ]);
}

/**
 * Reverses chronological messages (`oldest -> newest`) into inverted FlatList order (`newest -> oldest`)
 * so index 0 renders at the bottom of the chat viewport.
 */
export function toInvertedChatList(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].reverse();
}

/**
 * Determines whether the current user is permitted to unsend a chat message (UX guard; server enforces ChannelPolicy::unsendMessage).
 * Only the original sender of a confirmed, non-unsent message may unsend it.
 */
export function canUnsendChatMessage(
  message: ChatMessage,
  currentUser: User | null | undefined
): boolean {
  if (!currentUser || !currentUser.id) {
    return false;
  }
  if (message.is_unsent) {
    return false;
  }
  if (message.status === 'sending' || message.status === 'failed') {
    return false;
  }
  if (getNumericId(message.id) === null) {
    return false;
  }
  const authorId = Number(message.author?.id ?? message.sender_id ?? 0);
  return authorId > 0 && authorId === Number(currentUser.id);
}

/**
 * Matches clarify-web MessengerChatBox role classification for avatar styling and Faculty/Student badge.
 */
export function isFacultyChatRole(role: string | undefined | null): boolean {
  return role === 'faculty' || role === 'dept_head' || role === 'it_admin';
}

/**
 * Extracts a clean 1-character fallback initial for chat avatars, stripping honorific prefixes
 * (`ENGR.`, `PROF.`, `DR.`) matching clarify-web MessengerChatBox.
 */
export function getChatSenderInitial(
  name: string | undefined | null,
  role: string | undefined | null
): string {
  const cleaned = (name || '')
    .trim()
    .replace(/^(ENGR\.|PROF\.|DR\.)\s*/i, '')
    .trim();
  if (cleaned.length > 0) {
    return cleaned.charAt(0).toUpperCase();
  }
  return isFacultyChatRole(role) ? 'F' : 'S';
}

export interface ChatMessageActionCapabilities {
  canCopy: boolean;
  canUnsend: boolean;
  canOpenMenu: boolean;
}

/**
 * Determines which Messenger-style long-press actions are available for a given chat bubble.
 */
export function getChatMessageActionCapabilities(
  message: ChatMessage,
  currentUser: User | null | undefined
): ChatMessageActionCapabilities {
  const canCopy = !message.is_unsent && message.content.trim().length > 0;
  const canUnsend = canUnsendChatMessage(message, currentUser);
  return {
    canCopy,
    canUnsend,
    canOpenMenu: canCopy || canUnsend,
  };
}

/**
 * Pure reducer managing Course Hub cursor-paginated chat, optimistic send/retry,
 * real-time Reverb message reconciliation & deduplication, and unsend state.
 */
export function courseChatReducer(
  state: CourseChatState,
  action: CourseChatAction
): CourseChatState {
  switch (action.type) {
    case 'RESET':
      return createInitialCourseChatState(action.channelId);

    case 'LOAD_START':
      return {
        ...state,
        isLoading: true,
        isRefreshing: false,
        isLoadingOlder: false,
        error: null,
      };

    case 'REFRESH_START':
      return {
        ...state,
        isRefreshing: true,
        error: null,
      };

    case 'LOAD_OLDER_START':
      return {
        ...state,
        isLoadingOlder: true,
        error: null,
      };

    case 'LOAD_SUCCESS': {
      // Preserve any locally pending/failed optimistic messages while refreshing server page
      const pendingOptimistic = state.messages.filter(
        (m) =>
          getNumericId(m.id) === null &&
          (m.status === 'sending' || m.status === 'failed')
      );
      const merged = mergeAndDedupeChatMessages(
        pendingOptimistic,
        action.messages
      );

      // Compute oldest numeric cursor if preserving already-loaded older history
      const existingOlderCount = state.messages.filter(
        (m) => getNumericId(m.id) !== null
      ).length;
      const shouldPreserveOlderPages =
        state.isRefreshing &&
        existingOlderCount > action.messages.length &&
        state.messages.length > 0;

      const finalMessages = shouldPreserveOlderPages
        ? mergeAndDedupeChatMessages(state.messages, action.messages)
        : merged;

      return {
        ...state,
        messages: finalMessages,
        hasMore: shouldPreserveOlderPages ? state.hasMore : action.hasMore,
        nextBefore: shouldPreserveOlderPages
          ? state.nextBefore
          : action.nextBefore,
        isLoading: false,
        isRefreshing: false,
        isLoadingOlder: false,
        error: null,
      };
    }

    case 'LOAD_OLDER_SUCCESS': {
      const merged = mergeAndDedupeChatMessages(action.messages, state.messages);
      return {
        ...state,
        messages: merged,
        hasMore: action.hasMore,
        nextBefore: action.nextBefore,
        isLoadingOlder: false,
        error: null,
      };
    }

    case 'LOAD_ERROR':
      return {
        ...state,
        isLoading: false,
        isRefreshing: false,
        isLoadingOlder: false,
        error: action.error,
      };

    case 'LOAD_OLDER_ERROR':
      return {
        ...state,
        isLoadingOlder: false,
        error: action.error,
      };

    case 'OPTIMISTIC_ADD': {
      const tempKey = action.message.temp_id || String(action.message.id);
      const nextFailed = { ...state.failedErrorByTempId };
      delete nextFailed[tempKey];
      return {
        ...state,
        messages: mergeAndDedupeChatMessages(state.messages, [
          {
            ...action.message,
            temp_id: tempKey,
            status: 'sending',
          },
        ]),
        failedErrorByTempId: nextFailed,
      };
    }

    case 'SEND_SUCCESS': {
      const normalizedServer: ChatMessage = {
        ...action.message,
        temp_id: action.message.temp_id ?? action.tempId,
        status: 'sent',
      };
      // Remove any optimistic copy matching tempId before merging confirmed server message
      const withoutTemp = state.messages.filter(
        (m) =>
          m.temp_id !== action.tempId && String(m.id) !== String(action.tempId)
      );
      const nextFailed = { ...state.failedErrorByTempId };
      delete nextFailed[action.tempId];
      return {
        ...state,
        messages: mergeAndDedupeChatMessages(withoutTemp, [normalizedServer]),
        failedErrorByTempId: nextFailed,
      };
    }

    case 'SEND_FAILED':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.temp_id === action.tempId || String(m.id) === action.tempId
            ? { ...m, status: 'failed' as const }
            : m
        ),
        failedErrorByTempId: {
          ...state.failedErrorByTempId,
          [action.tempId]: action.errorMessage,
        },
      };

    case 'RETRY_START': {
      const nextFailed = { ...state.failedErrorByTempId };
      delete nextFailed[action.tempId];
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.temp_id === action.tempId || String(m.id) === action.tempId
            ? { ...m, status: 'sending' as const }
            : m
        ),
        failedErrorByTempId: nextFailed,
      };
    }

    case 'DISMISS_FAILED': {
      const nextFailed = { ...state.failedErrorByTempId };
      delete nextFailed[action.tempId];
      return {
        ...state,
        messages: state.messages.filter(
          (m) => m.temp_id !== action.tempId && String(m.id) !== action.tempId
        ),
        failedErrorByTempId: nextFailed,
      };
    }

    case 'REALTIME_MESSAGE': {
      const incoming = action.message;
      const incomingTempId =
        typeof incoming.temp_id === 'string' && incoming.temp_id.trim()
          ? incoming.temp_id.trim()
          : null;
      const nextFailed = { ...state.failedErrorByTempId };
      if (incomingTempId) {
        delete nextFailed[incomingTempId];
      }
      const withoutMatchingTemp = incomingTempId
        ? state.messages.filter(
            (m) => m.temp_id !== incomingTempId && String(m.id) !== incomingTempId
          )
        : state.messages;

      return {
        ...state,
        messages: mergeAndDedupeChatMessages(withoutMatchingTemp, [
          { ...incoming, status: 'sent' },
        ]),
        failedErrorByTempId: nextFailed,
      };
    }

    case 'UNSEND_START':
      if (state.unsendingIds.includes(action.messageId)) {
        return state;
      }
      return {
        ...state,
        unsendingIds: [...state.unsendingIds, action.messageId],
      };

    case 'UNSEND_ERROR':
      return {
        ...state,
        unsendingIds: state.unsendingIds.filter(
          (id) => id !== action.messageId
        ),
      };

    case 'MARK_UNSENT': {
      const targetId = Number(action.messageId);
      const nextMessages = state.messages.map((m) => {
        if (getNumericId(m.id) !== targetId) {
          return m;
        }
        return {
          ...m,
          ...(action.serverMessage ?? {}),
          id: targetId,
          is_unsent: true,
          content: '',
          attachment: null,
          status: 'sent' as const,
        };
      });
      return {
        ...state,
        messages: nextMessages,
        unsendingIds: state.unsendingIds.filter((id) => id !== targetId),
      };
    }

    default:
      return state;
  }
}
