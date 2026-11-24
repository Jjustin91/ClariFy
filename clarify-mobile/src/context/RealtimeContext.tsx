import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getAdminMetricsApi, getAnnouncementsApi } from '../lib/api-client';
import { getSubscribableCourseHubIds } from '../lib/domain-logic';
import {
  computeDebouncedRefreshDelayMs,
  getRealtimeUnavailableBannerMessage,
  normalizeReverbPayloadToEvent,
  planRealtimeEventEffects,
  reduceChannelsOnRealtimeEvent,
  resolveAdminPendingCount,
  shouldFetchAdminPendingCount,
} from '../lib/realtime-reducer';
import {
  disconnectReverb,
  getReverbConfigurationStatus,
  subscribeChannelReverb,
  subscribeGlobalReverb,
  type ReverbBroadcastPayload,
  type ReverbConnectionState,
} from '../lib/reverb-client';
import type { Announcement, RealtimeEvent } from '../types/api';
import { useAuth } from './AuthContext';
import { useChannels } from './ChannelsContext';

export type RealtimeEventListener = (event: RealtimeEvent) => void;

export interface RealtimeContextValue {
  connectionState: ReverbConnectionState | 'paused';
  isRealtimeConfigured: boolean;
  realtimeUnavailableMessage: string | null;
  announcementVersion: number;
  adminVersion: number;
  adminPendingCount: number | null;
  setAdminPendingCount: React.Dispatch<React.SetStateAction<number | null>>;
  urgentPopupAnnouncement: Announcement | null;
  dismissUrgentPopup: (announcementId?: number) => void;
  activeChannelId: number;
  setActiveChannelId: (channelId: number) => void;
  triggerAnnouncementRefresh: () => void;
  subscribeRealtimeEvents: (listener: RealtimeEventListener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(
  undefined
);

/**
 * Manages authenticated Laravel Reverb private WebSocket subscriptions
 * (`clarify.global`, `clarify.user.{id}`, `clarify.channel.{id}`),
 * patches local channel state from event payloads, schedules debounced (~1.5s + jitter)
 * de-duplicated targeted refetches, and pauses/resumes cleanly with React Native AppState.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isAuthReady, showToast } = useAuth();
  const {
    channels,
    rosterByChannelId,
    refreshChannels,
    applyChannelsPatch,
    refreshChannelRoster,
  } = useChannels();

  const reverbConfigStatus = useMemo(() => getReverbConfigurationStatus(), []);

  const [connectionState, setConnectionState] = useState<
    ReverbConnectionState | 'paused'
  >(() => (reverbConfigStatus.configured ? 'disconnected' : 'unconfigured'));
  const [announcementVersion, setAnnouncementVersion] = useState<number>(0);
  const [adminVersion, setAdminVersion] = useState<number>(0);
  const [adminPendingCount, setAdminPendingCount] = useState<number | null>(
    null
  );
  const [urgentPopupAnnouncement, setUrgentPopupAnnouncement] =
    useState<Announcement | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<number>(0);
  const [appActiveEpoch, setAppActiveEpoch] = useState<number>(0);

  const listenersRef = useRef<Set<RealtimeEventListener>>(new Set());
  const dismissedUrgentIdsRef = useRef<Set<number>>(new Set());
  const debouncedChannelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const urgentCheckInFlightRef = useRef<Promise<void> | null>(null);
  const adminPendingInFlightRef = useRef<Promise<void> | null>(null);
  const isAppActiveRef = useRef<boolean>(AppState.currentState === 'active');

  const channelsRef = useRef(channels);
  const rosterByChannelIdRef = useRef(rosterByChannelId);
  const activeChannelIdRef = useRef(activeChannelId);
  const userRef = useRef(user);

  useEffect(() => {
    channelsRef.current = channels;
    rosterByChannelIdRef.current = rosterByChannelId;
    activeChannelIdRef.current = activeChannelId;
    userRef.current = user;
  }, [channels, rosterByChannelId, activeChannelId, user]);

  const subscribeRealtimeEvents = useCallback(
    (listener: RealtimeEventListener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    []
  );

  const notifyEventListeners = useCallback((event: RealtimeEvent) => {
    listenersRef.current.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors so one screen never breaks realtime dispatch
      }
    });
  }, []);

  const clearDebouncedChannelTimer = useCallback(() => {
    if (debouncedChannelTimerRef.current) {
      clearTimeout(debouncedChannelTimerRef.current);
      debouncedChannelTimerRef.current = null;
    }
  }, []);

  const scheduleDebouncedChannelRefresh = useCallback(() => {
    if (!isAppActiveRef.current) {
      return;
    }
    if (debouncedChannelTimerRef.current) {
      // Already queued; collapse burst events into one refetch
      return;
    }
    const delayMs = computeDebouncedRefreshDelayMs();
    debouncedChannelTimerRef.current = setTimeout(() => {
      debouncedChannelTimerRef.current = null;
      if (!isAppActiveRef.current) {
        return;
      }
      void refreshChannels({ silent: true });
    }, delayMs);
  }, [refreshChannels]);

  const checkUnacknowledgedUrgentAnnouncement = useCallback(async () => {
    const activeUser = userRef.current;
    if (
      !activeUser ||
      activeUser.role === 'it_admin' ||
      !isAppActiveRef.current
    ) {
      return;
    }
    if (urgentCheckInFlightRef.current) {
      return urgentCheckInFlightRef.current;
    }

    const request = (async () => {
      try {
        const res = await getAnnouncementsApi({
          sort: 'urgent_first',
          page: 1,
          per_page: 5,
        });
        const list = Array.isArray(res?.data) ? res.data : [];
        const unackedUrgent = list.find(
          (ann) =>
            ann.is_urgent &&
            ann.status === 'published' &&
            !ann.read_reach?.has_current_user_acknowledged &&
            Number(ann.publisher?.id) !== Number(activeUser.id) &&
            !dismissedUrgentIdsRef.current.has(ann.id)
        );
        if (unackedUrgent) {
          setUrgentPopupAnnouncement(unackedUrgent);
        } else {
          setUrgentPopupAnnouncement((current) => {
            if (!current) return null;
            const updatedMatch = list.find((a) => a.id === current.id);
            return updatedMatch || current;
          });
        }
      } catch {
        // Non-fatal; feed itself handles error banners
      } finally {
        urgentCheckInFlightRef.current = null;
      }
    })();

    urgentCheckInFlightRef.current = request;
    return request;
  }, []);

  const refreshAdminPendingCount = useCallback(async () => {
    const activeUser = userRef.current;
    if (!shouldFetchAdminPendingCount(activeUser, isAppActiveRef.current)) {
      return;
    }
    if (adminPendingInFlightRef.current) {
      return adminPendingInFlightRef.current;
    }

    const request = (async () => {
      try {
        const res = await getAdminMetricsApi();
        const nextCount = resolveAdminPendingCount(
          res?.data?.pending_verifications_count
        );
        if (nextCount !== null) {
          setAdminPendingCount(nextCount);
        }
      } catch {
        // Non-fatal; AdminConsoleView itself surfaces error banners
      } finally {
        adminPendingInFlightRef.current = null;
      }
    })();

    adminPendingInFlightRef.current = request;
    return request;
  }, []);

  const dismissUrgentPopup = useCallback((announcementId?: number) => {
    setUrgentPopupAnnouncement((prev) => {
      const idToDismiss = announcementId ?? prev?.id;
      if (idToDismiss) {
        dismissedUrgentIdsRef.current.add(idToDismiss);
      }
      return null;
    });
  }, []);

  const triggerAnnouncementRefresh = useCallback(() => {
    setAnnouncementVersion((v) => v + 1);
    scheduleDebouncedChannelRefresh();
  }, [scheduleDebouncedChannelRefresh]);

  const handleIncomingRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      const currentUser = userRef.current;
      if (!currentUser) {
        return;
      }

      // 1. Patch local channels state immediately when payload provides needed data
      applyChannelsPatch((prevChannels) =>
        reduceChannelsOnRealtimeEvent(
          prevChannels,
          event,
          currentUser,
          activeChannelIdRef.current
        )
      );

      // 2. Notify active screens/hooks (chat, Q&A threads, announcement feeds)
      notifyEventListeners(event);

      // 3. Execute targeted, debounced side effects from pure planner
      const cachedRosterIds = new Set<number>(
        Object.keys(rosterByChannelIdRef.current)
          .map((key) => Number(key))
          .filter((id) => id > 0)
      );

      const plan = planRealtimeEventEffects(event, currentUser, {
        channels: channelsRef.current,
        dismissedUrgentIds: dismissedUrgentIdsRef.current,
        cachedRosterChannelIds: cachedRosterIds,
      });

      if (plan.urgentPopupCandidate) {
        setUrgentPopupAnnouncement(plan.urgentPopupCandidate);
      }
      if (
        event.type === 'announcement.acknowledged' &&
        event.announcement?.read_reach
      ) {
        const ackedAnn = event.announcement;
        setUrgentPopupAnnouncement((current) => {
          if (!current || current.id !== ackedAnn.id) return current;
          return {
            ...current,
            read_reach: {
              ...ackedAnn.read_reach,
              has_current_user_acknowledged:
                current.read_reach.has_current_user_acknowledged,
            },
          };
        });
      }
      if (plan.shouldCheckUrgentAnnouncement) {
        void checkUnacknowledgedUrgentAnnouncement();
      }
      if (plan.shouldBumpAnnouncementVersion) {
        setAnnouncementVersion((v) => v + 1);
      }
      if (plan.shouldBumpAdminVersion) {
        setAdminVersion((v) => v + 1);
        void refreshAdminPendingCount();
      }
      if (plan.shouldImmediateChannelRefresh) {
        clearDebouncedChannelTimer();
        void refreshChannels({ silent: true });
      } else if (plan.shouldScheduleChannelRefresh) {
        scheduleDebouncedChannelRefresh();
      }
      if (plan.rosterChannelIdToRefresh) {
        void refreshChannelRoster(plan.rosterChannelIdToRefresh);
      }
      if (plan.toast) {
        showToast(plan.toast.message, plan.toast.variant);
      }
    },
    [
      applyChannelsPatch,
      notifyEventListeners,
      checkUnacknowledgedUrgentAnnouncement,
      refreshAdminPendingCount,
      clearDebouncedChannelTimer,
      refreshChannels,
      scheduleDebouncedChannelRefresh,
      refreshChannelRoster,
      showToast,
    ]
  );

  // Stable key of approved Course Hub IDs so badge patches do not churn WebSocket subscriptions
  const subscribableHubIdsKey = useMemo(() => {
    if (!user) return '';
    return getSubscribableCourseHubIds(channels, user).join(',');
  }, [channels, user]);

  // Pause Reverb + pending refetches in background; reconnect & run ONE catch-up refresh on foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const nextIsActive = nextState === 'active';
      const wasActive = isAppActiveRef.current;
      isAppActiveRef.current = nextIsActive;

      if (!nextIsActive) {
        clearDebouncedChannelTimer();
        disconnectReverb();
        setConnectionState('paused');
        return;
      }

      if (!wasActive && nextIsActive) {
        setAppActiveEpoch((epoch) => epoch + 1);

        if (isAuthenticated && userRef.current) {
          if (userRef.current.role === 'it_admin') {
            setAdminVersion((v) => v + 1);
            void refreshAdminPendingCount();
          } else {
            void refreshChannels({ silent: true });
            void checkUnacknowledgedUrgentAnnouncement();
            setAnnouncementVersion((v) => v + 1);
            const currentActiveId = activeChannelIdRef.current;
            if (
              currentActiveId > 0 &&
              rosterByChannelIdRef.current[currentActiveId]
            ) {
              void refreshChannelRoster(currentActiveId);
            }
          }
        }
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );
    return () => {
      subscription.remove();
    };
  }, [
    isAuthenticated,
    clearDebouncedChannelTimer,
    refreshChannels,
    refreshChannelRoster,
    checkUnacknowledgedUrgentAnnouncement,
    refreshAdminPendingCount,
  ]);

  // Initial authenticated check (once per session):
  // - Non-admins: check for unacknowledged urgent announcements
  // - IT Admins: fetch pending verification count for drawer badge
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }
    if (!isAuthenticated || !user?.id) {
      return;
    }
    if (user.role === 'it_admin') {
      void refreshAdminPendingCount();
    } else {
      void checkUnacknowledgedUrgentAnnouncement();
    }
  }, [
    isAuthReady,
    isAuthenticated,
    user?.id,
    user?.role,
    checkUnacknowledgedUrgentAnnouncement,
    refreshAdminPendingCount,
  ]);

  // Main authenticated Reverb subscription lifecycle (tears down cleanly on logout/unmount)
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!isAuthenticated || !user?.id) {
      clearDebouncedChannelTimer();
      dismissedUrgentIdsRef.current.clear();
      disconnectReverb();
      return;
    }

    if (!isAppActiveRef.current) {
      return;
    }

    const handleReconnect = () => {
      if (!isAppActiveRef.current) return;
      if (userRef.current?.role === 'it_admin') {
        setAdminVersion((v) => v + 1);
        void refreshAdminPendingCount();
      } else {
        void refreshChannels({ silent: true });
        void checkUnacknowledgedUrgentAnnouncement();
        setAnnouncementVersion((v) => v + 1);
      }
    };

    const unsubscribeGlobal = subscribeGlobalReverb(
      (payload: ReverbBroadcastPayload) => {
        handleIncomingRealtimeEvent(normalizeReverbPayloadToEvent(payload));
      },
      user.id,
      handleReconnect,
      (nextState) => {
        setConnectionState(nextState);
      }
    );

    const hubIds = subscribableHubIdsKey
      ? subscribableHubIdsKey
          .split(',')
          .map((id) => Number(id))
          .filter((id) => id > 0)
      : [];

    const hubUnsubscribes = hubIds.map((hubId) =>
      subscribeChannelReverb(hubId, (payload: ReverbBroadcastPayload) => {
        handleIncomingRealtimeEvent(
          normalizeReverbPayloadToEvent(payload, hubId)
        );
      })
    );

    return () => {
      unsubscribeGlobal();
      hubUnsubscribes.forEach((unsub) => unsub());
    };
  }, [
    isAuthReady,
    isAuthenticated,
    user?.id,
    subscribableHubIdsKey,
    appActiveEpoch,
    clearDebouncedChannelTimer,
    handleIncomingRealtimeEvent,
    refreshChannels,
    checkUnacknowledgedUrgentAnnouncement,
    refreshAdminPendingCount,
  ]);

  // Ensure full socket disconnect on provider unmount
  useEffect(() => {
    return () => {
      clearDebouncedChannelTimer();
      disconnectReverb();
    };
  }, [clearDebouncedChannelTimer]);

  const effectiveConnectionState: ReverbConnectionState | 'paused' =
    !isAuthenticated || !user?.id
      ? 'disconnected'
      : !reverbConfigStatus.configured
        ? 'unconfigured'
        : connectionState;
  const effectiveUrgentPopup =
    isAuthenticated && user?.id && user.role !== 'it_admin'
      ? urgentPopupAnnouncement
      : null;
  const effectiveAdminPendingCount =
    isAuthenticated && user?.id && user.role === 'it_admin'
      ? adminPendingCount
      : null;
  const effectiveActiveChannelId =
    isAuthenticated && user?.id ? activeChannelId : 0;

  const realtimeUnavailableMessage = useMemo(
    () =>
      getRealtimeUnavailableBannerMessage({
        isAuthenticated: Boolean(isAuthenticated && user?.id),
        isConfigured: reverbConfigStatus.configured,
        unconfiguredMessage: reverbConfigStatus.configured
          ? null
          : reverbConfigStatus.message,
        connectionState: effectiveConnectionState,
      }),
    [
      isAuthenticated,
      user?.id,
      reverbConfigStatus,
      effectiveConnectionState,
    ]
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({
      connectionState: effectiveConnectionState,
      isRealtimeConfigured: reverbConfigStatus.configured,
      realtimeUnavailableMessage,
      announcementVersion,
      adminVersion,
      adminPendingCount: effectiveAdminPendingCount,
      setAdminPendingCount,
      urgentPopupAnnouncement: effectiveUrgentPopup,
      dismissUrgentPopup,
      activeChannelId: effectiveActiveChannelId,
      setActiveChannelId,
      triggerAnnouncementRefresh,
      subscribeRealtimeEvents,
    }),
    [
      effectiveConnectionState,
      reverbConfigStatus.configured,
      realtimeUnavailableMessage,
      announcementVersion,
      adminVersion,
      effectiveAdminPendingCount,
      effectiveUrgentPopup,
      dismissUrgentPopup,
      effectiveActiveChannelId,
      triggerAnnouncementRefresh,
      subscribeRealtimeEvents,
    ]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return ctx;
}

export function useOptionalRealtime(): RealtimeContextValue | null {
  return useContext(RealtimeContext) ?? null;
}
