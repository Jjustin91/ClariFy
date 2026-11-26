import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnnouncementCard } from '@/components/AnnouncementCard';
import { AnnouncementFormModal } from '@/components/AnnouncementFormModal';
import { ClassFaqsDrawer } from '@/components/ClassFaqsDrawer';
import { CourseHubChatView } from '@/components/CourseHubChatView';
import {
  CourseHubManagerModal,
  type CourseHubModalTab,
} from '@/components/CourseHubManagerModal';
import { CourseHubQaView } from '@/components/CourseHubQaView';
import { CourseHubSettingsModal } from '@/components/CourseHubSettingsModal';
import { MobileAppShell } from '@/components/MobileAppShell';
import { ScopedChannelsDrawer } from '@/components/ScopedChannelsDrawer';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { useChannels } from '@/context/ChannelsContext';
import { useOptionalRealtime } from '@/context/RealtimeContext';
import { useAnnouncementsFeed } from '@/hooks/useAnnouncementsFeed';
import { getChannelThreadsApi, markChannelSeenApi } from '@/lib/api-client';
import {
  canManageAnnouncement,
  canPublishOrManageAnnouncements,
  formatCourseHubName,
  formatEnrolledRosterSummary,
  formatSubChannelDisplayName,
  getChannelFacultyLabel,
  getChannelParentHubId,
  getSubChannelsForHub,
  isUserCourseAdmin,
  resolveCourseHubSelection,
} from '@/lib/domain-logic';
import { getChannelMembersCount } from '@/lib/feed-reducer';
import {
  courseQaReducer,
  createInitialCourseQaState,
  extractPublishedFaqs,
  resolveActiveChatChannelId,
  sanitizeThreadForPrivacy,
} from '@/lib/qa-reducer';
import { computeDebouncedRefreshDelayMs } from '@/lib/realtime-reducer';
import {
  subscribeChannelReverb,
  type ReverbBroadcastPayload,
} from '@/lib/reverb-client';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { Announcement, ApiError, Channel, QaThread } from '@/types/api';

type HubSpaceKey = 'noticeboard' | 'qa' | 'chat';

/**
 * ClariFy Mobile Course Hub screen ported from clarify-web/app/channels/[channelId]/page.tsx.
 * - Left Course Hubs drawer switches between Noticeboard Feed, Isolated Q&A Threads,
 *   and custom `#channels` (matching clarify-web; no 3-button segmented tab bar).
 * - Top bar includes the Course Hub switcher pill and right-hand Class FAQs (N) slide-over drawer.
 * - Course Hub Header Bar displays hub title, active space, Course Admin Edit shortcut,
 *   and Settings & Roster gear button with live pending-requests badge.
 * - Unified CourseHubManagerModal handles Browse Course Hubs, Add Course Hub,
 *   Edit/Delete Course Hub, and Add Channel.
 */
export default function MobileChannelHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId?: string; tab?: string }>();
  const rawChannelParam = params?.channelId;
  const parsedRequestedId = Number(rawChannelParam ?? 0);
  const hasExplicitId =
    rawChannelParam !== undefined &&
    rawChannelParam !== '' &&
    rawChannelParam !== '0';
  const isMalformedId =
    hasExplicitId &&
    (!Number.isInteger(parsedRequestedId) || parsedRequestedId <= 0);
  const requestedChannelId = isMalformedId ? -1 : parsedRequestedId;

  const { user } = useAuth();
  const {
    channels,
    joinedCourseHubs,
    isLoadingChannels,
    isRefreshingChannels,
    channelsError,
    refreshChannels,
    applyChannelsPatch,
    rosterByChannelId,
    refreshChannelRoster,
  } = useChannels();
  const realtime = useOptionalRealtime();

  // Overlays & navigation state
  const [isChannelsDrawerOpen, setIsChannelsDrawerOpen] = useState(false);
  const [isFaqsDrawerOpen, setIsFaqsDrawerOpen] = useState(false);
  const [highlightedFaqId, setHighlightedFaqId] = useState<number | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [managerModalState, setManagerModalState] = useState<{
    visible: boolean;
    initialTab: CourseHubModalTab;
    targetHubId: number | null;
  }>({
    visible: false,
    initialTab: 'browse',
    targetHubId: null,
  });
  const [announcementComposerState, setAnnouncementComposerState] = useState<{
    visible: boolean;
    editingAnnouncement: Announcement | null;
  }>({
    visible: false,
    editingAnnouncement: null,
  });

  const [activeSpace, setActiveSpace] = useState<HubSpaceKey>(() => {
    if (params?.tab === 'chat') return 'chat';
    if (params?.tab === 'qa') return 'qa';
    return 'noticeboard';
  });
  const [selectedSubChannelId, setSelectedSubChannelId] = useState<
    number | null
  >(null);
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [seenBaselineByHub, setSeenBaselineByHub] = useState<
    Record<number, string | null>
  >({});
  const [lastHandledRouteKey, setLastHandledRouteKey] = useState<string>(
    `${rawChannelParam ?? ''}:${params?.tab ?? ''}`
  );

  // Class FAQs thread state (shared across Noticeboard, Q&A, and Chat spaces)
  const [faqState, dispatchFaq] = useReducer(
    courseQaReducer,
    0,
    createInitialCourseQaState
  );
  const [appActiveEpoch, setAppActiveEpoch] = useState(0);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const faqFetchInFlightRef = useRef<Promise<void> | null>(null);
  const faqSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectiveHubIdRef = useRef<number>(0);

  // Resolve active hub strictly: if an explicit non-zero channelId was requested and is missing
  // once channels finish loading, report a 404 error and NEVER fall back to another Course Hub.
  const resolution = useMemo<{
    activeHub: Channel | undefined;
    requestedSubChannel: Channel | undefined;
    isInvalidChannel: boolean;
  }>(() => {
    if (isMalformedId) {
      return {
        activeHub: undefined,
        requestedSubChannel: undefined,
        isInvalidChannel: true,
      };
    }

    if (hasExplicitId && requestedChannelId > 0) {
      const exactMatch = channels.find(
        (c) => Number(c.id) === requestedChannelId
      );
      if (!exactMatch) {
        return {
          activeHub: undefined,
          requestedSubChannel: undefined,
          isInvalidChannel: !isLoadingChannels && !channelsError,
        };
      }

      const parentHubId = getChannelParentHubId(exactMatch);
      if (parentHubId !== null) {
        const parentHub =
          channels.find((c) => Number(c.id) === parentHubId) ?? exactMatch;
        return {
          activeHub: parentHub,
          requestedSubChannel: exactMatch,
          isInvalidChannel: false,
        };
      }

      return {
        activeHub: exactMatch,
        requestedSubChannel: undefined,
        isInvalidChannel: false,
      };
    }

    // Generic entry (`/channels/0` or missing param) selects user's primary joined hub
    const base = resolveCourseHubSelection(channels, 0, user);
    return {
      activeHub: base.activeChannel,
      requestedSubChannel: base.activeSubChannel,
      isInvalidChannel: false,
    };
  }, [
    isMalformedId,
    hasExplicitId,
    requestedChannelId,
    channels,
    isLoadingChannels,
    channelsError,
    user,
  ]);

  const activeChannel = resolution.activeHub;
  const effectiveHubId = activeChannel?.id ?? 0;

  useEffect(() => {
    effectiveHubIdRef.current = effectiveHubId;
  }, [effectiveHubId]);

  // Sync space & sub-channel selection when navigating to a new route or deep-linking directly to a sub-channel
  const routeSyncKey = `${rawChannelParam ?? ''}:${params?.tab ?? ''}:${resolution.requestedSubChannel?.id ?? ''}`;
  if (routeSyncKey !== lastHandledRouteKey) {
    setLastHandledRouteKey(routeSyncKey);
    if (params?.tab === 'qa') {
      setActiveSpace('qa');
      setSelectedSubChannelId(null);
    } else if (params?.tab === 'chat' || resolution.requestedSubChannel) {
      setActiveSpace('chat');
      setSelectedSubChannelId(resolution.requestedSubChannel?.id ?? null);
    } else if (params?.tab === 'noticeboard' || params?.tab === 'feed') {
      setActiveSpace('noticeboard');
      setSelectedSubChannelId(null);
    }
  }

  const subChannels = useMemo(
    () =>
      effectiveHubId > 0
        ? getSubChannelsForHub(channels, effectiveHubId)
        : [],
    [channels, effectiveHubId]
  );

  // Real chat sub-channels only (never falls back to hub.id or a synthetic "# general")
  const { activeChatChannel, activeChatChannelId } = useMemo(
    () =>
      resolveActiveChatChannelId(
        activeChannel,
        subChannels,
        selectedSubChannelId ?? resolution.requestedSubChannel?.id
      ),
    [
      activeChannel,
      subChannels,
      selectedSubChannelId,
      resolution.requestedSubChannel,
    ]
  );

  // Reset stale selectedSubChannelId (e.g., equal to hub.id or a removed sub-channel)
  if (
    selectedSubChannelId !== null &&
    selectedSubChannelId !== activeChatChannelId
  ) {
    setSelectedSubChannelId(activeChatChannelId ?? null);
  }

  // Class FAQs thread fetcher (de-duplicated, AppState-aware)
  const clearFaqSyncTimer = useCallback(() => {
    if (faqSyncTimerRef.current) {
      clearTimeout(faqSyncTimerRef.current);
      faqSyncTimerRef.current = null;
    }
  }, []);

  const fetchHubThreadsForFaqs = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (effectiveHubId <= 0 || resolution.isInvalidChannel) return;
      if (mode === 'silent' && !isAppActiveRef.current) return;
      if (faqFetchInFlightRef.current) {
        return faqFetchInFlightRef.current;
      }

      if (mode === 'initial') {
        dispatchFaq({ type: 'LOAD_START' });
      } else if (mode === 'refresh') {
        dispatchFaq({ type: 'REFRESH_START' });
      }

      const targetHubId = effectiveHubId;
      const req = (async () => {
        try {
          const res = await getChannelThreadsApi(targetHubId);
          if (effectiveHubIdRef.current !== targetHubId) return;
          dispatchFaq({
            type: 'LOAD_SUCCESS',
            channelId: targetHubId,
            threads: Array.isArray(res.data) ? res.data : [],
          });
        } catch (err) {
          if (effectiveHubIdRef.current !== targetHubId) return;
          const apiErr = err as ApiError;
          dispatchFaq({
            type: 'LOAD_ERROR',
            error: apiErr?.message
              ? apiErr
              : {
                  status: apiErr?.status ?? 500,
                  message: 'Could not load Class FAQs for this Course Hub.',
                },
          });
        } finally {
          faqFetchInFlightRef.current = null;
        }
      })();

      faqFetchInFlightRef.current = req;
      return req;
    },
    [effectiveHubId, resolution.isInvalidChannel]
  );

  const scheduleFaqDebouncedSync = useCallback(() => {
    if (
      !isAppActiveRef.current ||
      !isScreenFocused ||
      effectiveHubId <= 0 ||
      resolution.isInvalidChannel
    ) {
      return;
    }
    if (faqSyncTimerRef.current) return;
    const delayMs = computeDebouncedRefreshDelayMs();
    faqSyncTimerRef.current = setTimeout(() => {
      faqSyncTimerRef.current = null;
      if (!isAppActiveRef.current || !isScreenFocused) return;
      void fetchHubThreadsForFaqs('silent');
    }, delayMs);
  }, [
    effectiveHubId,
    isScreenFocused,
    resolution.isInvalidChannel,
    fetchHubThreadsForFaqs,
  ]);

  // Reset & fetch Class FAQs whenever the active Course Hub changes
  useEffect(() => {
    clearFaqSyncTimer();
    dispatchFaq({ type: 'RESET_FOR_CHANNEL', channelId: effectiveHubId });

    if (
      effectiveHubId > 0 &&
      !resolution.isInvalidChannel &&
      user &&
      user.role !== 'it_admin'
    ) {
      void fetchHubThreadsForFaqs('initial');
    }

    return () => {
      clearFaqSyncTimer();
    };
  }, [
    effectiveHubId,
    resolution.isInvalidChannel,
    user,
    fetchHubThreadsForFaqs,
    clearFaqSyncTimer,
  ]);

  // AppState pause / resume single refresh for Class FAQs when not on Q&A tab
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = isAppActiveRef.current;
      const isNowActive = nextState === 'active';
      isAppActiveRef.current = isNowActive;
      if (!isNowActive) {
        clearFaqSyncTimer();
      } else if (
        !wasActive &&
        isScreenFocused &&
        effectiveHubId > 0 &&
        !resolution.isInvalidChannel
      ) {
        setAppActiveEpoch((prev) => prev + 1);
        if (activeSpace !== 'qa') {
          void fetchHubThreadsForFaqs('silent');
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [
    isScreenFocused,
    effectiveHubId,
    resolution.isInvalidChannel,
    activeSpace,
    fetchHubThreadsForFaqs,
    clearFaqSyncTimer,
  ]);

  // Keep Class FAQs count & drawer synced over private Reverb when viewing Noticeboard or Chat
  useEffect(() => {
    if (
      !isScreenFocused ||
      activeSpace === 'qa' ||
      effectiveHubId <= 0 ||
      resolution.isInvalidChannel ||
      !isAppActiveRef.current
    ) {
      return;
    }

    const unsubscribe = subscribeChannelReverb(
      effectiveHubId,
      (payload: ReverbBroadcastPayload) => {
        if (!isAppActiveRef.current) return;
        if (
          payload.channel_id &&
          Number(payload.channel_id) !== effectiveHubId
        ) {
          return;
        }
        if (
          payload.type === 'thread.created' ||
          payload.type === 'thread.updated' ||
          payload.type === 'thread.replied' ||
          payload.type === 'thread.faq_pinned'
        ) {
          if (payload.thread && typeof payload.thread.id === 'number') {
            dispatchFaq({
              type: 'UPSERT_THREAD',
              thread: sanitizeThreadForPrivacy(payload.thread),
            });
          } else {
            scheduleFaqDebouncedSync();
          }
        } else if (payload.type === 'thread.deleted') {
          const deletedId = Number(
            payload.thread?.id ?? payload.message_id ?? 0
          );
          if (deletedId > 0) {
            dispatchFaq({ type: 'REMOVE_THREAD', threadId: deletedId });
          } else {
            scheduleFaqDebouncedSync();
          }
        }
      }
    );

    return () => {
      unsubscribe();
      clearFaqSyncTimer();
    };
  }, [
    isScreenFocused,
    activeSpace,
    effectiveHubId,
    resolution.isInvalidChannel,
    appActiveEpoch,
    scheduleFaqDebouncedSync,
    clearFaqSyncTimer,
  ]);

  const seenKeyRef = useRef<string>('');
  const setActiveChannelId = realtime?.setActiveChannelId;

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);

      const seenTargetChannelId =
        activeSpace === 'chat' &&
        typeof activeChatChannelId === 'number' &&
        activeChatChannelId > 0
          ? activeChatChannelId
          : effectiveHubId;

      if (
        !resolution.isInvalidChannel &&
        effectiveHubId > 0 &&
        seenTargetChannelId > 0 &&
        user &&
        user.role !== 'it_admin'
      ) {
        setActiveChannelId?.(effectiveHubId);
        // On-demand roster fetch so Course Admins see live pending-request badge counts
        void refreshChannelRoster(effectiveHubId);

        const focusSeenKey = `${user.id}:${seenTargetChannelId}`;
        if (seenKeyRef.current !== focusSeenKey) {
          seenKeyRef.current = focusSeenKey;
          void markChannelSeenApi(seenTargetChannelId)
            .then((previousSeenAt) => {
              setSeenBaselineByHub((prev) =>
                effectiveHubId in prev
                  ? prev
                  : {
                      ...prev,
                      [effectiveHubId]: previousSeenAt ?? null,
                    }
              );

              applyChannelsPatch((prev) => {
                let mutated = false;
                const next = prev.map((ch) => {
                  if (Number(ch.id) !== effectiveHubId) return ch;
                  if (
                    !ch.has_updates &&
                    (ch.new_activity_count ?? 0) === 0 &&
                    (ch.unread_count ?? 0) === 0
                  ) {
                    return ch;
                  }
                  mutated = true;
                  return {
                    ...ch,
                    has_updates: false,
                    new_activity_count: 0,
                    unread_count: 0,
                    new_activity_breakdown: {
                      chat: 0,
                      announcements: 0,
                      qa: 0,
                    },
                    new_activity_sub_channel_id: null,
                  };
                });
                return { channels: mutated ? next : prev, mutated };
              });
            })
            .catch(() => {
              // Non-fatal: chat/feed/qa views surface 403/network errors cleanly
            });
        }
      }

      return () => {
        setIsScreenFocused(false);
        seenKeyRef.current = '';
        setActiveChannelId?.(0);
      };
    }, [
      resolution.isInvalidChannel,
      effectiveHubId,
      activeSpace,
      activeChatChannelId,
      user,
      setActiveChannelId,
      applyChannelsPatch,
      refreshChannelRoster,
    ])
  );

  const feed = useAnnouncementsFeed({
    channelId:
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? effectiveHubId
        : null,
    sort: 'latest',
    perPage: 10,
    enabled: Boolean(
      user &&
        user.role !== 'it_admin' &&
        !resolution.isInvalidChannel &&
        effectiveHubId > 0
    ),
  });

  // Modal launchers
  const openManagerModal = useCallback(
    (initialTab: CourseHubModalTab, targetHubId?: number | null) => {
      setManagerModalState({
        visible: true,
        initialTab,
        targetHubId: targetHubId ?? (effectiveHubId > 0 ? effectiveHubId : null),
      });
    },
    [effectiveHubId]
  );

  const closeManagerModal = useCallback(() => {
    setManagerModalState((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleOpenClassFaqs = useCallback((highlightFaqId?: number) => {
    setHighlightedFaqId(highlightFaqId ?? null);
    setIsFaqsDrawerOpen(true);
  }, []);

  const handleQaThreadsSynced = useCallback(
    (syncedThreads: QaThread[]) => {
      if (effectiveHubId <= 0) return;
      dispatchFaq({
        type: 'LOAD_SUCCESS',
        channelId: effectiveHubId,
        threads: syncedThreads,
      });
    },
    [effectiveHubId]
  );

  const handleSelectHub = useCallback(
    (hubId: number, tab: HubSpaceKey = 'noticeboard') => {
      setSelectedSubChannelId(null);
      setActiveSpace(tab);
      if (hubId !== effectiveHubId) {
        router.replace(`/channels/${hubId}?tab=${tab}` as never);
      }
    },
    [effectiveHubId, router]
  );

  const handleSelectQa = useCallback(
    (hubId: number) => {
      setSelectedSubChannelId(null);
      setActiveSpace('qa');
      if (hubId !== effectiveHubId) {
        router.replace(`/channels/${hubId}?tab=qa` as never);
      }
    },
    [effectiveHubId, router]
  );

  const handleSelectSubChannel = useCallback(
    (hubId: number, subChannelId: number) => {
      if (subChannelId <= 0 || subChannelId === hubId) {
        return;
      }
      setSelectedSubChannelId(subChannelId);
      setActiveSpace('chat');
      if (hubId !== effectiveHubId) {
        router.replace(`/channels/${subChannelId}?tab=chat` as never);
      }
    },
    [effectiveHubId, router]
  );

  const handleHubRemovedOrLeft = useCallback(
    (removedHubId: number) => {
      const remaining = joinedCourseHubs.filter((h) => h.id !== removedHubId);
      if (remaining.length > 0) {
        setSelectedSubChannelId(null);
        setActiveSpace('noticeboard');
        router.replace(`/channels/${remaining[0].id}?tab=noticeboard` as never);
      } else {
        setSelectedSubChannelId(null);
        setActiveSpace('noticeboard');
        router.replace('/channels/0' as never);
      }
    },
    [joinedCourseHubs, router]
  );

  const handleSubChannelDeleted = useCallback(
    (hubId: number, deletedSubId: number) => {
      if (
        hubId === effectiveHubId &&
        activeSpace === 'chat' &&
        activeChatChannelId === deletedSubId
      ) {
        setSelectedSubChannelId(null);
        setActiveSpace('noticeboard');
      }
    },
    [effectiveHubId, activeSpace, activeChatChannelId]
  );

  const handleRefreshAll = useCallback(() => {
    void Promise.all([
      refreshChannels(),
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? feed.refresh()
        : Promise.resolve(),
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? fetchHubThreadsForFaqs('refresh')
        : Promise.resolve(),
      !resolution.isInvalidChannel && effectiveHubId > 0
        ? refreshChannelRoster(effectiveHubId)
        : Promise.resolve(),
    ]);
  }, [
    refreshChannels,
    resolution.isInvalidChannel,
    effectiveHubId,
    feed,
    fetchHubThreadsForFaqs,
    refreshChannelRoster,
  ]);

  const canManageHubAnnouncements = Boolean(
    user && canPublishOrManageAnnouncements(user.role)
  );

  const handleOpenCreateAnnouncement = useCallback(() => {
    setAnnouncementComposerState({
      visible: true,
      editingAnnouncement: null,
    });
  }, []);

  const handleOpenEditAnnouncement = useCallback((announcement: Announcement) => {
    setAnnouncementComposerState({
      visible: true,
      editingAnnouncement: announcement,
    });
  }, []);

  const handleCloseAnnouncementComposer = useCallback(() => {
    setAnnouncementComposerState({
      visible: false,
      editingAnnouncement: null,
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Announcement }) => {
      const canManageItem = canManageAnnouncement(item, user, channels);
      return (
        <AnnouncementCard
          announcement={item}
          channels={channels}
          isAckLoading={feed.ackLoadingIds.includes(item.id)}
          isDeleting={feed.deletingIds.includes(item.id)}
          onAcknowledge={feed.acknowledge}
          onEdit={canManageItem ? handleOpenEditAnnouncement : undefined}
          onDelete={canManageItem ? feed.deleteAnnouncement : undefined}
        />
      );
    },
    [
      user,
      channels,
      feed.ackLoadingIds,
      feed.deletingIds,
      feed.acknowledge,
      feed.deleteAnnouncement,
      handleOpenEditAnnouncement,
    ]
  );

  const keyExtractor = useCallback((item: Announcement) => String(item.id), []);

  const detailedActiveHub =
    effectiveHubId > 0
      ? (rosterByChannelId[effectiveHubId] ?? activeChannel)
      : activeChannel;
  const isCourseAdmin = isUserCourseAdmin(detailedActiveHub, user);
  const pendingRequestsCount = isCourseAdmin
    ? (detailedActiveHub?.pending_requests?.length ?? 0)
    : 0;
  const membersCount = getChannelMembersCount(detailedActiveHub);
  const publishedFaqsCount = useMemo(
    () => extractPublishedFaqs(faqState.threads).length,
    [faqState.threads]
  );

  const previousSeenAtForHub =
    effectiveHubId > 0 ? (seenBaselineByHub[effectiveHubId] ?? null) : null;

  const activeSpaceDisplayLabel = useMemo(() => {
    if (activeSpace === 'qa') return 'Isolated Q&A Threads';
    if (activeSpace === 'chat') {
      return activeChatChannel
        ? formatSubChannelDisplayName(activeChatChannel)
        : 'No chat channels yet';
    }
    return 'Noticeboard Feed';
  }, [activeSpace, activeChatChannel]);

  const activeSpaceShortLabel = useMemo(() => {
    if (activeSpace === 'qa') return 'Q&A';
    if (activeSpace === 'chat') {
      return activeChatChannel
        ? formatSubChannelDisplayName(activeChatChannel)
        : 'Chat';
    }
    return 'Noticeboard';
  }, [activeSpace, activeChatChannel]);

  const shellTitle = resolution.isInvalidChannel
    ? 'Course Hub Not Found'
    : activeChannel
      ? formatCourseHubName(activeChannel)
      : 'Course Hubs';

  const notFoundError: ApiError = useMemo(
    () => ({
      status: 404,
      message: `Course Hub #${rawChannelParam || requestedChannelId} was not found or is no longer available.`,
    }),
    [rawChannelParam, requestedChannelId]
  );

  const showZeroJoinedOnboarding =
    !isLoadingChannels &&
    !channelsError &&
    !resolution.isInvalidChannel &&
    !activeChannel;

  const renderHubHeader = () => (
    <View style={styles.hubInfoWrap}>
      {activeChannel && (
        <View style={styles.hubSummaryCard}>
          <View style={styles.hubSummaryTopRow}>
            <View style={styles.hubSummaryTitleWrap}>
              <Text style={styles.hubSummaryTitle}>
                {formatCourseHubName(activeChannel)}
              </Text>
              <Text style={styles.hubSummaryScope}>
                {[
                  activeChannel.course_code,
                  activeChannel.scope_college,
                  activeChannel.scope_section,
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            </View>
            <View style={styles.noticeboardBadge}>
              <Text style={styles.noticeboardBadgeText}>Noticeboard</Text>
            </View>
          </View>

          <Text style={styles.hubSummaryFaculty}>
            Faculty: {getChannelFacultyLabel(activeChannel)}
          </Text>
          <Text style={styles.hubSummaryMembers}>
            {formatEnrolledRosterSummary(activeChannel)}
          </Text>
        </View>
      )}

      {/* Faculty / Dept Head Course Hub Announcement Create Trigger (Strictly Hidden for Students) */}
      {activeChannel &&
        effectiveHubId > 0 &&
        canManageHubAnnouncements &&
        isCourseAdmin && (
          <Pressable
            onPress={handleOpenCreateAnnouncement}
            accessibilityRole="button"
            accessibilityLabel={`Create announcement in ${formatCourseHubName(activeChannel)}`}
            style={({ pressed }) => [
              styles.hubCreateAnnouncementBar,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.hubCreateAnnouncementLeft}>
              <View style={styles.hubCreateAnnouncementBadge}>
                <Feather name="plus" size={14} color={colors.ustpGold} />
              </View>
              <Text style={styles.hubCreateAnnouncementText}>
                Create Course Hub Announcement
              </Text>
            </View>
            <View style={styles.hubCreateAnnouncementIcons}>
              <Feather name="file-text" size={16} color={colors.ustpNavy} />
              <Feather name="image" size={16} color={colors.ustpNavy} />
            </View>
          </Pressable>
        )}

      {feed.error && feed.items.length > 0 && activeSpace === 'noticeboard' && (
        <ErrorBanner error={feed.error} onRetry={feed.retry} />
      )}
    </View>
  );

  const renderNoticeboardEmpty = () => {
    if (isLoadingChannels || (effectiveHubId > 0 && feed.isLoading)) {
      return <SkeletonCards count={3} />;
    }
    if (channelsError) {
      return (
        <ErrorBanner
          error={channelsError}
          onRetry={() => void refreshChannels()}
        />
      );
    }
    if (!activeChannel || effectiveHubId <= 0) {
      return (
        <EmptyState
          title="No Course Hub Selected"
          description="Open Course Hubs to browse, join, or create a Course Hub."
          actionLabel="Browse Course Hubs"
          onAction={() => openManagerModal('browse', null)}
        />
      );
    }
    if (feed.error) {
      return <ErrorBanner error={feed.error} onRetry={feed.retry} />;
    }
    return (
      <EmptyState
        title="No Announcements in This Course Hub"
        description={`Official notices posted to ${formatCourseHubName(
          activeChannel
        )} will appear here.`}
      />
    );
  };

  const renderNoticeboardFooter = () => {
    if (feed.isLoading || feed.items.length === 0) {
      return null;
    }
    if (feed.isLoadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.ustpNavy} />
          <Text style={styles.footerText}>Loading older announcements...</Text>
        </View>
      );
    }
    return (
      <View style={styles.footerSummary}>
        <Text style={styles.footerText}>
          Showing {feed.items.length} of {feed.meta.total}{' '}
          {feed.meta.total === 1 ? 'announcement' : 'announcements'} • Page{' '}
          {feed.meta.current_page} of {Math.max(1, feed.meta.last_page)}
        </Text>
        {feed.hasMore && (
          <Pressable
            onPress={() => void feed.loadMore()}
            accessibilityRole="button"
            accessibilityLabel="Load more channel announcements"
            style={({ pressed }) => [
              styles.loadMoreBtn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.loadMoreBtnText}>Load More</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <MobileAppShell title={shellTitle}>
      {/* Top Navy Course Hubs Switcher + Class FAQs (N) Button */}
      <View style={styles.switcherBar}>
        <Pressable
          onPress={() => setIsChannelsDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open Course Hubs drawer"
          style={({ pressed }) => [
            styles.switcherButton,
            pressed && styles.pressed,
          ]}
        >
          <Feather name="hash" size={16} color={colors.ustpGold} />
          <Text numberOfLines={1} style={styles.switcherButtonText}>
            {resolution.isInvalidChannel
              ? 'Select a valid Course Hub'
              : activeChannel
                ? `${formatCourseHubName(activeChannel)} • ${activeSpaceShortLabel}`
                : 'Course Hubs'}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.ustpGold} />
        </Pressable>

        {activeChannel && !resolution.isInvalidChannel && (
          <Pressable
            onPress={() => handleOpenClassFaqs()}
            accessibilityRole="button"
            accessibilityLabel={`Open Class FAQs, ${publishedFaqsCount} published`}
            style={({ pressed }) => [
              styles.faqsTopBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="book-open" size={14} color={colors.ustpGold} />
            <Text style={styles.faqsTopBtnText}>
              Class FAQs ({publishedFaqsCount})
            </Text>
          </Pressable>
        )}
      </View>

      {/* Compact Course Hub Header Bar: Hub + Space | Settings Gear */}
      {activeChannel && !resolution.isInvalidChannel && (
        <View style={styles.hubHeaderBar}>
          <View style={styles.hubHeaderBarCopy}>
            <Text numberOfLines={1} style={styles.hubHeaderBarTitle}>
              {formatCourseHubName(activeChannel)}
            </Text>
            <Text numberOfLines={1} style={styles.hubHeaderBarSubtitle}>
              {activeSpaceDisplayLabel} • {membersCount}{' '}
              {membersCount === 1 ? 'member' : 'members'}
            </Text>
          </View>

          <View style={styles.hubHeaderBarActions}>
            <Pressable
              onPress={() => setIsSettingsModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                pendingRequestsCount > 0
                  ? `Course Hub Settings and Roster, ${pendingRequestsCount} pending join requests`
                  : 'Course Hub Settings and Roster'
              }
              style={({ pressed }) => [
                styles.headerActionIconBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="settings" size={18} color={colors.ustpNavy} />
              {pendingRequestsCount > 0 && (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>
                    {pendingRequestsCount > 99 ? '99+' : pendingRequestsCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {/* Main Content Area: 404 Guard | Onboarding | Q&A | Chat | Noticeboard Feed */}
      {resolution.isInvalidChannel ? (
        <View style={styles.invalidWrap}>
          <ErrorBanner
            error={notFoundError}
            onRetry={() => void refreshChannels()}
          />
          <Pressable
            onPress={() => setIsChannelsDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open Course Hubs"
            style={({ pressed }) => [
              styles.openChannelsBtn,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="hash" size={16} color={colors.ustpGold} />
            <Text style={styles.openChannelsBtnText}>Open Course Hubs</Text>
          </Pressable>
        </View>
      ) : showZeroJoinedOnboarding ? (
        <View style={styles.onboardingWrap}>
          <View style={styles.onboardingCard}>
            <View style={styles.onboardingIconWrap}>
              <Feather name="compass" size={26} color={colors.ustpNavy} />
            </View>
            <Text style={styles.onboardingTitle}>
              Join or Create a Course Hub
            </Text>
            <Text style={styles.onboardingBody}>
              You have not joined any Course Hubs yet. Browse existing campus
              Course Hubs to request membership, or create a new Course Hub for
              your class section.
            </Text>
            <View style={styles.onboardingActions}>
              <Pressable
                onPress={() => openManagerModal('browse', null)}
                accessibilityRole="button"
                accessibilityLabel="Browse Course Hubs"
                style={({ pressed }) => [
                  styles.onboardingPrimaryBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="compass" size={16} color={colors.ustpGold} />
                <Text style={styles.onboardingPrimaryText}>
                  Browse Course Hubs
                </Text>
              </Pressable>

              <Pressable
                onPress={() => openManagerModal('create_hub', null)}
                accessibilityRole="button"
                accessibilityLabel="Add Course Hub"
                style={({ pressed }) => [
                  styles.onboardingSecondaryBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="folder-plus" size={16} color={colors.ustpNavy} />
                <Text style={styles.onboardingSecondaryText}>
                  Add Course Hub
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : activeSpace === 'qa' && activeChannel && effectiveHubId > 0 ? (
        <CourseHubQaView
          channelId={effectiveHubId}
          channelTitle={formatCourseHubName(activeChannel)}
          isFocused={isScreenFocused && activeSpace === 'qa'}
          previousSeenAt={previousSeenAtForHub}
          onThreadsSynced={handleQaThreadsSynced}
          onOpenClassFaqs={handleOpenClassFaqs}
        />
      ) : activeSpace === 'chat' ? (
        isLoadingChannels ? (
          <View style={styles.chatStateWrap}>
            <SkeletonCards count={3} />
          </View>
        ) : channelsError ? (
          <View style={styles.chatStateWrap}>
            <ErrorBanner
              error={channelsError}
              onRetry={() => void refreshChannels()}
            />
          </View>
        ) : activeChatChannel &&
          typeof activeChatChannelId === 'number' &&
          activeChatChannelId > 0 ? (
          <View style={styles.chatTabContainer}>
            <CourseHubChatView
              channelId={activeChatChannelId}
              channelTitle={formatSubChannelDisplayName(activeChatChannel)}
              isFocused={isScreenFocused && activeSpace === 'chat'}
            />
          </View>
        ) : (
          <View style={styles.chatStateWrap}>
            <EmptyState
              title="No chat channels yet"
              description={
                isCourseAdmin
                  ? `Create a chat channel inside ${
                      activeChannel
                        ? formatCourseHubName(activeChannel)
                        : 'this Course Hub'
                    } to start messaging with your class.`
                  : 'No chat channels have been created for this Course Hub yet.'
              }
              actionLabel={isCourseAdmin ? 'Add Channel' : undefined}
              onAction={
                isCourseAdmin && effectiveHubId > 0
                  ? () => openManagerModal('create_channel', effectiveHubId)
                  : undefined
              }
            />
          </View>
        )
      ) : (
        <FlatList
          data={
            isLoadingChannels || feed.isLoading || effectiveHubId <= 0
              ? []
              : feed.items
          }
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={renderHubHeader}
          ListEmptyComponent={renderNoticeboardEmpty}
          ListFooterComponent={renderNoticeboardFooter}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefreshing || isRefreshingChannels}
              onRefresh={handleRefreshAll}
              tintColor={colors.ustpNavy}
              colors={[colors.ustpNavy]}
            />
          }
          onEndReached={() => void feed.loadMore()}
          onEndReachedThreshold={0.4}
        />
      )}

      {/* Left Course Hubs Drawer */}
      <ScopedChannelsDrawer
        visible={isChannelsDrawerOpen}
        onClose={() => setIsChannelsDrawerOpen(false)}
        channels={channels}
        activeChannel={activeChannel}
        activeTab={activeSpace}
        activeChatChannelId={activeChatChannelId}
        isLoading={isLoadingChannels}
        error={channelsError}
        onRetry={() => void refreshChannels()}
        onSelectHub={(hubId) => handleSelectHub(hubId, 'noticeboard')}
        onSelectQa={handleSelectQa}
        onSelectSubChannel={handleSelectSubChannel}
        onOpenAddHub={() => openManagerModal('create_hub', null)}
        onOpenBrowseHubs={() => openManagerModal('browse', null)}
        onOpenEditHub={(hubId) => openManagerModal('edit_hub', hubId)}
        onOpenAddChannel={(hubId) => openManagerModal('create_channel', hubId)}
        onSubChannelDeleted={handleSubChannelDeleted}
      />

      {/* Right Slide-Over Class FAQs Drawer */}
      <ClassFaqsDrawer
        visible={isFaqsDrawerOpen}
        onClose={() => setIsFaqsDrawerOpen(false)}
        channelTitle={
          activeChannel ? formatCourseHubName(activeChannel) : 'Course Hub'
        }
        hasActiveChannel={Boolean(activeChannel && !resolution.isInvalidChannel)}
        threads={faqState.threads}
        isLoading={faqState.isLoading}
        error={faqState.error}
        onRetry={() => void fetchHubThreadsForFaqs('refresh')}
        highlightedFaqId={highlightedFaqId}
      />

      {/* Course Hub Settings & Roster Modal */}
      <CourseHubSettingsModal
        visible={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        hub={activeChannel}
        onOpenEditHub={(hubId) => openManagerModal('edit_hub', hubId)}
        onLeftHub={handleHubRemovedOrLeft}
      />

      {/* Unified Course Hub Manager Modal (Browse, Add Hub, Edit/Delete Hub, Add Channel) */}
      <CourseHubManagerModal
        visible={managerModalState.visible}
        initialTab={managerModalState.initialTab}
        targetHubId={managerModalState.targetHubId}
        onClose={closeManagerModal}
        onOpenHub={(hubId, tab) => handleSelectHub(hubId, tab ?? 'noticeboard')}
        onOpenSubChannel={handleSelectSubChannel}
        onDeletedHub={handleHubRemovedOrLeft}
      />

      {/* Faculty / Dept Head Announcement Composer Modal */}
      {canManageHubAnnouncements && (
        <AnnouncementFormModal
          visible={announcementComposerState.visible}
          mode={
            announcementComposerState.editingAnnouncement?.channel_type ===
            'university'
              ? 'campus_wide'
              : 'course_hub'
          }
          editingAnnouncement={announcementComposerState.editingAnnouncement}
          defaultChannelId={effectiveHubId > 0 ? effectiveHubId : null}
          onClose={handleCloseAnnouncementComposer}
          onSaved={() => void feed.refresh()}
        />
      )}
    </MobileAppShell>
  );
}

const styles = StyleSheet.create({
  switcherBar: {
    backgroundColor: colors.ustpNavyDark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.ustpNavyBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  switcherButton: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpNavyBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  switcherButtonText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  faqsTopBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavySurface,
    borderWidth: 1,
    borderColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  faqsTopBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
    ...typography.tabularNums,
  },
  hubHeaderBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hubHeaderBarCopy: {
    flex: 1,
    gap: 1,
  },
  hubHeaderBarTitle: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubHeaderBarSubtitle: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  hubHeaderBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  headerActionIconBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pendingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpOrangeDark,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.white,
    ...typography.tabularNums,
  },
  invalidWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  openChannelsBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  openChannelsBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  onboardingWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  onboardingCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  onboardingIconWrap: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpGoldSoft,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
  },
  onboardingBody: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  onboardingActions: {
    width: '100%',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  onboardingPrimaryBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  onboardingPrimaryText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  onboardingSecondaryBtn: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  onboardingSecondaryText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  chatTabContainer: {
    flex: 1,
  },
  chatStateWrap: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  hubInfoWrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  hubSummaryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs + 2,
  },
  hubSummaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hubSummaryTitleWrap: {
    flex: 1,
    gap: 2,
  },
  hubSummaryTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubSummaryScope: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  noticeboardBadge: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  noticeboardBadgeText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubSummaryFaculty: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
  },
  hubSummaryMembers: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  separator: {
    height: spacing.md,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  footerSummary: {
    paddingTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
    textAlign: 'center',
    ...typography.tabularNums,
  },
  loadMoreBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  hubCreateAnnouncementBar: {
    minHeight: touchTarget.minHeight + 4,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hubCreateAnnouncementLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hubCreateAnnouncementBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCreateAnnouncementText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  hubCreateAnnouncementIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
});
