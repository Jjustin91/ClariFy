import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Image,
  Keyboard,
  type KeyboardEvent,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import {
  getChannelChatMessagesApi,
  resolveApiAssetUrl,
  sendChannelChatMessageApi,
  unsendChannelChatMessageApi,
} from '../lib/api-client';
import {
  courseChatReducer,
  createInitialCourseChatState,
  getChatMessageActionCapabilities,
  getChatSenderInitial,
  isFacultyChatRole,
  toInvertedChatList,
} from '../lib/chat-reducer';
import { getUnsentMessagePlaceholder } from '../lib/domain-logic';
import { computeDebouncedRefreshDelayMs } from '../lib/realtime-reducer';
import {
  subscribeChannelReverb,
  type ReverbBroadcastPayload,
} from '../lib/reverb-client';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError, ChatMessage, ChatSeenByUser } from '../types/api';
import { EmptyState, ErrorBanner } from './StateViews';

const CHAT_PAGE_LIMIT = 50;

function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ChatSenderAvatar({
  name,
  role,
  avatarUrl,
  size = 'md',
  accessibilityLabel,
}: {
  name: string;
  role: string;
  avatarUrl?: string | null;
  size?: 'md' | 'xs';
  accessibilityLabel?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const isFaculty = isFacultyChatRole(role);
  const initial = getChatSenderInitial(name, role);
  const normalizedUrl = resolveApiAssetUrl(avatarUrl);
  const showImage = Boolean(normalizedUrl && failedUrl !== normalizedUrl);

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[
        size === 'xs' ? styles.avatarXs : styles.avatarMd,
        isFaculty ? styles.avatarFaculty : styles.avatarStudent,
      ]}
    >
      {showImage && normalizedUrl ? (
        <Image
          source={{ uri: normalizedUrl }}
          onError={() => setFailedUrl(normalizedUrl)}
          style={styles.avatarImage}
        />
      ) : (
        <Text
          style={[
            size === 'xs' ? styles.avatarInitialXs : styles.avatarInitialMd,
            isFaculty
              ? styles.avatarInitialFaculty
              : styles.avatarInitialStudent,
          ]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

function SeenByAvatarsRow({
  readers,
  alignRight,
}: {
  readers: ChatSeenByUser[];
  alignRight: boolean;
}) {
  if (readers.length === 0) return null;
  const visibleReaders = readers.slice(0, 4);
  const overflowCount = Math.max(0, readers.length - visibleReaders.length);
  const namesSummary = visibleReaders.map((r) => r.name).join(', ');

  return (
    <View
      accessible
      accessibilityLabel={`Seen by ${namesSummary}${overflowCount > 0 ? ` and ${overflowCount} more` : ''}`}
      style={[
        styles.seenByRow,
        alignRight ? styles.seenByRowRight : styles.seenByRowLeft,
      ]}
    >
      <Text style={styles.seenByText}>Seen</Text>
      <View style={styles.seenByAvatarsStack}>
        {visibleReaders.map((reader) => (
          <ChatSenderAvatar
            key={`seen-${reader.id}`}
            name={reader.name}
            role={reader.role}
            avatarUrl={reader.avatar_url}
            size="xs"
          />
        ))}
        {overflowCount > 0 && (
          <View style={styles.seenOverflowBadge}>
            <Text style={styles.seenOverflowText}>+{overflowCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ChatSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading course chat messages"
      style={styles.skeletonWrap}
    >
      {[false, true, false, true, false].map((isOwn, idx) => (
        <View
          key={`chat-skel-${idx}`}
          style={[
            styles.skeletonRow,
            isOwn ? styles.skeletonRowOwn : styles.skeletonRowOther,
          ]}
        >
          {!isOwn && <View style={styles.skeletonAvatar} />}
          <View
            style={[
              styles.skeletonBubble,
              isOwn ? styles.skeletonBubbleOwn : styles.skeletonBubbleOther,
            ]}
          >
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineShort} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface CourseHubChatViewProps {
  channelId: number;
  channelTitle: string;
  isFocused: boolean;
}

/**
 * Course Hub Messenger Chat view (`subject_hashtag = '__CHAT__'`).
 * - Cursor pagination (`before`, `limit=50`, `meta.has_more`, `meta.next_before`) with inverted FlatList
 * - Overlap-measured Android keyboard avoidance + iOS KeyboardAvoidingView so composer is never blocked
 * - Sender circular avatars, Faculty/Student role badges, and web-parity Sent/Seen indicators
 * - Messenger-style long-press action menu (Copy Message & Unsend Message) + confirmation modal
 * - Private Reverb subscription `clarify.channel.{id}` active only while focused & AppState === 'active'
 */
export function CourseHubChatView({
  channelId,
  channelTitle,
  isFocused,
}: CourseHubChatViewProps) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const [state, dispatch] = useReducer(
    courseChatReducer,
    channelId,
    createInitialCourseChatState
  );

  const [draft, setDraft] = useState('');
  const [actionMenuTarget, setActionMenuTarget] = useState<ChatMessage | null>(
    null
  );
  const [unsendTarget, setUnsendTarget] = useState<ChatMessage | null>(null);
  const [appActiveEpoch, setAppActiveEpoch] = useState(0);
  const [androidKeyboardOverlap, setAndroidKeyboardOverlap] = useState(0);
  const [iosKeyboardOffset, setIosKeyboardOffset] = useState(96);

  const rootRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const keyboardTopYRef = useRef<number | null>(null);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const latestFetchInFlightRef = useRef<Promise<void> | null>(null);
  const olderFetchInFlightRef = useRef<Promise<void> | null>(null);
  const debouncedSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const activeChannelRef = useRef<number>(channelId);

  useEffect(() => {
    activeChannelRef.current = channelId;
  }, [channelId]);

  const recalculateKeyboardBounds = useCallback(() => {
    if (!rootRef.current) return;
    rootRef.current.measureInWindow((_x, y, _width, height) => {
      if (height <= 0) return;
      if (Platform.OS === 'ios') {
        if (y > 0) {
          setIosKeyboardOffset(Math.round(y));
        }
        return;
      }
      if (Platform.OS === 'android') {
        const keyboardTopY = keyboardTopYRef.current;
        if (keyboardTopY === null) {
          setAndroidKeyboardOverlap(0);
          return;
        }
        const rootBottomY = y + height;
        const overlap = Math.max(0, Math.round(rootBottomY - keyboardTopY));
        setAndroidKeyboardOverlap(overlap);
      }
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const showSub = Keyboard.addListener(
      'keyboardDidShow',
      (event: KeyboardEvent) => {
        keyboardTopYRef.current = event.endCoordinates.screenY;
        recalculateKeyboardBounds();
      }
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopYRef.current = null;
      setAndroidKeyboardOverlap(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [recalculateKeyboardBounds]);

  const clearDebouncedSyncTimer = useCallback(() => {
    if (debouncedSyncTimerRef.current) {
      clearTimeout(debouncedSyncTimerRef.current);
      debouncedSyncTimerRef.current = null;
    }
  }, []);

  const fetchLatestChat = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (channelId <= 0) return;
      if (mode === 'silent' && !isAppActiveRef.current) return;
      if (latestFetchInFlightRef.current) {
        return latestFetchInFlightRef.current;
      }

      if (mode === 'initial') {
        dispatch({ type: 'LOAD_START' });
      } else if (mode === 'refresh') {
        dispatch({ type: 'REFRESH_START' });
      }

      const targetChannelId = channelId;
      const req = (async () => {
        try {
          const res = await getChannelChatMessagesApi(targetChannelId, {
            limit: CHAT_PAGE_LIMIT,
          });
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          dispatch({
            type: 'LOAD_SUCCESS',
            messages: Array.isArray(res?.data) ? res.data : [],
            hasMore: Boolean(res?.meta?.has_more),
            nextBefore: res?.meta?.next_before ?? null,
          });
        } catch (err) {
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          if (mode !== 'silent') {
            dispatch({ type: 'LOAD_ERROR', error: err as ApiError });
          }
        } finally {
          latestFetchInFlightRef.current = null;
        }
      })();

      latestFetchInFlightRef.current = req;
      return req;
    },
    [channelId]
  );

  const scheduleDebouncedChatSync = useCallback(() => {
    if (!isAppActiveRef.current || !isFocused || channelId <= 0) {
      return;
    }
    if (debouncedSyncTimerRef.current) {
      return;
    }
    const delayMs = computeDebouncedRefreshDelayMs();
    debouncedSyncTimerRef.current = setTimeout(() => {
      debouncedSyncTimerRef.current = null;
      if (!isAppActiveRef.current || !isFocused) {
        return;
      }
      void fetchLatestChat('silent');
    }, delayMs);
  }, [channelId, isFocused, fetchLatestChat]);

  const handleLoadOlder = useCallback(async () => {
    if (
      channelId <= 0 ||
      !state.hasMore ||
      !state.nextBefore ||
      state.isLoading ||
      state.isLoadingOlder ||
      olderFetchInFlightRef.current
    ) {
      return;
    }

    dispatch({ type: 'LOAD_OLDER_START' });
    const targetChannelId = channelId;
    const cursorBefore = state.nextBefore;

    const req = (async () => {
      try {
        const res = await getChannelChatMessagesApi(targetChannelId, {
          before: cursorBefore,
          limit: CHAT_PAGE_LIMIT,
        });
        if (activeChannelRef.current !== targetChannelId) {
          return;
        }
        dispatch({
          type: 'LOAD_OLDER_SUCCESS',
          messages: Array.isArray(res?.data) ? res.data : [],
          hasMore: Boolean(res?.meta?.has_more),
          nextBefore: res?.meta?.next_before ?? null,
        });
      } catch (err) {
        if (activeChannelRef.current !== targetChannelId) {
          return;
        }
        dispatch({ type: 'LOAD_OLDER_ERROR', error: err as ApiError });
      } finally {
        olderFetchInFlightRef.current = null;
      }
    })();

    olderFetchInFlightRef.current = req;
    return req;
  }, [
    channelId,
    state.hasMore,
    state.nextBefore,
    state.isLoading,
    state.isLoadingOlder,
  ]);

  // Reset & initial load when channelId changes
  useEffect(() => {
    clearDebouncedSyncTimer();
    latestFetchInFlightRef.current = null;
    olderFetchInFlightRef.current = null;
    dispatch({ type: 'RESET', channelId });
    if (channelId > 0) {
      void fetchLatestChat('initial');
    }
  }, [channelId, clearDebouncedSyncTimer, fetchLatestChat]);

  // Pause background refetches when AppState leaves 'active'; run one catch-up fetch on return while focused
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const nextIsActive = nextState === 'active';
        const wasActive = isAppActiveRef.current;
        isAppActiveRef.current = nextIsActive;

        if (!nextIsActive) {
          clearDebouncedSyncTimer();
          return;
        }

        if (!wasActive && nextIsActive && isFocused && channelId > 0) {
          setAppActiveEpoch((n) => n + 1);
          void fetchLatestChat('silent');
        }
      }
    );
    return () => {
      sub.remove();
    };
  }, [channelId, isFocused, clearDebouncedSyncTimer, fetchLatestChat]);

  // Subscribe to private `clarify.channel.{channelId}` ONLY while screen is focused and app is active
  useEffect(() => {
    if (!isFocused || channelId <= 0 || !isAppActiveRef.current) {
      clearDebouncedSyncTimer();
      return;
    }

    const unsubscribe = subscribeChannelReverb(
      channelId,
      (payload: ReverbBroadcastPayload) => {
        if (
          payload.channel_id &&
          Number(payload.channel_id) !== Number(channelId)
        ) {
          return;
        }

        if (payload.type === 'chat.message') {
          if (payload.message && payload.message.id) {
            dispatch({
              type: 'REALTIME_MESSAGE',
              message: payload.message,
            });
          } else {
            scheduleDebouncedChatSync();
          }
          return;
        }

        if (payload.type === 'chat.message_unsent') {
          const targetMsgId = Number(
            payload.message_id ?? payload.message?.id ?? 0
          );
          if (targetMsgId > 0) {
            dispatch({
              type: 'MARK_UNSENT',
              messageId: targetMsgId,
            });
          } else {
            scheduleDebouncedChatSync();
          }
        }
      }
    );

    return () => {
      clearDebouncedSyncTimer();
      unsubscribe();
    };
  }, [
    channelId,
    isFocused,
    appActiveEpoch,
    clearDebouncedSyncTimer,
    scheduleDebouncedChatSync,
  ]);

  const dispatchSendRequest = useCallback(
    async (text: string, tempId: string) => {
      try {
        const res = await sendChannelChatMessageApi(channelId, text, tempId);
        if (activeChannelRef.current !== channelId) {
          return;
        }
        if (res?.data) {
          dispatch({
            type: 'SEND_SUCCESS',
            tempId,
            message: res.data,
          });
        }
      } catch (err) {
        if (activeChannelRef.current !== channelId) {
          return;
        }
        const apiErr = err as ApiError;
        dispatch({
          type: 'SEND_FAILED',
          tempId,
          errorMessage:
            apiErr?.message ||
            'Unable to send message. Tap Retry to try again.',
        });
      }
    },
    [channelId]
  );

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || !user || channelId <= 0) {
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      temp_id: tempId,
      channel_id: channelId,
      sender_id: user.id,
      is_unsent: false,
      content: trimmed,
      attachment: null,
      created_at: new Date().toISOString(),
      status: 'sending',
      author: {
        id: user.id,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url ?? null,
      },
    };

    setDraft('');
    dispatch({ type: 'OPTIMISTIC_ADD', message: optimistic });
    void dispatchSendRequest(trimmed, tempId);
  }, [draft, user, channelId, dispatchSendRequest]);

  const handleRetryFailed = useCallback(
    (msg: ChatMessage) => {
      const tempId = msg.temp_id || String(msg.id);
      if (!tempId || !msg.content.trim()) return;
      dispatch({ type: 'RETRY_START', tempId });
      void dispatchSendRequest(msg.content, tempId);
    },
    [dispatchSendRequest]
  );

  const handleCopyActionMessage = useCallback(async () => {
    if (!actionMenuTarget) return;
    const textToCopy = actionMenuTarget.content.trim();
    setActionMenuTarget(null);
    if (!textToCopy) return;
    try {
      await Clipboard.setStringAsync(textToCopy);
      showToast('Message copied to clipboard.', 'info');
    } catch {
      showToast('Unable to copy message.', 'error');
    }
  }, [actionMenuTarget, showToast]);

  const handleRequestUnsendFromMenu = useCallback(() => {
    if (!actionMenuTarget) return;
    const target = actionMenuTarget;
    setActionMenuTarget(null);
    setUnsendTarget(target);
  }, [actionMenuTarget]);

  const handleConfirmUnsend = useCallback(async () => {
    if (!unsendTarget) return;
    const targetId = Number(unsendTarget.id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      setUnsendTarget(null);
      return;
    }

    setUnsendTarget(null);
    dispatch({ type: 'UNSEND_START', messageId: targetId });

    try {
      const res = await unsendChannelChatMessageApi(channelId, targetId);
      dispatch({
        type: 'MARK_UNSENT',
        messageId: targetId,
        serverMessage: res?.data,
      });
    } catch (err) {
      const apiErr = err as ApiError;
      dispatch({ type: 'UNSEND_ERROR', messageId: targetId });
      showToast(
        apiErr?.message || 'Unable to unsend this message.',
        'error'
      );
    }
  }, [unsendTarget, channelId, showToast]);

  const invertedMessages = useMemo(
    () => toInvertedChatList(state.messages),
    [state.messages]
  );

  const keyExtractor = useCallback(
    (item: ChatMessage) =>
      String(
        item.temp_id && typeof item.id !== 'number' ? item.temp_id : item.id
      ),
    []
  );

  const renderMessage = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const isLatestMessage = index === 0;
      const isOwn =
        Boolean(user?.id) &&
        Number(item.author?.id ?? item.sender_id ?? 0) === Number(user?.id);
      const isSending = item.status === 'sending';
      const isFailed = item.status === 'failed';
      const tempKey = item.temp_id || String(item.id);
      const failedReason = state.failedErrorByTempId[tempKey];
      const unsentPlaceholder = getUnsentMessagePlaceholder(item, user?.id);
      const capabilities = getChatMessageActionCapabilities(item, user);
      const isUnsending =
        typeof item.id === 'number' && state.unsendingIds.includes(item.id);

      const senderName = item.author?.name || 'Campus Member';
      const senderRole = item.author?.role || 'student';
      const isFacultySender = isFacultyChatRole(senderRole);
      const roleLabel = isFacultySender ? 'Faculty' : 'Student';
      const authorAvatarUrl = isOwn
        ? user?.avatar_url || item.author?.avatar_url
        : item.author?.avatar_url;
      const displayTime = formatChatTime(item.created_at);
      const explicitSeenBy = Array.isArray(item.seen_by) ? item.seen_by : [];

      if (isOwn) {
        return (
          <View style={styles.ownMessageColumn}>
            <Pressable
              onLongPress={
                capabilities.canOpenMenu && !isUnsending
                  ? () => {
                      Keyboard.dismiss();
                      setActionMenuTarget(item);
                    }
                  : undefined
              }
              delayLongPress={280}
              accessibilityRole="button"
              accessibilityLabel={`Your message at ${displayTime}`}
              accessibilityHint={
                capabilities.canOpenMenu
                  ? 'Press and hold for Copy or Unsend options'
                  : undefined
              }
              style={({ pressed }) => [
                styles.bubble,
                styles.bubbleOwn,
                item.is_unsent && styles.bubbleUnsent,
                isFailed && styles.bubbleFailed,
                isSending && styles.bubbleSending,
                pressed && capabilities.canOpenMenu && styles.bubblePressed,
              ]}
            >
              {/* Own Header: You + Time */}
              <View style={styles.bubbleMetaRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.authorName,
                    !item.is_unsent
                      ? styles.authorNameOwn
                      : styles.authorNameOther,
                  ]}
                >
                  You
                </Text>
                <Text
                  style={[
                    styles.timestampText,
                    !item.is_unsent
                      ? styles.timestampOwn
                      : styles.timestampOther,
                  ]}
                >
                  {displayTime}
                </Text>
              </View>

              {/* Body or Unsent Placeholder */}
              {unsentPlaceholder ? (
                <Text style={styles.unsentText}>{unsentPlaceholder}</Text>
              ) : (
                <>
                  {item.content.trim().length > 0 && (
                    <Text style={[styles.messageBody, styles.messageBodyOwn]}>
                      {item.content}
                    </Text>
                  )}

                  {item.attachment && (
                    <View
                      style={[styles.attachmentChip, styles.attachmentChipOwn]}
                    >
                      <Feather
                        name={
                          item.attachment.type === 'image'
                            ? 'image'
                            : item.attachment.type === 'voice'
                              ? 'mic'
                              : 'paperclip'
                        }
                        size={14}
                        color={colors.ustpGold}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.attachmentName,
                          styles.attachmentNameOwn,
                        ]}
                      >
                        {item.attachment.name}
                      </Text>
                    </View>
                  )}
                </>
              )}

              {/* Inline Failed Send Controls */}
              {isFailed && (
                <View style={styles.failedActionsBox}>
                  <Text style={styles.failedErrorText}>
                    {failedReason || 'Failed to send.'}
                  </Text>
                  <View style={styles.failedButtonsRow}>
                    <Pressable
                      onPress={() => handleRetryFailed(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Retry sending message"
                      style={({ pressed }) => [
                        styles.failedRetryBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather
                        name="refresh-cw"
                        size={13}
                        color={colors.ustpGold}
                      />
                      <Text style={styles.failedRetryText}>Retry</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        dispatch({ type: 'DISMISS_FAILED', tempId: tempKey })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss failed message"
                      style={({ pressed }) => [
                        styles.failedDismissBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.failedDismissText}>Dismiss</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>

            {/* Below-Bubble Status / Seen Receipt Footer */}
            {isSending ? (
              <Text style={styles.ownFooterStatus}>Sending...</Text>
            ) : isUnsending ? (
              <Text style={styles.ownFooterStatus}>Unsending...</Text>
            ) : explicitSeenBy.length > 0 ? (
              <SeenByAvatarsRow readers={explicitSeenBy} alignRight />
            ) : (
              (!item.status || item.status === 'sent') &&
              isLatestMessage && (
                <Text style={styles.ownFooterStatus}>
                  {item.is_unsent ? 'Unsent' : `Sent ${displayTime}`}
                </Text>
              )
            )}
          </View>
        );
      }

      /* OTHER SENDER MESSAGE: Left Circular Avatar + Name/Role Header + Crisp Bubble + Latest Read Indicator */
      return (
        <View style={styles.otherMessageOuter}>
          <View style={styles.otherMessageRow}>
            <View style={styles.otherLeftGroup}>
              <ChatSenderAvatar
                name={senderName}
                role={senderRole}
                avatarUrl={authorAvatarUrl}
                size="md"
                accessibilityLabel={`${senderName}, ${roleLabel}`}
              />

              <View style={styles.otherBubbleColumn}>
                {/* Sender Name + Role Pill + Timestamp */}
                <View style={styles.otherHeaderRow}>
                  <Text numberOfLines={1} style={styles.otherAuthorName}>
                    {senderName}
                  </Text>
                  <View
                    style={[
                      styles.rolePill,
                      isFacultySender
                        ? styles.rolePillFaculty
                        : styles.rolePillStudent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rolePillText,
                        isFacultySender
                          ? styles.rolePillTextFaculty
                          : styles.rolePillTextStudent,
                      ]}
                    >
                      {roleLabel}
                    </Text>
                  </View>
                  <Text style={styles.otherTimestampText}>{displayTime}</Text>
                </View>

                <Pressable
                  onLongPress={
                    capabilities.canOpenMenu
                      ? () => {
                          Keyboard.dismiss();
                          setActionMenuTarget(item);
                        }
                      : undefined
                  }
                  delayLongPress={280}
                  accessibilityRole="button"
                  accessibilityLabel={`Message from ${senderName} at ${displayTime}`}
                  accessibilityHint={
                    capabilities.canOpenMenu
                      ? 'Press and hold to copy message'
                      : undefined
                  }
                  style={({ pressed }) => [
                    styles.bubble,
                    styles.bubbleOther,
                    item.is_unsent && styles.bubbleUnsent,
                    pressed && capabilities.canOpenMenu && styles.bubblePressed,
                  ]}
                >
                  {unsentPlaceholder ? (
                    <Text style={styles.unsentText}>{unsentPlaceholder}</Text>
                  ) : (
                    <>
                      {item.content.trim().length > 0 && (
                        <Text
                          style={[styles.messageBody, styles.messageBodyOther]}
                        >
                          {item.content}
                        </Text>
                      )}

                      {item.attachment && (
                        <View
                          style={[
                            styles.attachmentChip,
                            styles.attachmentChipOther,
                          ]}
                        >
                          <Feather
                            name={
                              item.attachment.type === 'image'
                                ? 'image'
                                : item.attachment.type === 'voice'
                                  ? 'mic'
                                  : 'paperclip'
                            }
                            size={14}
                            color={colors.ustpNavy}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.attachmentName,
                              styles.attachmentNameOther,
                            ]}
                          >
                            {item.attachment.name}
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Right-side mini read indicator matching clarify-web on latest respondent message */}
            {explicitSeenBy.length === 0 && isLatestMessage && (
              <View style={styles.latestSeenIndicatorWrap}>
                <ChatSenderAvatar
                  name={senderName}
                  role={senderRole}
                  avatarUrl={authorAvatarUrl}
                  size="xs"
                  accessibilityLabel={`Seen at ${displayTime}`}
                />
              </View>
            )}
          </View>

          {explicitSeenBy.length > 0 && (
            <SeenByAvatarsRow readers={explicitSeenBy} alignRight={false} />
          )}
        </View>
      );
    },
    [user, state.failedErrorByTempId, state.unsendingIds, handleRetryFailed]
  );

  // In an inverted FlatList, ListFooterComponent renders at the visual TOP (older history)
  const renderOlderMessagesHeader = () => {
    if (state.isLoading || state.messages.length === 0) {
      return null;
    }
    if (state.isLoadingOlder) {
      return (
        <View style={styles.olderLoaderRow}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.olderLoaderText}>Loading older messages...</Text>
        </View>
      );
    }
    if (state.hasMore && state.nextBefore) {
      return (
        <View style={styles.olderActionWrap}>
          <Pressable
            onPress={() => void handleLoadOlder()}
            accessibilityRole="button"
            accessibilityLabel="Load older messages"
            style={({ pressed }) => [
              styles.loadOlderBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="chevron-up" size={16} color={colors.ustpNavy} />
            <Text style={styles.loadOlderText}>Load older messages</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.beginningWrap}>
        <Text style={styles.beginningText}>
          Beginning of {channelTitle} chat history
        </Text>
      </View>
    );
  };

  const canSubmit =
    draft.trim().length > 0 && !state.isLoading && state.error?.status !== 403;

  const actionMenuCapabilities = actionMenuTarget
    ? getChatMessageActionCapabilities(actionMenuTarget, user)
    : null;

  const composerBottomPadding =
    Platform.OS === 'android' && androidKeyboardOverlap > 0
      ? spacing.sm
      : Math.max(insets.bottom, spacing.sm);

  const chatContent = (
    <View
      style={[
        styles.innerFlex,
        Platform.OS === 'android' && androidKeyboardOverlap > 0
          ? { paddingBottom: androidKeyboardOverlap }
          : null,
      ]}
    >
      {/* State 1: Loading Skeleton */}
      {state.isLoading ? (
        <ChatSkeleton />
      ) : state.error && state.messages.length === 0 ? (
        /* State 2: Full-view Error with Retry (403 / 404 / 500 / Offline) */
        <View style={styles.statePad}>
          <ErrorBanner
            error={state.error}
            onRetry={() => void fetchLatestChat('initial')}
          />
        </View>
      ) : (
        /* States 3 & 4: Empty or Populated Inverted FlatList */
        <View style={styles.listWrap}>
          {state.error && state.messages.length > 0 && (
            <View style={styles.inlineErrorWrap}>
              <ErrorBanner
                error={state.error}
                onRetry={() => void fetchLatestChat('refresh')}
              />
            </View>
          )}

          {invertedMessages.length === 0 ? (
            <View style={styles.statePad}>
              <EmptyState
                title={`No Messages in ${channelTitle} Yet`}
                description="Start the conversation with your classmates and course faculty below."
              />
            </View>
          ) : (
            <FlatList
              data={invertedMessages}
              inverted
              keyExtractor={keyExtractor}
              renderItem={renderMessage}
              ListFooterComponent={renderOlderMessagesHeader}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              onEndReached={() => void handleLoadOlder()}
              onEndReachedThreshold={0.25}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      )}

      {/* Message Composer Bar (hidden only on 403 forbidden channel) */}
      {state.error?.status !== 403 && (
        <View
          style={[
            styles.composerBar,
            { paddingBottom: composerBottomPadding },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${channelTitle}...`}
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={2000}
            accessibilityLabel={`Message ${channelTitle}`}
            style={styles.composerInput}
          />
          <Pressable
            onPress={handleSend}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Send chat message"
            accessibilityState={{ disabled: !canSubmit }}
            style={({ pressed }) => [
              styles.sendButton,
              !canSubmit && styles.sendButtonDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
          >
            <Feather
              name="send"
              size={18}
              color={canSubmit ? colors.ustpGold : colors.placeholder}
            />
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={recalculateKeyboardBounds}
    >
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          style={styles.innerFlex}
          behavior="padding"
          keyboardVerticalOffset={iosKeyboardOffset}
        >
          {chatContent}
        </KeyboardAvoidingView>
      ) : (
        chatContent
      )}

      {/* Messenger-Style Long-Press Message Action Popup */}
      <Modal
        visible={Boolean(actionMenuTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuTarget(null)}
      >
        <View style={styles.actionSheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setActionMenuTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Close message actions"
          />
          {actionMenuTarget && actionMenuCapabilities && (
            <View
              accessibilityViewIsModal
              style={[
                styles.actionSheetCard,
                { marginBottom: Math.max(insets.bottom, spacing.md) },
              ]}
            >
              {/* Clipped Message Preview */}
              <View style={styles.actionSheetPreview}>
                <View style={styles.actionSheetPreviewMeta}>
                  <Text numberOfLines={1} style={styles.actionSheetSender}>
                    {Number(
                      actionMenuTarget.author?.id ??
                        actionMenuTarget.sender_id ??
                        0
                    ) === Number(user?.id)
                      ? 'You'
                      : actionMenuTarget.author?.name || 'Campus Member'}
                  </Text>
                  <Text style={styles.actionSheetTime}>
                    {formatChatTime(actionMenuTarget.created_at)}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.actionSheetSnippet}>
                  {actionMenuTarget.content.trim() ||
                    actionMenuTarget.attachment?.name ||
                    'Attachment'}
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionSheetButtons}>
                {actionMenuCapabilities.canCopy && (
                  <Pressable
                    onPress={() => void handleCopyActionMessage()}
                    accessibilityRole="button"
                    accessibilityLabel="Copy message text"
                    style={({ pressed }) => [
                      styles.actionSheetRow,
                      pressed && styles.actionSheetRowPressed,
                    ]}
                  >
                    <Feather name="copy" size={18} color={colors.ustpNavy} />
                    <Text style={styles.actionSheetRowText}>Copy Message</Text>
                  </Pressable>
                )}

                {actionMenuCapabilities.canUnsend && (
                  <Pressable
                    onPress={handleRequestUnsendFromMenu}
                    accessibilityRole="button"
                    accessibilityLabel="Unsend message"
                    style={({ pressed }) => [
                      styles.actionSheetRow,
                      actionMenuCapabilities.canCopy &&
                        styles.actionSheetRowBorder,
                      pressed && styles.actionSheetRowPressed,
                    ]}
                  >
                    <Feather
                      name="trash-2"
                      size={18}
                      color={colors.dangerBorder}
                    />
                    <Text style={styles.actionSheetRowDangerText}>
                      Unsend Message
                    </Text>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={() => setActionMenuTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel message actions"
                style={({ pressed }) => [
                  styles.actionSheetCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionSheetCancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* Unsend Confirmation Modal */}
      <Modal
        visible={Boolean(unsendTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setUnsendTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setUnsendTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Cancel unsend backdrop"
          />
          <View accessibilityViewIsModal style={styles.modalCard}>
            <Text style={styles.modalTitle}>Unsend Message?</Text>
            <Text style={styles.modalBody}>
              This removes your message text and replaces it with an unsent
              placeholder for everyone in {channelTitle}.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setUnsendTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel unsend"
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmUnsend()}
                accessibilityRole="button"
                accessibilityLabel="Confirm unsend message"
                style={({ pressed }) => [
                  styles.modalConfirmBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalConfirmText}>Unsend</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  innerFlex: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  statePad: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  inlineErrorWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  separator: {
    height: spacing.md,
  },

  /* Own Message Layout */
  ownMessageColumn: {
    width: '100%',
    alignItems: 'flex-end',
    gap: 3,
  },
  ownFooterStatus: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
    fontWeight: '600',
    paddingRight: spacing.xs,
    ...typography.tabularNums,
  },

  /* Other Sender Message Layout */
  otherMessageOuter: {
    width: '100%',
    gap: 3,
  },
  otherMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  otherLeftGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    flexShrink: 1,
    maxWidth: '88%',
  },
  otherBubbleColumn: {
    flexShrink: 1,
    gap: 4,
  },
  otherHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 2,
  },
  otherAuthorName: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
    flexShrink: 1,
  },
  rolePill: {
    borderRadius: radii.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  rolePillFaculty: {
    backgroundColor: colors.ustpNavy,
  },
  rolePillStudent: {
    backgroundColor: colors.ustpGoldSoft,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  rolePillTextFaculty: {
    color: colors.ustpGold,
  },
  rolePillTextStudent: {
    color: colors.ustpNavy,
  },
  otherTimestampText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  latestSeenIndicatorWrap: {
    paddingBottom: 2,
    flexShrink: 0,
  },

  /* Sender Avatars */
  avatarMd: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarXs: {
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarFaculty: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpGold,
  },
  avatarStudent: {
    backgroundColor: colors.ustpGoldSoft,
    borderColor: colors.ustpOrange,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitialMd: {
    fontSize: typography.sizes.xs,
    fontWeight: '900',
  },
  avatarInitialXs: {
    fontSize: 8,
    fontWeight: '900',
  },
  avatarInitialFaculty: {
    color: colors.ustpGold,
  },
  avatarInitialStudent: {
    color: colors.ustpNavy,
  },

  /* Seen-By Reader Avatars Row (additive support) */
  seenByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
  },
  seenByRowRight: {
    justifyContent: 'flex-end',
  },
  seenByRowLeft: {
    justifyContent: 'flex-start',
    paddingLeft: 40,
  },
  seenByText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  seenByAvatarsStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seenOverflowBadge: {
    minWidth: 18,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seenOverflowText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },

  /* Chat Bubbles */
  bubble: {
    borderRadius: radii.xxl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },
  bubbleOwn: {
    maxWidth: '82%',
    backgroundColor: colors.ustpNavy,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderBottomRightRadius: radii.sm,
  },
  bubbleOther: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radii.sm,
  },
  bubbleUnsent: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bubbleSending: {
    opacity: 0.82,
  },
  bubbleFailed: {
    borderColor: colors.dangerBorder,
    borderWidth: 2,
  },
  bubblePressed: {
    opacity: 0.82,
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  authorName: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    flexShrink: 1,
  },
  authorNameOwn: {
    color: colors.ustpGold,
  },
  authorNameOther: {
    color: colors.ustpNavy,
  },
  timestampText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    ...typography.tabularNums,
  },
  timestampOwn: {
    color: colors.ustpNavyMutedText,
  },
  timestampOther: {
    color: colors.mutedSlate,
  },
  messageBody: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
  },
  messageBodyOwn: {
    color: colors.white,
  },
  messageBodyOther: {
    color: colors.ustpText,
  },
  unsentText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontStyle: 'italic',
    color: colors.mutedSlate,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  attachmentChipOwn: {
    backgroundColor: colors.ustpNavySurface,
    borderColor: colors.ustpNavyBorder,
  },
  attachmentChipOther: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
  },
  attachmentName: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
  },
  attachmentNameOwn: {
    color: colors.white,
  },
  attachmentNameOther: {
    color: colors.ustpNavy,
  },
  failedActionsBox: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.dangerBorder,
    gap: spacing.xs,
  },
  failedErrorText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerBg,
  },
  failedButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failedRetryBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavyDark,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  failedRetryText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  failedDismissBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedDismissText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.white,
    textDecorationLine: 'underline',
  },
  olderLoaderRow: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  olderLoaderText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  olderActionWrap: {
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  loadOlderBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  loadOlderText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  beginningWrap: {
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  beginningText: {
    fontSize: typography.sizes.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
  },

  /* Composer Bar */
  composerBar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    maxHeight: 120,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  sendButton: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },

  /* Skeleton Loading */
  skeletonWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  skeletonRowOwn: {
    justifyContent: 'flex-end',
  },
  skeletonRowOther: {
    justifyContent: 'flex-start',
  },
  skeletonAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.skeletonBase,
  },
  skeletonBubble: {
    width: '68%',
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonBubbleOwn: {
    backgroundColor: colors.skeletonBase,
  },
  skeletonBubbleOther: {
    backgroundColor: colors.white,
  },
  skeletonLineWide: {
    height: 12,
    width: '90%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeletonLight,
  },
  skeletonLineShort: {
    height: 12,
    width: '55%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeletonLight,
  },

  /* Messenger-Style Long-Press Action Popup */
  actionSheetBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  actionSheetCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  actionSheetPreview: {
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 4,
    ...elevation.overlay,
  },
  actionSheetPreviewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionSheetSender: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
    flexShrink: 1,
  },
  actionSheetTime: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    ...typography.tabularNums,
  },
  actionSheetSnippet: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.white,
  },
  actionSheetButtons: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  actionSheetRow: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionSheetRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionSheetRowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  actionSheetRowText: {
    fontSize: typography.sizes.body,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  actionSheetRowDangerText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.dangerBorder,
  },
  actionSheetCancelBtn: {
    minHeight: 48,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.overlay,
  },
  actionSheetCancelText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.mutedSlate,
  },

  /* Unsend Confirmation Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...elevation.overlay,
  },
  modalTitle: {
    fontSize: typography.sizes.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  modalBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCancelBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  modalConfirmBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  pressed: {
    opacity: 0.85,
  },
});
