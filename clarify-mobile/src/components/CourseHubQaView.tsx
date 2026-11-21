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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import {
  convertThreadToFaqApi,
  createThreadApi,
  deleteThreadApi,
  getChannelThreadsApi,
  replyToThreadApi,
  resolveThreadApi,
  updateThreadApi,
} from '../lib/api-client';
import {
  canResolveOrPinThreads,
  canStudentModifyOwnInquiry,
  filterQaThreads,
  getFieldValidationError,
  getQaThreadFilterCounts,
  getThreadStatusLabel,
  isThreadResolved,
  isThreadUnread,
  isThreadVisibleToUser,
  type QaThreadStatusFilter,
} from '../lib/domain-logic';
import {
  courseQaReducer,
  createInitialCourseQaState,
  sanitizeThreadForPrivacy,
} from '../lib/qa-reducer';
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
import type { ApiError, QaThread } from '../types/api';
import { EmptyState, ErrorBanner, SkeletonCards } from './StateViews';

function formatShortThreadTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface CourseHubQaViewProps {
  channelId: number;
  channelTitle: string;
  isFocused: boolean;
  previousSeenAt?: string | null;
  onThreadActivityChanged?: () => void;
}

/**
 * Course Hub Isolated Q&A Threads & Collapsible Class FAQs View
 * Ported from clarify-web/app/channels/[channelId]/page.tsx.
 *
 * - Collapsible Class FAQs accordion (default collapsed) with strict "Anonymous Student"
 *   masking whenever `is_pinned_faq === true`.
 * - Status & Unread filter bar (All | Unresolved | Resolved + Unread toggle) & legend.
 * - Student: Ask in Q&A Thread modal (public/private), inline Edit & Delete on own unresolved.
 * - Faculty/Dept Head: Answer Ticket modal (reply + Mark Resolved + Pin to FAQ),
 *   1-click Resolve (`PATCH /threads/{id}/resolve`), 1-click Pin to FAQ (`POST /threads/{id}/convert-faq`).
 * - Focused private Reverb subscription (`clarify.channel.{channelId}`) with AppState pause
 *   and debounced de-duplicated sync (zero polling).
 */
export function CourseHubQaView({
  channelId,
  channelTitle,
  isFocused,
  previousSeenAt = null,
  onThreadActivityChanged,
}: CourseHubQaViewProps) {
  const { user, showToast } = useAuth();
  const [state, dispatch] = useReducer(
    courseQaReducer,
    channelId,
    createInitialCourseQaState
  );

  // Filter & Collapsible Class FAQs state (collapsed by default)
  const [statusFilter, setStatusFilter] = useState<QaThreadStatusFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [isFaqSectionOpen, setIsFaqSectionOpen] = useState(false);
  const [openFaqIds, setOpenFaqIds] = useState<number[]>([]);

  // Student Ask Inquiry Modal state
  const [isAskModalOpen, setIsAskModalOpen] = useState(false);
  const [inquirySubject, setInquirySubject] = useState('');
  const [inquiryContent, setInquiryContent] = useState('');
  const [inquiryPrivate, setInquiryPrivate] = useState(false);
  const [inquiryErrors, setInquiryErrors] = useState<Record<string, string[]>>(
    {}
  );
  const [isSubmittingInquiry, setIsSubmittingInquiry] = useState(false);

  // Student Edit / Delete Own Unresolved Inquiry state
  const [editingThreadId, setEditingThreadId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingErrors, setEditingErrors] = useState<Record<string, string[]>>(
    {}
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QaThread | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Faculty Answer Ticket Modal & Quick Actions state
  const [answeringThread, setAnsweringThread] = useState<QaThread | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [markResolved, setMarkResolved] = useState(true);
  const [pinTicketToFaq, setPinTicketToFaq] = useState(true);
  const [replyErrors, setReplyErrors] = useState<Record<string, string[]>>({});
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [busyActionThreadId, setBusyActionThreadId] = useState<number | null>(
    null
  );

  const [appActiveEpoch, setAppActiveEpoch] = useState(0);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const fetchInFlightRef = useRef<Promise<void> | null>(null);
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

  const fetchThreads = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (channelId <= 0) return;
      if (mode === 'silent' && !isAppActiveRef.current) return;
      if (fetchInFlightRef.current) {
        return fetchInFlightRef.current;
      }

      if (mode === 'initial') {
        dispatch({ type: 'LOAD_START' });
      } else if (mode === 'refresh') {
        dispatch({ type: 'REFRESH_START' });
      }

      const targetChannelId = channelId;
      const req = (async () => {
        try {
          const res = await getChannelThreadsApi(targetChannelId);
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          dispatch({
            type: 'LOAD_SUCCESS',
            channelId: targetChannelId,
            threads: Array.isArray(res.data) ? res.data : [],
          });
        } catch (err) {
          if (activeChannelRef.current !== targetChannelId) {
            return;
          }
          const apiErr = err as ApiError;
          dispatch({
            type: 'LOAD_ERROR',
            error: apiErr?.message
              ? apiErr
              : {
                  status: apiErr?.status ?? 500,
                  message:
                    'Could not load Q&A threads for this Course Hub. Please try again.',
                },
          });
        } finally {
          fetchInFlightRef.current = null;
        }
      })();

      fetchInFlightRef.current = req;
      return req;
    },
    [channelId]
  );

  const scheduleDebouncedSync = useCallback(() => {
    if (!isAppActiveRef.current || !isFocused || channelId <= 0) {
      return;
    }
    if (debouncedSyncTimerRef.current) {
      return;
    }
    const delayMs = computeDebouncedRefreshDelayMs();
    debouncedSyncTimerRef.current = setTimeout(() => {
      debouncedSyncTimerRef.current = null;
      if (!isAppActiveRef.current || !isFocused) return;
      void fetchThreads('silent');
    }, delayMs);
  }, [channelId, isFocused, fetchThreads]);

  const [prevChannelId, setPrevChannelId] = useState(channelId);
  if (prevChannelId !== channelId) {
    setPrevChannelId(channelId);
    setStatusFilter('all');
    setUnreadOnly(false);
    setOpenFaqIds([]);
    setEditingThreadId(null);
    setAnsweringThread(null);
    setDeleteTarget(null);
  }

  // Initial load & timer cleanup whenever channelId changes
  useEffect(() => {
    clearDebouncedSyncTimer();
    dispatch({ type: 'RESET_FOR_CHANNEL', channelId });

    if (channelId > 0) {
      void fetchThreads('initial');
    }

    return () => {
      clearDebouncedSyncTimer();
    };
  }, [channelId, fetchThreads, clearDebouncedSyncTimer]);

  // AppState handling: pause background syncing, single catch-up refresh on foreground resume
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = isAppActiveRef.current;
      const isNowActive = nextState === 'active';
      isAppActiveRef.current = isNowActive;

      if (!isNowActive) {
        clearDebouncedSyncTimer();
      } else if (!wasActive && isFocused && channelId > 0) {
        setAppActiveEpoch((prev) => prev + 1);
        void fetchThreads('silent');
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );
    return () => {
      subscription.remove();
    };
  }, [channelId, isFocused, fetchThreads, clearDebouncedSyncTimer]);

  // Private Reverb subscription strictly while focused & AppState === 'active'
  useEffect(() => {
    if (!isFocused || channelId <= 0 || !isAppActiveRef.current) {
      return;
    }

    const unsubscribe = subscribeChannelReverb(
      channelId,
      (payload: ReverbBroadcastPayload) => {
        if (!isAppActiveRef.current) return;
        if (payload.channel_id && Number(payload.channel_id) !== channelId) {
          return;
        }

        if (
          payload.type === 'thread.created' ||
          payload.type === 'thread.updated' ||
          payload.type === 'thread.replied' ||
          payload.type === 'thread.faq_pinned'
        ) {
          if (payload.thread && typeof payload.thread.id === 'number') {
            const sanitized = sanitizeThreadForPrivacy(payload.thread);
            dispatch({ type: 'UPSERT_THREAD', thread: sanitized });
            if (
              payload.type === 'thread.faq_pinned' &&
              sanitized.is_pinned_faq
            ) {
              setIsFaqSectionOpen(true);
              setOpenFaqIds((prev) =>
                prev.includes(sanitized.id) ? prev : [sanitized.id, ...prev]
              );
            }
          } else {
            scheduleDebouncedSync();
          }
          return;
        }

        if (payload.type === 'thread.deleted') {
          const deletedId = Number(payload.thread?.id ?? payload.message_id ?? 0);
          if (deletedId > 0) {
            dispatch({ type: 'REMOVE_THREAD', threadId: deletedId });
          } else {
            scheduleDebouncedSync();
          }
        }
      }
    );

    return () => {
      unsubscribe();
      clearDebouncedSyncTimer();
    };
  }, [
    channelId,
    isFocused,
    appActiveEpoch,
    scheduleDebouncedSync,
    clearDebouncedSyncTimer,
  ]);

  const isStudent = user?.role === 'student';
  const canResolve = user ? canResolveOrPinThreads(user.role) : false;

  const visibleThreads = useMemo(
    () => state.threads.filter((t) => (user ? isThreadVisibleToUser(t, user) : !t.is_private)),
    [state.threads, user]
  );

  const filterCounts = useMemo(
    () => getQaThreadFilterCounts(state.threads, user ?? null, previousSeenAt),
    [state.threads, user, previousSeenAt]
  );

  const filteredThreads = useMemo(
    () =>
      filterQaThreads(state.threads, user ?? null, {
        statusFilter,
        unreadOnly,
        previousSeenAt,
      }),
    [state.threads, user, statusFilter, unreadOnly, previousSeenAt]
  );

  const publishedFaqs = useMemo(
    () => state.threads.filter((t) => t.is_pinned_faq),
    [state.threads]
  );

  const toggleFaqItem = (id: number) => {
    setOpenFaqIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Student: Submit Inquiry
  const handleSubmitInquiry = async () => {
    if (isSubmittingInquiry || channelId <= 0) return;

    const clientErrors: Record<string, string[]> = {};
    if (!inquirySubject.trim()) {
      clientErrors.subject_hashtag = [
        'Please enter a subject hashtag (e.g., #Midterm_Rubric).',
      ];
    }
    if (!inquiryContent.trim()) {
      clientErrors.content = [
        'Please enter your inquiry or clarification details.',
      ];
    }
    if (Object.keys(clientErrors).length > 0) {
      setInquiryErrors(clientErrors);
      return;
    }

    setIsSubmittingInquiry(true);
    setInquiryErrors({});
    try {
      const res = await createThreadApi(channelId, {
        subject_hashtag: inquirySubject.trim(),
        content: inquiryContent.trim(),
        is_private: inquiryPrivate,
      });
      if (res.data) {
        dispatch({ type: 'UPSERT_THREAD', thread: res.data });
      }
      showToast(res.message || 'Academic inquiry submitted.', 'success');
      setInquirySubject('');
      setInquiryContent('');
      setInquiryPrivate(false);
      setIsAskModalOpen(false);
      onThreadActivityChanged?.();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setInquiryErrors(apiErr.errors);
      } else {
        showToast(apiErr?.message || 'Could not submit inquiry.', 'error');
      }
    } finally {
      setIsSubmittingInquiry(false);
    }
  };

  // Student: Save Edited Own Unresolved Inquiry
  const handleSaveEdit = async (threadId: number) => {
    if (isSavingEdit) return;
    if (!editingContent.trim()) {
      setEditingErrors({
        content: ['Inquiry content cannot be empty.'],
      });
      return;
    }
    setIsSavingEdit(true);
    setEditingErrors({});
    try {
      const res = await updateThreadApi(threadId, {
        content: editingContent.trim(),
      });
      if (res.data) {
        dispatch({ type: 'UPSERT_THREAD', thread: res.data });
      }
      setEditingThreadId(null);
      setEditingContent('');
      showToast(res.message || 'Inquiry updated.', 'success');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setEditingErrors(apiErr.errors);
      } else {
        showToast(apiErr?.message || 'Could not update inquiry.', 'error');
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Student: Delete Own Unresolved Inquiry
  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await deleteThreadApi(deleteTarget.id);
      dispatch({ type: 'REMOVE_THREAD', threadId: deleteTarget.id });
      setDeleteTarget(null);
      showToast(res.message || 'Inquiry deleted.', 'info');
      onThreadActivityChanged?.();
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Could not delete inquiry.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Faculty: 1-Click Mark Resolved
  const handleQuickResolve = async (threadId: number) => {
    if (busyActionThreadId !== null) return;
    setBusyActionThreadId(threadId);
    try {
      const res = await resolveThreadApi(threadId);
      if (res.data) {
        dispatch({ type: 'UPSERT_THREAD', thread: res.data });
      }
      showToast(res.message || 'Ticket marked as resolved.', 'success');
      onThreadActivityChanged?.();
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Could not resolve ticket.', 'error');
    } finally {
      setBusyActionThreadId(null);
    }
  };

  // Faculty: 1-Click Pin to Class FAQs
  const handleQuickPinFaq = async (threadId: number) => {
    if (busyActionThreadId !== null) return;
    setBusyActionThreadId(threadId);
    try {
      const res = await convertThreadToFaqApi(threadId);
      if (res.data) {
        dispatch({ type: 'UPSERT_THREAD', thread: res.data });
      }
      setIsFaqSectionOpen(true);
      setOpenFaqIds((prev) =>
        prev.includes(threadId) ? prev : [threadId, ...prev]
      );
      showToast(
        res.message || 'Pinned to Class FAQs (Student Identity Masked).',
        'success'
      );
      onThreadActivityChanged?.();
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Could not pin to Class FAQs.', 'error');
    } finally {
      setBusyActionThreadId(null);
    }
  };

  // Faculty: Submit Answer Ticket Modal
  const handleSubmitAnswer = async () => {
    if (!answeringThread || isSubmittingReply) return;
    if (!replyContent.trim()) {
      setReplyErrors({
        content: ['Please enter a faculty response before submitting.'],
      });
      return;
    }

    setIsSubmittingReply(true);
    setReplyErrors({});
    try {
      const res = await replyToThreadApi(answeringThread.id, {
        content: replyContent.trim(),
        mark_resolved: markResolved,
        pin_to_faq: pinTicketToFaq,
      });
      if (res.data) {
        dispatch({ type: 'UPSERT_THREAD', thread: res.data });
      }
      if (pinTicketToFaq) {
        setIsFaqSectionOpen(true);
        setOpenFaqIds((prev) =>
          prev.includes(answeringThread.id)
            ? prev
            : [answeringThread.id, ...prev]
        );
      }
      showToast(res.message || 'Faculty reply submitted.', 'success');
      setAnsweringThread(null);
      setReplyContent('');
      onThreadActivityChanged?.();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setReplyErrors(apiErr.errors);
      } else {
        showToast(apiErr?.message || 'Failed to submit reply.', 'error');
      }
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const renderListHeader = () => (
    <View style={styles.headerBlock}>
      {/* Collapsible Class FAQs Accordion (Default Collapsed) */}
      <View style={styles.faqCard}>
        <Pressable
          onPress={() => setIsFaqSectionOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={`Class FAQs, ${publishedFaqs.length} published`}
          accessibilityState={{ expanded: isFaqSectionOpen }}
          style={({ pressed }) => [
            styles.faqHeaderBtn,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.faqHeaderLeft}>
            <Feather name="book-open" size={16} color={colors.ustpOrange} />
            <Text style={styles.faqHeaderTitle}>Class FAQs</Text>
            <View style={styles.faqCountPill}>
              <Text style={styles.faqCountText}>{publishedFaqs.length}</Text>
            </View>
          </View>
          <Feather
            name={isFaqSectionOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.mutedSlate}
          />
        </Pressable>

        {isFaqSectionOpen && (
          <View style={styles.faqBody}>
            {publishedFaqs.length === 0 ? (
              <Text style={styles.faqEmptyText}>
                No Class FAQs published yet. Pinned Q&amp;A answers will appear
                here with student identity anonymized.
              </Text>
            ) : (
              publishedFaqs.map((faq) => {
                const isExpanded = openFaqIds.includes(faq.id);
                const latestReplyObj =
                  faq.replies.length > 0
                    ? faq.replies[faq.replies.length - 1]
                    : undefined;
                const latestReply =
                  latestReplyObj?.content || 'Resolved during consultation.';
                const replyHeading = latestReplyObj?.author?.name
                  ? `Faculty reply · ${latestReplyObj.author.name}`
                  : 'Faculty reply';

                return (
                  <View key={String(faq.id)} style={styles.faqItemCard}>
                    <Pressable
                      onPress={() => toggleFaqItem(faq.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`FAQ ${faq.subject_hashtag}`}
                      accessibilityState={{ expanded: isExpanded }}
                      style={({ pressed }) => [
                        styles.faqItemHeader,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.faqItemTitle}>
                        {faq.subject_hashtag}
                      </Text>
                      <Feather
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.mutedSlate}
                      />
                    </Pressable>

                    {isExpanded && (
                      <View style={styles.faqItemBody}>
                        <View style={styles.anonRow}>
                          <View style={styles.maskedAvatar}>
                            <Feather
                              name="user"
                              size={12}
                              color={colors.ustpNavy}
                            />
                          </View>
                          <Text style={styles.anonLabel}>
                            Asked by: Anonymous Student
                          </Text>
                        </View>
                        <Text style={styles.faqQuestionText}>{faq.content}</Text>
                        <View style={styles.faqReplyBox}>
                          <Text style={styles.faqReplyHeading}>
                            {replyHeading}
                          </Text>
                          <Text style={styles.faqReplyText}>{latestReply}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>

      {/* Section Title + Student Ask CTA */}
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionTitleCopy}>
          <Text style={styles.sectionTitle}>
            Isolated Q&amp;A Threads ({filterCounts.all})
          </Text>
          <Text style={styles.sectionSubtitle}>
            Structured academic inquiries for {channelTitle}
          </Text>
        </View>
        {isStudent && (
          <Pressable
            onPress={() => {
              setInquiryErrors({});
              setIsAskModalOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Ask in Q and A Thread"
            style={({ pressed }) => [
              styles.askButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="plus" size={16} color={colors.ustpNavy} />
            <Text style={styles.askButtonText}>Ask in Q&amp;A Thread</Text>
          </Pressable>
        )}
      </View>

      {/* Filter Bar + Status Legend */}
      <View style={styles.filterCard}>
        <View style={styles.filterChipsRow}>
          <Pressable
            onPress={() => setStatusFilter('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'all' }}
            style={({ pressed }) => [
              styles.filterChip,
              statusFilter === 'all' && styles.filterChipActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === 'all' && styles.filterChipTextActive,
              ]}
            >
              All ({filterCounts.all})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setStatusFilter('unresolved')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'unresolved' }}
            style={({ pressed }) => [
              styles.filterChip,
              statusFilter === 'unresolved'
                ? styles.filterChipActive
                : canResolve && filterCounts.unresolved > 0
                  ? styles.filterChipTriage
                  : null,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === 'unresolved'
                  ? styles.filterChipTextActiveGold
                  : canResolve && filterCounts.unresolved > 0
                    ? styles.filterChipTextTriage
                    : null,
              ]}
            >
              Unresolved ({filterCounts.unresolved})
            </Text>
            {canResolve && filterCounts.unresolved > 0 && (
              <View style={styles.triagePill}>
                <Text style={styles.triagePillText}>Needs Triage</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={() => setStatusFilter('resolved')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'resolved' }}
            style={({ pressed }) => [
              styles.filterChip,
              statusFilter === 'resolved' && styles.filterChipActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === 'resolved' && styles.filterChipTextActive,
              ]}
            >
              Resolved ({filterCounts.resolved})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setUnreadOnly((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ selected: unreadOnly }}
            style={({ pressed }) => [
              styles.filterChip,
              unreadOnly
                ? styles.filterChipUnreadActive
                : filterCounts.unread > 0
                  ? styles.filterChipUnreadAvailable
                  : null,
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.unreadDot,
                unreadOnly
                  ? styles.unreadDotActive
                  : filterCounts.unread > 0
                    ? styles.unreadDotAlert
                    : styles.unreadDotMuted,
              ]}
            />
            <Text
              style={[
                styles.filterChipText,
                unreadOnly
                  ? styles.filterChipTextActive
                  : filterCounts.unread > 0
                    ? styles.filterChipTextAlert
                    : null,
              ]}
            >
              Unread ({filterCounts.unread})
            </Text>
          </Pressable>
        </View>

        <View style={styles.legendRow}>
          <Text style={styles.legendLabel}>Legend:</Text>
          <View style={styles.legendItem}>
            <View style={styles.badgeNew}>
              <Text style={styles.badgeNewText}>NEW</Text>
            </View>
            <Text style={styles.legendText}>Unread since last visit</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.badgeUnresolved}>
              <Text style={styles.badgeUnresolvedText}>UNRESOLVED</Text>
            </View>
            <Text style={styles.legendText}>Open</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.badgeResolved}>
              <Text style={styles.badgeResolvedText}>RESOLVED</Text>
            </View>
            <Text style={styles.legendText}>Answered</Text>
          </View>
        </View>
      </View>

      {state.error && state.threads.length > 0 && (
        <ErrorBanner
          error={state.error}
          onRetry={() => void fetchThreads('refresh')}
        />
      )}
    </View>
  );

  const renderThreadCard = ({ item: rawThread }: { item: QaThread }) => {
    const thread = sanitizeThreadForPrivacy(rawThread);
    const isResolved = isThreadResolved(thread);
    const statusLabel = getThreadStatusLabel(thread);
    const isUnread = user
      ? isThreadUnread(thread, user.id, previousSeenAt)
      : false;
    const canStudentEdit = user ? canStudentModifyOwnInquiry(user, thread) : false;
    const isEditing = editingThreadId === thread.id;
    const isBusy = busyActionThreadId === thread.id;
    const authorDisplay = thread.is_pinned_faq
      ? 'Anonymous Student'
      : thread.author?.name || 'Student';
    const editContentError = getFieldValidationError(editingErrors, 'content');

    return (
      <View
        style={[styles.threadCard, isUnread && styles.threadCardUnread]}
      >
        {/* Top Row: Hashtag + Status + Student Edit/Delete */}
        <View style={styles.threadTopRow}>
          <View style={styles.threadTitleCol}>
            <View style={styles.threadBadgesRow}>
              <Text style={styles.threadHashtag}>{thread.subject_hashtag}</Text>
              {isUnread && (
                <View style={styles.badgeNew}>
                  <Text style={styles.badgeNewText}>NEW</Text>
                </View>
              )}
              {thread.is_private && (
                <View style={styles.badgePrivate}>
                  <Feather name="lock" size={11} color={colors.mutedSlate} />
                  <Text style={styles.badgePrivateText}>Private Inquiry</Text>
                </View>
              )}
            </View>

            <View style={styles.threadMetaRow}>
              {thread.is_pinned_faq && (
                <View style={styles.maskedAvatarSmall}>
                  <Feather name="user" size={10} color={colors.ustpNavy} />
                </View>
              )}
              <Text style={styles.threadMetaText}>
                From: {authorDisplay} • {formatShortThreadTime(thread.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.threadStatusCol}>
            <View
              style={
                isResolved ? styles.badgeResolved : styles.badgeUnresolved
              }
            >
              <Text
                style={
                  isResolved
                    ? styles.badgeResolvedText
                    : styles.badgeUnresolvedText
                }
              >
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* Body or Inline Student Edit */}
        {isEditing ? (
          <View style={styles.inlineEditWrap}>
            <TextInput
              value={editingContent}
              onChangeText={(text) => {
                setEditingContent(text);
                if (editingErrors.content) setEditingErrors({});
              }}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="Edit inquiry content"
              style={styles.inlineEditInput}
            />
            {editContentError && (
              <Text accessibilityRole="alert" style={styles.fieldError}>
                {editContentError}
              </Text>
            )}
            <View style={styles.inlineEditActions}>
              <Pressable
                onPress={() => {
                  setEditingThreadId(null);
                  setEditingErrors({});
                }}
                disabled={isSavingEdit}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing inquiry"
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSaveEdit(thread.id)}
                disabled={isSavingEdit}
                accessibilityRole="button"
                accessibilityLabel="Save edited inquiry"
                style={({ pressed }) => [
                  styles.primarySmallBtn,
                  isSavingEdit && styles.disabledBtn,
                  pressed && !isSavingEdit && styles.pressed,
                ]}
              >
                {isSavingEdit ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.primarySmallBtnText}>Save Inquiry</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.threadContent}>{thread.content}</Text>
        )}

        {/* Nested Faculty / Student Replies */}
        {thread.replies.length > 0 && (
          <View style={styles.repliesBox}>
            {thread.replies.map((reply) => (
              <Text key={String(reply.id)} style={styles.replyLine}>
                <Text style={styles.replyAuthor}>
                  {reply.author?.role === 'student'
                    ? `Student Reply (${reply.author?.name || 'Student'}): `
                    : `Faculty Reply (${reply.author?.name || 'Instructor'}): `}
                </Text>
                {reply.content}
              </Text>
            ))}
            {thread.is_pinned_faq && (
              <View style={styles.pinnedFaqFooter}>
                <Feather name="star" size={12} color={colors.warningText} />
                <Text style={styles.pinnedFaqFooterText}>
                  Pinned to Class FAQs (Student Identity Masked)
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Student Own Unresolved Actions (Edit & Delete) */}
        {canStudentEdit && !isEditing && (
          <View style={styles.cardActionsRow}>
            <Pressable
              onPress={() => {
                setEditingThreadId(thread.id);
                setEditingContent(thread.content);
                setEditingErrors({});
              }}
              accessibilityRole="button"
              accessibilityLabel={`Edit inquiry ${thread.subject_hashtag}`}
              style={({ pressed }) => [
                styles.outlineActionBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="edit-2" size={14} color={colors.ustpNavy} />
              <Text style={styles.outlineActionText}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setDeleteTarget(thread)}
              accessibilityRole="button"
              accessibilityLabel={`Delete inquiry ${thread.subject_hashtag}`}
              style={({ pressed }) => [
                styles.dangerOutlineBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="trash-2" size={14} color={colors.dangerText} />
              <Text style={styles.dangerOutlineText}>Delete</Text>
            </Pressable>
          </View>
        )}

        {/* Faculty / Dept Head Controls (Strictly hidden for students) */}
        {canResolve && (
          <View style={styles.cardActionsRow}>
            {!isResolved && (
              <Pressable
                onPress={() => void handleQuickResolve(thread.id)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${thread.subject_hashtag} as resolved`}
                style={({ pressed }) => [
                  styles.resolveActionBtn,
                  isBusy && styles.disabledBtn,
                  pressed && !isBusy && styles.pressed,
                ]}
              >
                <Feather
                  name="check-circle"
                  size={14}
                  color={colors.successText}
                />
                <Text style={styles.resolveActionText}>Resolve</Text>
              </Pressable>
            )}
            {!thread.is_pinned_faq && (
              <Pressable
                onPress={() => void handleQuickPinFaq(thread.id)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={`Pin ${thread.subject_hashtag} to Class FAQs`}
                style={({ pressed }) => [
                  styles.pinFaqBtn,
                  isBusy && styles.disabledBtn,
                  pressed && !isBusy && styles.pressed,
                ]}
              >
                <Feather name="star" size={14} color={colors.warningText} />
                <Text style={styles.pinFaqBtnText}>Pin to FAQ</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setAnsweringThread(thread);
                setReplyContent('');
                setMarkResolved(true);
                setPinTicketToFaq(!thread.is_pinned_faq);
                setReplyErrors({});
              }}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Answer ticket ${thread.subject_hashtag}`}
              style={({ pressed }) => [
                styles.answerBtn,
                isBusy && styles.disabledBtn,
                pressed && !isBusy && styles.pressed,
              ]}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.answerBtnText}>Answer</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const renderEmptyState = () => {
    if (state.isLoading) {
      return <SkeletonCards count={3} />;
    }
    if (state.error) {
      return (
        <ErrorBanner
          error={state.error}
          onRetry={() => void fetchThreads('initial')}
        />
      );
    }
    if (visibleThreads.length === 0) {
      return (
        <EmptyState
          title="No Academic Inquiries Submitted Yet"
          description="Students can submit structured questions or clarifications without cluttering the official noticeboard."
          actionLabel={isStudent ? 'Ask in Q&A Thread' : undefined}
          onAction={
            isStudent
              ? () => {
                  setInquiryErrors({});
                  setIsAskModalOpen(true);
                }
              : undefined
          }
        />
      );
    }
    if (unreadOnly) {
      return (
        <EmptyState
          title="No Unread Q&A Inquiries"
          description="You have caught up on all new questions and faculty replies in this Course Hub."
          actionLabel="Show All Inquiries"
          onAction={() => {
            setUnreadOnly(false);
            setStatusFilter('all');
          }}
        />
      );
    }
    if (statusFilter === 'unresolved') {
      return (
        <EmptyState
          title="No Unresolved Inquiries"
          description="Every visible academic inquiry in this Course Hub has been resolved by the instructor."
          actionLabel="View All Inquiries"
          onAction={() => setStatusFilter('all')}
        />
      );
    }
    return (
      <EmptyState
        title="No Resolved Inquiries Yet"
        description="Inquiries marked resolved by the course instructor will appear under this filter."
        actionLabel="View All Inquiries"
        onAction={() => setStatusFilter('all')}
      />
    );
  };

  const subjectError = getFieldValidationError(inquiryErrors, 'subject_hashtag');
  const contentError = getFieldValidationError(inquiryErrors, 'content');
  const replyContentError = getFieldValidationError(replyErrors, 'content');

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredThreads}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderThreadCard}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.listGap} />}
        refreshControl={
          <RefreshControl
            refreshing={state.isRefreshing}
            onRefresh={() => void fetchThreads('refresh')}
            tintColor={colors.ustpNavy}
            colors={[colors.ustpNavy]}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Student "Ask in Q&A Thread" Modal */}
      <Modal
        visible={isAskModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingInquiry) setIsAskModalOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isSubmittingInquiry) setIsAskModalOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss ask inquiry dialog"
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCol}>
                <Text style={styles.modalTitle}>Send an Inquiry</Text>
                <Text style={styles.modalSubtitle}>
                  Scoped to {channelTitle}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (!isSubmittingInquiry) setIsAskModalOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Close inquiry dialog"
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={20} color={colors.mutedSlate} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalForm}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Subject Hashtag</Text>
                  <TextInput
                    value={inquirySubject}
                    onChangeText={(text) => {
                      setInquirySubject(text);
                      if (inquiryErrors.subject_hashtag) {
                        setInquiryErrors((prev) => {
                          const next = { ...prev };
                          delete next.subject_hashtag;
                          return next;
                        });
                      }
                    }}
                    placeholder="e.g., #Midterm_Rubric or #Defence"
                    placeholderTextColor={colors.placeholder}
                    editable={!isSubmittingInquiry}
                    accessibilityLabel="Subject Hashtag"
                    style={[
                      styles.textInput,
                      subjectError ? styles.inputError : null,
                    ]}
                  />
                  {subjectError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {subjectError}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Question or Clarification</Text>
                  <TextInput
                    value={inquiryContent}
                    onChangeText={(text) => {
                      setInquiryContent(text);
                      if (inquiryErrors.content) {
                        setInquiryErrors((prev) => {
                          const next = { ...prev };
                          delete next.content;
                          return next;
                        });
                      }
                    }}
                    placeholder="Describe your question clearly for the instructor..."
                    placeholderTextColor={colors.placeholder}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    editable={!isSubmittingInquiry}
                    accessibilityLabel="Inquiry Question Content"
                    style={[
                      styles.textArea,
                      contentError ? styles.inputError : null,
                    ]}
                  />
                  {contentError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {contentError}
                    </Text>
                  )}
                </View>

                <Pressable
                  onPress={() => setInquiryPrivate((prev) => !prev)}
                  disabled={isSubmittingInquiry}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: inquiryPrivate }}
                  accessibilityLabel="Make Inquiry Private, visible only to instructor"
                  style={styles.checkboxRow}
                >
                  <View
                    style={[
                      styles.checkboxBox,
                      inquiryPrivate && styles.checkboxBoxChecked,
                    ]}
                  >
                    {inquiryPrivate && (
                      <Feather name="check" size={14} color={colors.white} />
                    )}
                  </View>
                  <Feather name="lock" size={14} color={colors.mutedSlate} />
                  <Text style={styles.checkboxLabel}>
                    Make Inquiry Private (Visible only to Instructor)
                  </Text>
                </Pressable>

                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => setIsAskModalOpen(false)}
                    disabled={isSubmittingInquiry}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel inquiry"
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleSubmitInquiry()}
                    disabled={isSubmittingInquiry}
                    accessibilityRole="button"
                    accessibilityLabel="Submit inquiry"
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      isSubmittingInquiry && styles.disabledBtn,
                      pressed && !isSubmittingInquiry && styles.pressed,
                    ]}
                  >
                    {isSubmittingInquiry ? (
                      <ActivityIndicator size="small" color={colors.ustpGold} />
                    ) : (
                      <Text style={styles.primarySubmitBtnText}>Submit</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Faculty "Answer Ticket" Modal (Strictly only rendered when canResolve) */}
      <Modal
        visible={Boolean(answeringThread && canResolve)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingReply) setAnsweringThread(null);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isSubmittingReply) setAnsweringThread(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss answer ticket dialog"
          />
          {answeringThread && (
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleCol}>
                  <Text style={styles.modalTitle}>Answer Ticket</Text>
                  <Text style={styles.modalSubtitle}>
                    {answeringThread.subject_hashtag}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (!isSubmittingReply) setAnsweringThread(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Close answer ticket dialog"
                  style={styles.modalCloseBtn}
                >
                  <Feather name="x" size={20} color={colors.mutedSlate} />
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.modalForm}>
                  <View style={styles.ticketPreviewBox}>
                    <Text style={styles.ticketPreviewAuthor}>
                      {answeringThread.is_pinned_faq
                        ? 'Anonymous Student'
                        : answeringThread.author?.name || 'Student'}
                    </Text>
                    <Text style={styles.ticketPreviewBody}>
                      {answeringThread.content}
                    </Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Faculty Reply</Text>
                    <TextInput
                      value={replyContent}
                      onChangeText={(text) => {
                        setReplyContent(text);
                        if (replyErrors.content) setReplyErrors({});
                      }}
                      placeholder="Write your official clarification or answer..."
                      placeholderTextColor={colors.placeholder}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      editable={!isSubmittingReply}
                      accessibilityLabel="Faculty Reply"
                      style={[
                        styles.textArea,
                        replyContentError ? styles.inputError : null,
                      ]}
                    />
                    {replyContentError && (
                      <Text accessibilityRole="alert" style={styles.fieldError}>
                        {replyContentError}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    onPress={() => setMarkResolved((prev) => !prev)}
                    disabled={isSubmittingReply}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: markResolved }}
                    accessibilityLabel="Mark as Resolved"
                    style={styles.checkboxRow}
                  >
                    <View
                      style={[
                        styles.checkboxBox,
                        markResolved && styles.checkboxBoxChecked,
                      ]}
                    >
                      {markResolved && (
                        <Feather name="check" size={14} color={colors.white} />
                      )}
                    </View>
                    <Text style={styles.checkboxLabel}>Mark as Resolved</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setPinTicketToFaq((prev) => {
                        const next = !prev;
                        if (next) setMarkResolved(true);
                        return next;
                      });
                    }}
                    disabled={isSubmittingReply}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: pinTicketToFaq }}
                    accessibilityLabel="Pin to Class FAQs (Student Identity Masked)"
                    style={styles.checkboxRow}
                  >
                    <View
                      style={[
                        styles.checkboxBox,
                        pinTicketToFaq && styles.checkboxBoxChecked,
                      ]}
                    >
                      {pinTicketToFaq && (
                        <Feather name="check" size={14} color={colors.white} />
                      )}
                    </View>
                    <Text style={styles.checkboxLabel}>
                      Pin to Class FAQs (Anonymizes student identity)
                    </Text>
                  </Pressable>

                  <View style={styles.modalActions}>
                    <Pressable
                      onPress={() => setAnsweringThread(null)}
                      disabled={isSubmittingReply}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel reply"
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleSubmitAnswer()}
                      disabled={isSubmittingReply}
                      accessibilityRole="button"
                      accessibilityLabel="Submit faculty answer"
                      style={({ pressed }) => [
                        styles.primarySubmitBtn,
                        isSubmittingReply && styles.disabledBtn,
                        pressed && !isSubmittingReply && styles.pressed,
                      ]}
                    >
                      {isSubmittingReply ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.ustpGold}
                        />
                      ) : (
                        <Text style={styles.primarySubmitBtnText}>Submit</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Inquiry Confirmation Modal */}
      <Modal
        visible={Boolean(deleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isDeleting) setDeleteTarget(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss delete inquiry confirmation"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Inquiry?</Text>
            <Text style={styles.confirmDesc}>
              Remove your inquiry{' '}
              <Text style={styles.confirmHashtag}>
                {deleteTarget?.subject_hashtag}
              </Text>{' '}
              from this Course Hub? This cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel="Cancel delete inquiry"
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmDelete()}
                disabled={isDeleting}
                accessibilityRole="button"
                accessibilityLabel="Confirm delete inquiry"
                style={({ pressed }) => [
                  styles.dangerConfirmBtn,
                  isDeleting && styles.disabledBtn,
                  pressed && !isDeleting && styles.pressed,
                ]}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.dangerConfirmBtnText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ustpCream,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  listGap: {
    height: spacing.md,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  faqCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  faqHeaderBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  faqHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  faqHeaderTitle: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  faqCountPill: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  faqCountText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  faqBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.ustpCream,
  },
  faqEmptyText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  faqItemCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  faqItemHeader: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  faqItemTitle: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  faqItemBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  maskedAvatar: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maskedAvatarSmall: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anonLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  faqQuestionText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  faqReplyBox: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderLeftWidth: 3,
    borderLeftColor: colors.ustpNavy,
    borderRadius: radii.sm,
    padding: spacing.sm + 2,
    gap: spacing.xxs,
  },
  faqReplyHeading: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  faqReplyText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitleCopy: {
    flex: 1,
    minWidth: 180,
    gap: 2,
  },
  sectionTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  sectionSubtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  askButton: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  askButtonText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  filterCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  filterChip: {
    minHeight: 40,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  filterChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  filterChipTriage: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
  },
  filterChipUnreadActive: {
    backgroundColor: colors.dangerText,
    borderColor: colors.dangerText,
  },
  filterChipUnreadAvailable: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
  },
  filterChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  filterChipTextActive: {
    color: colors.white,
  },
  filterChipTextActiveGold: {
    color: colors.ustpGold,
  },
  filterChipTextTriage: {
    color: colors.warningText,
  },
  filterChipTextAlert: {
    color: colors.dangerText,
  },
  triagePill: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  triagePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  unreadDotActive: {
    backgroundColor: colors.white,
  },
  unreadDotAlert: {
    backgroundColor: colors.dangerText,
  },
  unreadDotMuted: {
    backgroundColor: colors.placeholder,
  },
  legendRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendLabel: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendText: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
  },
  badgeNew: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  badgeNewText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dangerText,
  },
  badgePrivate: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  badgePrivateText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  badgeUnresolved: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 3,
    paddingVertical: 2,
  },
  badgeUnresolvedText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warningText,
  },
  badgeResolved: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 3,
    paddingVertical: 2,
  },
  badgeResolvedText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.successText,
  },
  threadCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  threadCardUnread: {
    borderColor: colors.dangerBorder,
  },
  threadTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  threadTitleCol: {
    flex: 1,
    gap: spacing.xxs + 2,
  },
  threadBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  threadHashtag: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  threadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  threadMetaText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  threadStatusCol: {
    flexShrink: 0,
  },
  threadContent: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  inlineEditWrap: {
    gap: spacing.sm,
  },
  inlineEditInput: {
    minHeight: 88,
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  inlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  repliesBox: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs + 2,
  },
  replyLine: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  replyAuthor: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  pinnedFaqFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xxs,
  },
  pinnedFaqFooterText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.warningText,
  },
  cardActionsRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  outlineActionBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  outlineActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  dangerOutlineBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dangerOutlineText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  resolveActionBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resolveActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.successText,
  },
  pinFaqBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pinFaqBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.warningText,
  },
  answerBtn: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.xl,
    padding: spacing.xl,
    maxHeight: '88%',
    gap: spacing.md,
    ...elevation.overlay,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalTitleCol: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  modalSubtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  modalCloseBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -spacing.xs,
    marginRight: -spacing.xs,
  },
  modalForm: {
    gap: spacing.md,
  },
  ticketPreviewBox: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  ticketPreviewAuthor: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.mutedSlate,
  },
  ticketPreviewBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  textInput: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.body,
    color: colors.ustpText,
  },
  textArea: {
    minHeight: 112,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  fieldError: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  checkboxRow: {
    minHeight: touchTarget.minHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.ustpNavy,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: colors.ustpNavy,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  secondaryBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  primarySmallBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySmallBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  primarySubmitBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: 108,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySubmitBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  dangerConfirmBtn: {
    minHeight: touchTarget.minHeight,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerConfirmBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  confirmDesc: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.mutedSlate,
  },
  confirmHashtag: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
});
