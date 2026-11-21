import { Feather } from '@expo/vector-icons';
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
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import {
  getChannelChatMessagesApi,
  sendChannelChatMessageApi,
  unsendChannelChatMessageApi,
} from '../lib/api-client';
import {
  canUnsendChatMessage,
  courseChatReducer,
  createInitialCourseChatState,
  toInvertedChatList,
} from '../lib/chat-reducer';
import { getUnsentMessagePlaceholder } from '../lib/domain-logic';
import { computeDebouncedRefreshDelayMs } from '../lib/realtime-reducer';
import {
  subscribeChannelReverb,
  type ReverbBroadcastPayload,
} from '../lib/reverb-client';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme';
import type { ApiError, ChatMessage } from '../types/api';
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
 * Course Hub Messenger Chat tab (`subject_hashtag = '__CHAT__'`).
 * - Cursor pagination (`before`, `limit=50`, `meta.has_more`, `meta.next_before`) with inverted FlatList
 * - Optimistic send with `temp_id`, sending/sent/failed state, and inline Retry
 * - Unsend restricted to own confirmed messages (ChannelPolicy::unsendMessage)
 * - Private Reverb subscription `clarify.channel.{id}` active only while focused & AppState === 'active'
 * - Debounced (~1.5s + jitter) de-duplicated targeted chat refetch, zero polling
 */
export function CourseHubChatView({
  channelId,
  channelTitle,
  isFocused,
}: CourseHubChatViewProps) {
  const { user, showToast } = useAuth();
  const [state, dispatch] = useReducer(
    courseChatReducer,
    channelId,
    createInitialCourseChatState
  );

  const [draft, setDraft] = useState('');
  const [unsendTarget, setUnsendTarget] = useState<ChatMessage | null>(null);
  const [appActiveEpoch, setAppActiveEpoch] = useState(0);

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
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
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
    });
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
            apiErr?.message || 'Unable to send message. Tap Retry to try again.',
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
    (item: ChatMessage) => String(item.temp_id && typeof item.id !== 'number' ? item.temp_id : item.id),
    []
  );

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOwn =
        Boolean(user?.id) &&
        Number(item.author?.id ?? item.sender_id ?? 0) === Number(user?.id);
      const isSending = item.status === 'sending';
      const isFailed = item.status === 'failed';
      const tempKey = item.temp_id || String(item.id);
      const failedReason = state.failedErrorByTempId[tempKey];
      const unsentPlaceholder = getUnsentMessagePlaceholder(item, user?.id);
      const allowUnsend = canUnsendChatMessage(item, user);
      const isUnsending =
        typeof item.id === 'number' && state.unsendingIds.includes(item.id);

      return (
        <View
          style={[
            styles.messageRow,
            isOwn ? styles.messageRowOwn : styles.messageRowOther,
          ]}
        >
          <View
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              item.is_unsent && styles.bubbleUnsent,
              isFailed && styles.bubbleFailed,
            ]}
          >
            {/* Author + Timestamp Header */}
            <View style={styles.bubbleMetaRow}>
              <Text
                numberOfLines={1}
                style={[
                  styles.authorName,
                  isOwn && !item.is_unsent
                    ? styles.authorNameOwn
                    : styles.authorNameOther,
                ]}
              >
                {isOwn ? 'You' : item.author?.name || 'Campus Member'}
              </Text>
              <Text
                style={[
                  styles.timestampText,
                  isOwn && !item.is_unsent
                    ? styles.timestampOwn
                    : styles.timestampOther,
                ]}
              >
                {formatChatTime(item.created_at)}
              </Text>
            </View>

            {/* Body or Unsent Placeholder */}
            {unsentPlaceholder ? (
              <Text style={styles.unsentText}>{unsentPlaceholder}</Text>
            ) : (
              <>
                {item.content.trim().length > 0 && (
                  <Text
                    style={[
                      styles.messageBody,
                      isOwn ? styles.messageBodyOwn : styles.messageBodyOther,
                    ]}
                  >
                    {item.content}
                  </Text>
                )}

                {item.attachment && (
                  <View
                    style={[
                      styles.attachmentChip,
                      isOwn
                        ? styles.attachmentChipOwn
                        : styles.attachmentChipOther,
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
                      color={isOwn ? colors.ustpGold : colors.ustpNavy}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.attachmentName,
                        isOwn
                          ? styles.attachmentNameOwn
                          : styles.attachmentNameOther,
                      ]}
                    >
                      {item.attachment.name}
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Status / Unsend / Failed Retry Footer */}
            {isSending && (
              <Text style={styles.statusOwnText}>Sending...</Text>
            )}

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

            {allowUnsend && (
              <Pressable
                onPress={() => setUnsendTarget(item)}
                disabled={isUnsending}
                accessibilityRole="button"
                accessibilityLabel="Unsend message"
                style={({ pressed }) => [
                  styles.unsendBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.unsendBtnText}>
                  {isUnsending ? 'Unsending...' : 'Unsend'}
                </Text>
              </Pressable>
            )}
          </View>
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

  const canSubmit = draft.trim().length > 0 && !state.isLoading && state.error?.status !== 403;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
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
        <View style={styles.composerBar}>
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

      {/* Unsend Confirmation Modal */}
      <Modal
        visible={Boolean(unsendTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setUnsendTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ustpCream,
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
    padding: spacing.lg,
    flexGrow: 1,
  },
  separator: {
    height: spacing.sm + 2,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },
  bubbleOwn: {
    backgroundColor: colors.ustpNavy,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
  },
  bubbleOther: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleUnsent: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bubbleFailed: {
    borderColor: colors.dangerBorder,
    borderWidth: 2,
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
  statusOwnText: {
    fontSize: typography.sizes.xxs,
    color: colors.ustpNavyMutedText,
    fontWeight: '600',
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
  unsendBtn: {
    alignSelf: 'flex-end',
    minHeight: 32,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  unsendBtnText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.ustpNavyMutedText,
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
  composerBar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
  skeletonWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
  skeletonRowOwn: {
    justifyContent: 'flex-end',
  },
  skeletonRowOther: {
    justifyContent: 'flex-start',
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
