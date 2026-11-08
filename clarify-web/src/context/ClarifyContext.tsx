'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type {
  Announcement,
  Channel,
  PersistenceStatus,
  RealtimeEvent,
  User,
} from '../types/api';
import {
  API_BASE_URL,
  clearStoredSession,
  getAnnouncementsApi,
  getChannelRosterApi,
  getChannelsApi,
  getMeApi,
  getPersistenceStatusApi,
  getStoredSessionUser,
  getStoredToken,
  getStoredUser,
  setStoredUser,
} from '../lib/api-client';
import {
  formatCourseHubName,
  getTopLevelCourseHubs,
  isUserCourseAdmin,
} from '../lib/domain-logic';
import {
  type ReverbBroadcastPayload,
  subscribeChannelReverb,
  subscribeGlobalReverb,
} from '../lib/reverb-client';

export interface ToastItem {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

type RealtimeEventListener = (event: RealtimeEvent) => void;

interface ClarifyContextValue {
  user: User;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  setUser: (user: User) => void;
  clearSession: () => void;
  persistenceStatus: PersistenceStatus | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChannelModalOpen: boolean;
  setIsChannelModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  channelModalTargetHubId: number | null;
  openCourseHubModal: (defaultTab?: 'browse' | 'create_hub') => void;
  openAddSubChannelModal: (hubId: number) => void;
  openEditCourseHubModal: (hubId: number) => void;
  channelModalDefaultTab: 'browse' | 'create_hub' | 'create_channel' | 'edit_hub';
  activeHubTab: 'messenger' | 'feed' | 'threads' | 'send_inquiry';
  setActiveHubTab: React.Dispatch<
    React.SetStateAction<'messenger' | 'feed' | 'threads' | 'send_inquiry'>
  >;
  announcementModalState: {
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
    mode?: 'campus_wide' | 'course_hub';
  };
  openAnnouncementModal: (options?: {
    editingAnnouncement?: Announcement | null;
    defaultChannelId?: number;
    mode?: 'campus_wide' | 'course_hub';
  }) => void;
  closeAnnouncementModal: () => void;
  urgentPopupAnnouncement: Announcement | null;
  dismissUrgentPopup: (announcementId: number) => void;
  subscribeRealtimeEvents: (listener: RealtimeEventListener) => () => void;
  channels: Channel[];
  refreshChannels: (options?: { forceImmediate?: boolean }) => Promise<Channel[]>;
  rosterChannelById: Record<number, Channel>;
  isLoadingRosterById: Record<number, boolean>;
  refreshChannelRoster: (channelId: number) => Promise<Channel | null>;
  setRosterChannelSnapshot: (channelId: number, data: Channel) => void;
  announcementVersion: number;
  triggerAnnouncementRefresh: () => void;
  toasts: ToastItem[];
  showToast: (message: string, variant?: ToastItem['variant']) => void;
  dismissToast: (id: string) => void;
}

const ClarifyContext = createContext<ClarifyContextValue | undefined>(undefined);

const GUEST_USER_PLACEHOLDER: User = {
  id: 0,
  institutional_id: '',
  name: 'Guest',
  email: '',
  contact_number: null,
  role: 'student',
  verification_status: 'pending',
  academic_profile: {
    campus: 'CDO Campus',
    college: 'CITC',
    department: 'CITC',
    program: null,
    year_level: null,
    section: null,
    semester_code: '2026-1ST-SEM',
  },
};

export function ClarifyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUserState] = useState<User>(GUEST_USER_PLACEHOLDER);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);
  const [channelModalTargetHubId, setChannelModalTargetHubId] = useState<
    number | null
  >(null);
  const [channelModalDefaultTab, setChannelModalDefaultTab] = useState<
    'browse' | 'create_hub' | 'create_channel' | 'edit_hub'
  >('create_hub');
  const [activeHubTab, setActiveHubTab] = useState<
    'messenger' | 'feed' | 'threads' | 'send_inquiry'
  >('feed');

  const openCourseHubModal = useCallback(
    (defaultTab: 'browse' | 'create_hub' = 'create_hub') => {
      setChannelModalTargetHubId(null);
      setChannelModalDefaultTab(defaultTab);
      setIsChannelModalOpen(true);
    },
    []
  );

  const openAddSubChannelModal = useCallback((hubId: number) => {
    setChannelModalTargetHubId(hubId);
    setChannelModalDefaultTab('create_channel');
    setIsChannelModalOpen(true);
  }, []);

  const openEditCourseHubModal = useCallback((hubId: number) => {
    setChannelModalTargetHubId(hubId);
    setChannelModalDefaultTab('edit_hub');
    setIsChannelModalOpen(true);
  }, []);

  // Auto-collapse navigation drawer on mobile/tablet screens (< 1024px) on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsDrawerOpen(false);
    }
  }, []);
  const [announcementModalState, setAnnouncementModalState] = useState<{
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
    mode?: 'campus_wide' | 'course_hub';
  }>({
    isOpen: false,
    editingAnnouncement: null,
    defaultChannelId: 1,
    mode: 'campus_wide',
  });
  const [urgentPopupAnnouncement, setUrgentPopupAnnouncement] =
    useState<Announcement | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rosterChannelById, setRosterChannelById] = useState<
    Record<number, Channel>
  >({});
  const [isLoadingRosterById, setIsLoadingRosterById] = useState<
    Record<number, boolean>
  >({});
  const [announcementVersion, setAnnouncementVersion] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const channelsRef = useRef<Channel[]>([]);
  const rosterChannelByIdRef = useRef<Record<number, Channel>>({});

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    rosterChannelByIdRef.current = rosterChannelById;
  }, [rosterChannelById]);

  const lastRevisionRef = useRef<number>(0);
  const dismissedUrgentIdsRef = useRef<Set<number>>(new Set());
  const eventListenersRef = useRef<Set<RealtimeEventListener>>(new Set());
  const refreshChannelsInFlightRef = useRef<Promise<Channel[]> | null>(null);
  const rosterFetchInFlightRef = useRef<Map<number, Promise<Channel | null>>>(
    new Map()
  );
  const urgentCheckInFlightRef = useRef<Promise<void> | null>(null);
  const debouncedRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pendingVisibilityRefreshRef = useRef<boolean>(false);
  const recentMembershipToastKeysRef = useRef<Map<string, number>>(new Map());

  const showToast = useCallback(
    (message: string, variant: ToastItem['variant'] = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const subscribeRealtimeEvents = useCallback(
    (listener: RealtimeEventListener) => {
      eventListenersRef.current.add(listener);
      return () => {
        eventListenersRef.current.delete(listener);
      };
    },
    []
  );

  const notifyEventListeners = useCallback((event: RealtimeEvent) => {
    eventListenersRef.current.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore subscriber error
      }
    });
  }, []);

  const dismissUrgentPopup = useCallback((announcementId: number) => {
    dismissedUrgentIdsRef.current.add(announcementId);
    setUrgentPopupAnnouncement((prev) =>
      prev && prev.id === announcementId ? null : prev
    );
  }, []);

  const setRosterChannelSnapshot = useCallback(
    (channelId: number, data: Channel) => {
      if (!channelId || !data) return;
      setRosterChannelById((prev) => {
        const next = { ...prev, [channelId]: data };
        rosterChannelByIdRef.current = next;
        return next;
      });
      setChannels((prev) => {
        const next = prev.map((ch) => {
          if (Number(ch.id) !== Number(channelId)) return ch;
          return {
            ...ch,
            members_count: data.members_count ?? ch.members_count,
            students_count: data.students_count ?? ch.students_count,
            faculty: data.faculty ?? ch.faculty,
            pending_requests: data.pending_requests ?? ch.pending_requests,
          };
        });
        channelsRef.current = next;
        return next;
      });
    },
    []
  );

  const refreshChannelRoster = useCallback(
    async (channelId: number): Promise<Channel | null> => {
      const numericId = Number(channelId);
      if (!numericId || numericId <= 0) return null;

      if (typeof document !== 'undefined' && document.hidden) {
        pendingVisibilityRefreshRef.current = true;
        return rosterChannelByIdRef.current[numericId] || null;
      }

      const existingInFlight = rosterFetchInFlightRef.current.get(numericId);
      if (existingInFlight) {
        return existingInFlight;
      }

      const sessionUser = getStoredSessionUser();
      const token = getStoredToken();
      if (!sessionUser || !token || sessionUser.role === 'it_admin') {
        return null;
      }

      setIsLoadingRosterById((prev) => ({ ...prev, [numericId]: true }));

      const promise = (async (): Promise<Channel | null> => {
        try {
          const res = await getChannelRosterApi(numericId);
          if (res?.data) {
            setRosterChannelSnapshot(numericId, res.data);
            return res.data;
          }
          return null;
        } catch {
          return rosterChannelByIdRef.current[numericId] || null;
        } finally {
          rosterFetchInFlightRef.current.delete(numericId);
          setIsLoadingRosterById((prev) => ({ ...prev, [numericId]: false }));
        }
      })();

      rosterFetchInFlightRef.current.set(numericId, promise);
      return promise;
    },
    [setRosterChannelSnapshot]
  );

  const refreshChannels = useCallback(
    async (options?: { forceImmediate?: boolean }): Promise<Channel[]> => {
      if (
        !options?.forceImmediate &&
        typeof document !== 'undefined' &&
        document.hidden
      ) {
        pendingVisibilityRefreshRef.current = true;
        return channelsRef.current;
      }

      if (refreshChannelsInFlightRef.current) {
        if (options?.forceImmediate) {
          try {
            await refreshChannelsInFlightRef.current;
          } catch {
            // Ignore prior in-flight failure and proceed with fresh fetch
          }
        } else {
          return refreshChannelsInFlightRef.current;
        }
      }

      const sessionUser = getStoredSessionUser();
      const token = getStoredToken();
      if (!sessionUser || !token || sessionUser.role === 'it_admin') {
        setChannels([]);
        channelsRef.current = [];
        return [];
      }

      const promise = (async (): Promise<Channel[]> => {
        try {
          const res = await getChannelsApi();
          const incomingList = Array.isArray(res.data) ? res.data : [];
          const mergedList = incomingList.map((ch) => {
            const rosterSnap = rosterChannelByIdRef.current[ch.id];
            const isAdmin = isUserCourseAdmin(ch, sessionUser);
            if (isAdmin && rosterSnap?.pending_requests) {
              return {
                ...ch,
                members_count: rosterSnap.members_count ?? ch.members_count,
                students_count: rosterSnap.students_count ?? ch.students_count,
                faculty: rosterSnap.faculty ?? ch.faculty,
                pending_requests: rosterSnap.pending_requests,
              };
            }
            return ch;
          });
          setChannels(mergedList);
          channelsRef.current = mergedList;

          // Keep non-admin roster snapshots in sync with latest membership status
          setRosterChannelById((prev) => {
            let mutated = false;
            const next = { ...prev };
            for (const ch of incomingList) {
              const snap = next[ch.id];
              if (!snap) continue;
              if (!isUserCourseAdmin(ch, sessionUser)) {
                const isStillApproved = (ch.roster || []).some(
                  (m) =>
                    Number(m.id) === Number(sessionUser.id) ||
                    m.institutional_id === sessionUser.institutional_id
                );
                if (!isStillApproved) {
                  delete next[ch.id];
                  mutated = true;
                }
              }
            }
            if (mutated) {
              rosterChannelByIdRef.current = next;
              return next;
            }
            return prev;
          });

          return mergedList;
        } catch {
          return channelsRef.current;
        } finally {
          refreshChannelsInFlightRef.current = null;
        }
      })();

      refreshChannelsInFlightRef.current = promise;
      return promise;
    },
    []
  );

  const scheduleDebouncedChannelRefresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      pendingVisibilityRefreshRef.current = true;
      return;
    }
    if (debouncedRefreshTimerRef.current) {
      clearTimeout(debouncedRefreshTimerRef.current);
    }
    const jitterMs = Math.floor(Math.random() * 400);
    debouncedRefreshTimerRef.current = setTimeout(() => {
      debouncedRefreshTimerRef.current = null;
      void refreshChannels();
    }, 1500 + jitterMs);
  }, [refreshChannels]);

  const refreshAdminHubRosters = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      pendingVisibilityRefreshRef.current = true;
      return;
    }
    const sessionUser = getStoredSessionUser();
    if (!sessionUser || sessionUser.role === 'it_admin') return;

    const topHubs = getTopLevelCourseHubs(channelsRef.current);
    const adminHubIds = new Set<number>();
    for (const hub of topHubs) {
      if (isUserCourseAdmin(hub, sessionUser)) {
        adminHubIds.add(Number(hub.id));
      }
    }
    for (const key of Object.keys(rosterChannelByIdRef.current)) {
      const numericId = Number(key);
      if (numericId > 0) {
        const hub = channelsRef.current.find((c) => Number(c.id) === numericId);
        if (hub && isUserCourseAdmin(hub, sessionUser)) {
          adminHubIds.add(numericId);
        }
      }
    }

    adminHubIds.forEach((hubId) => {
      void refreshChannelRoster(hubId);
    });
  }, [refreshChannelRoster]);

  const checkUnacknowledgedUrgentAnnouncement = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) {
      pendingVisibilityRefreshRef.current = true;
      return;
    }
    if (urgentCheckInFlightRef.current) {
      return urgentCheckInFlightRef.current;
    }

    const sessionUser = getStoredSessionUser();
    const token = getStoredToken();
    if (!sessionUser || !token || sessionUser.role === 'it_admin') {
      return;
    }

    const promise = (async () => {
      try {
        const res = await getAnnouncementsApi({
          sort: 'latest',
          page: 1,
          per_page: 6,
        });
        const urgentCandidate = res.data.find(
          (ann) =>
            ann.is_urgent &&
            ann.status === 'published' &&
            !ann.read_reach.has_current_user_acknowledged &&
            ann.publisher.id !== sessionUser.id &&
            !dismissedUrgentIdsRef.current.has(ann.id)
        );
        if (urgentCandidate) {
          setUrgentPopupAnnouncement(urgentCandidate);
        } else {
          // Also keep live acknowledgment counter synced if modal is currently open
          setUrgentPopupAnnouncement((current) => {
            if (!current) return null;
            const updatedMatch = res.data.find((a) => a.id === current.id);
            return updatedMatch || current;
          });
        }
      } catch {
        // Ignore errors
      } finally {
        urgentCheckInFlightRef.current = null;
      }
    })();

    urgentCheckInFlightRef.current = promise;
    return promise;
  }, []);

  const refreshPersistenceStatus = useCallback(async () => {
    try {
      const res = (await getPersistenceStatusApi()) as {
        data?: PersistenceStatus;
        status?: string;
        database?: string;
      };
      const statusData: PersistenceStatus = res?.data || {
        driver: 'laravel-postgresql',
        database: res?.database || 'PostgreSQL',
        connected: res?.status === 'connected' || true,
        revision: lastRevisionRef.current || 1,
      };
      setPersistenceStatus(statusData);
      if (
        typeof statusData.revision === 'number' &&
        statusData.revision > lastRevisionRef.current
      ) {
        lastRevisionRef.current = statusData.revision;
      }
    } catch {
      // Ignore status errors
    }
  }, []);

  const clearSession = useCallback(() => {
    clearStoredSession();
    setUserState(GUEST_USER_PLACEHOLDER);
    setIsAuthenticated(false);
    setChannels([]);
    channelsRef.current = [];
    setRosterChannelById({});
    rosterChannelByIdRef.current = {};
    setUrgentPopupAnnouncement(null);
  }, []);

  // Resolve per-tab session on mount
  useEffect(() => {
    const savedUser = getStoredSessionUser();
    const savedToken = getStoredToken();

    if (!savedUser || !savedToken) {
      setUserState(GUEST_USER_PLACEHOLDER);
      setIsAuthenticated(false);
      setIsAuthReady(true);
      void refreshPersistenceStatus();
      return;
    }

    setUserState(savedUser);
    setIsAuthenticated(true);
    setIsAuthReady(true);

    if (savedUser.role !== 'it_admin') {
      void refreshChannels();
      void checkUnacknowledgedUrgentAnnouncement();
    } else {
      setChannels([]);
      channelsRef.current = [];
    }
    void refreshPersistenceStatus();

    // Sync active user profile from PostgreSQL / Laravel backend
    getMeApi()
      .then((res) => {
        if (res?.data) {
          setUserState(res.data);
          setStoredUser(res.data);
          setIsAuthenticated(true);
          if (res.data.role === 'it_admin') {
            setChannels([]);
            channelsRef.current = [];
          }
        }
      })
      .catch((err: { status?: number }) => {
        if (err?.status === 401 || err?.status === 403) {
          clearSession();
        }
      });
  }, [
    refreshChannels,
    checkUnacknowledgedUrgentAnnouncement,
    refreshPersistenceStatus,
    clearSession,
  ]);

  // Enforce login-first route protection when unauthenticated
  useEffect(() => {
    if (!isAuthReady) return;
    const isPublicAuthPage =
      pathname === '/login' || pathname === '/register';

    if (!isAuthenticated && !isPublicAuthPage) {
      router.replace('/login');
    }
  }, [isAuthReady, isAuthenticated, pathname, router]);

  // Compute administered Course Hub IDs so Course Admins subscribe to all hubs they administer
  const adminCourseHubIdsKey = getTopLevelCourseHubs(channels)
    .filter((hub) => isUserCourseAdmin(hub, user))
    .map((hub) => Number(hub.id))
    .sort((a, b) => a - b)
    .join(',');

  // Real-time synchronization via Laravel Reverb WebSockets + SSE + BroadcastChannel
  useEffect(() => {
    if (typeof window === 'undefined' || !isAuthenticated) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        pendingVisibilityRefreshRef.current = false;
        void refreshChannels({ forceImmediate: true });
        refreshAdminHubRosters();
        void checkUnacknowledgedUrgentAnnouncement();
        setAnnouncementVersion((v) => v + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleIncomingRealtimeEvent = (event: RealtimeEvent) => {
      const activeUser = getStoredUser();

      notifyEventListeners(event);

      // Event-type switch to prevent HTTP fan-out storms
      if (event.type === 'chat.message') {
        const targetChannelId = Number(
          event.channel_id || event.message?.channel_id || 0
        );
        if (targetChannelId > 0) {
          setChannels((prev) =>
            prev.map((ch) => {
              if (Number(ch.id) !== targetChannelId) return ch;
              const previewText = event.message?.content
                ? String(event.message.content).slice(0, 72)
                : ch.latest_activity_preview;
              return {
                ...ch,
                chat_messages_count: (ch.chat_messages_count ?? 0) + 1,
                latest_activity_preview: previewText,
                latest_activity_at: 'Just now',
              };
            })
          );
        }
        return;
      }

      if (event.type === 'membership.changed') {
        const targetChannelId = Number(event.channel_id || 0);
        const targetUserId = Number(event.target_user_id || 0);
        const isCurrentUserTarget =
          targetUserId > 0 &&
          Number(activeUser.id) > 0 &&
          targetUserId === Number(activeUser.id);

        if (isCurrentUserTarget) {
          const dedupeKey = `${targetChannelId}:${targetUserId}:${event.action || ''}`;
          const lastShownAt =
            recentMembershipToastKeysRef.current.get(dedupeKey) || 0;
          const nowMs = Date.now();
          const shouldNotifyToast = nowMs - lastShownAt > 2500;
          if (shouldNotifyToast) {
            recentMembershipToastKeysRef.current.set(dedupeKey, nowMs);
          }

          void refreshChannels({ forceImmediate: true }).then((freshList) => {
            if (!shouldNotifyToast) return;
            const matchedHub =
              freshList.find((c) => Number(c.id) === targetChannelId) ||
              channelsRef.current.find(
                (c) => Number(c.id) === targetChannelId
              ) ||
              rosterChannelByIdRef.current[targetChannelId];
            const hubLabel = matchedHub
              ? formatCourseHubName(matchedHub)
              : 'Course Hub';

            if (event.action === 'approved') {
              showToast(
                `Your request to join ${hubLabel} was approved`,
                'success'
              );
              if (targetChannelId > 0) {
                void refreshChannelRoster(targetChannelId);
              }
            } else if (event.action === 'rejected') {
              showToast(
                `Your request to join ${hubLabel} was declined`,
                'info'
              );
              if (targetChannelId > 0) {
                setRosterChannelById((prev) => {
                  if (!prev[targetChannelId]) return prev;
                  const next = { ...prev };
                  delete next[targetChannelId];
                  rosterChannelByIdRef.current = next;
                  return next;
                });
              }
            } else if (event.action === 'added') {
              showToast(`You were added to ${hubLabel}`, 'success');
              if (targetChannelId > 0) {
                void refreshChannelRoster(targetChannelId);
              }
            }
          });
        }

        if (targetChannelId > 0) {
          const hub = channelsRef.current.find(
            (c) => Number(c.id) === targetChannelId
          );
          if (
            (hub && isUserCourseAdmin(hub, activeUser)) ||
            Boolean(rosterChannelByIdRef.current[targetChannelId])
          ) {
            void refreshChannelRoster(targetChannelId);
          }
          if (!isCurrentUserTarget) {
            scheduleDebouncedChannelRefresh();
          }
        }
        setAnnouncementVersion((v) => v + 1);
        return;
      }

      if (
        event.type === 'announcement.urgent' ||
        event.type === 'announcement.created' ||
        event.type === 'announcement.updated' ||
        event.type === 'announcement.deleted' ||
        event.type === 'announcement.acknowledged'
      ) {
        // 1. Urgent Announcement Popup trigger when full payload is present
        if (
          (event.type === 'announcement.urgent' ||
            event.type === 'announcement.created' ||
            event.type === 'announcement.updated') &&
          event.announcement?.is_urgent &&
          event.announcement.status === 'published' &&
          activeUser.role !== 'it_admin'
        ) {
          if (event.announcement.title && event.announcement.publisher) {
            const incomingAnn = event.announcement;
            const isPublisher = incomingAnn.publisher.id === activeUser.id;
            if (!isPublisher) {
              dismissedUrgentIdsRef.current.delete(incomingAnn.id);
              setUrgentPopupAnnouncement({
                ...incomingAnn,
                read_reach: {
                  ...incomingAnn.read_reach,
                  has_current_user_acknowledged: false,
                },
              });
            }
          } else {
            // Minimal global notice payload -> fetch urgent announcement once
            void checkUnacknowledgedUrgentAnnouncement();
          }
        }

        // 2. Live Acknowledgment Counter update inside open Urgent Popup
        if (
          event.type === 'announcement.acknowledged' &&
          event.announcement?.read_reach
        ) {
          const updatedAnn = event.announcement;
          setUrgentPopupAnnouncement((current) => {
            if (!current || current.id !== updatedAnn.id) return current;
            return {
              ...current,
              read_reach: {
                ...updatedAnn.read_reach,
                has_current_user_acknowledged:
                  current.read_reach.has_current_user_acknowledged,
              },
            };
          });
        }

        setAnnouncementVersion((v) => v + 1);
        return;
      }

      if (
        event.type === 'channel.created' ||
        event.type === 'channel.updated'
      ) {
        const targetChannelId = Number(event.channel_id || 0);
        if (targetChannelId > 0) {
          const hub = channelsRef.current.find(
            (c) => Number(c.id) === targetChannelId
          );
          if (
            (hub && isUserCourseAdmin(hub, activeUser)) ||
            Boolean(rosterChannelByIdRef.current[targetChannelId])
          ) {
            void refreshChannelRoster(targetChannelId);
          }
        }
        scheduleDebouncedChannelRefresh();
        return;
      }

      if (
        event.type === 'thread.created' ||
        event.type === 'thread.updated' ||
        event.type === 'thread.replied' ||
        event.type === 'thread.faq_pinned' ||
        event.type === 'thread.deleted'
      ) {
        scheduleDebouncedChannelRefresh();
        return;
      }

      // Fallback for db.changed or admin.updated
      scheduleDebouncedChannelRefresh();
      setAnnouncementVersion((v) => v + 1);
    };

    const handleRealtimeReconnect = () => {
      void refreshChannels({ forceImmediate: true });
      refreshAdminHubRosters();
      void checkUnacknowledgedUrgentAnnouncement();
    };

    // 1. Laravel Reverb: Global + Private User (`clarify.user.{id}`) subscription
    const unsubscribeReverb = subscribeGlobalReverb(
      (payload: ReverbBroadcastPayload) => {
        const normalizedEvent: RealtimeEvent = {
          revision: Date.now(),
          type: payload.type || 'db.changed',
          channel_id: payload.channel_id,
          target_user_id: payload.target_user_id,
          action: payload.action,
          actor_id: payload.actor_id,
          announcement: payload.announcement,
          message: payload.message,
          thread: payload.thread,
          timestamp: payload.timestamp || new Date().toISOString(),
        };
        handleIncomingRealtimeEvent(normalizedEvent);
      },
      user.id,
      handleRealtimeReconnect
    );

    // 1b. Subscribe to private `clarify.channel.{id}` for EVERY Course Hub the current user administers
    const adminHubIds = adminCourseHubIdsKey
      ? adminCourseHubIdsKey
          .split(',')
          .map((s) => Number(s))
          .filter((n) => n > 0)
      : [];

    const adminHubUnsubscribes = adminHubIds.map((hubId) => {
      // Ensure initial roster & pending_requests snapshot is loaded for each administered hub
      if (!rosterChannelByIdRef.current[hubId]) {
        void refreshChannelRoster(hubId);
      }
      return subscribeChannelReverb(hubId, (payload: ReverbBroadcastPayload) => {
        // Ignore chat.message here if MessengerChatBox handles active chat, except for updating preview or membership/channel updates
        const normalizedEvent: RealtimeEvent = {
          revision: Date.now(),
          type: payload.type || 'channel.updated',
          channel_id: payload.channel_id ?? hubId,
          target_user_id: payload.target_user_id,
          action: payload.action,
          actor_id: payload.actor_id,
          announcement: payload.announcement,
          message: payload.message,
          thread: payload.thread,
          timestamp: payload.timestamp || new Date().toISOString(),
        };
        handleIncomingRealtimeEvent(normalizedEvent);
      });
    });

    // 2. Cross-tab BroadcastChannel + Same-tab CustomEvent for instant zero-latency local browser sync
    const processMutationPayload = (
      msgData: {
        endpoint?: string;
        data?: Record<string, unknown>;
        requestBody?: Record<string, unknown>;
      },
      isFromCrossTab = false
    ) => {
      const endpoint = String(msgData?.endpoint || '');
      let evType: RealtimeEvent['type'] = 'db.changed';
      let announcement: Announcement | undefined;
      let message: RealtimeEvent['message'];
      let thread: RealtimeEvent['thread'];
      let channelId: number | undefined;
      let targetUserId: number | undefined;
      let membershipAction: RealtimeEvent['action'] | undefined;

      const channelMatch = endpoint.match(/\/channels\/(\d+)/);
      if (channelMatch) {
        channelId = Number(channelMatch[1]);
      }

      if (
        endpoint.includes('/announcements') &&
        endpoint.endsWith('/acknowledge')
      ) {
        evType = 'announcement.acknowledged';
        announcement = msgData?.data as unknown as Announcement;
      } else if (endpoint.includes('/announcements')) {
        const ann = msgData?.data as unknown as Announcement | undefined;
        evType = ann?.is_urgent ? 'announcement.urgent' : 'announcement.created';
        announcement = ann;
      } else if (endpoint.includes('/chat') || endpoint.includes('/messages')) {
        evType = 'chat.message';
        message = msgData?.data as unknown as RealtimeEvent['message'];
      } else if (endpoint.includes('/threads')) {
        evType = 'thread.updated';
        thread = msgData?.data as unknown as RealtimeEvent['thread'];
      } else if (
        channelMatch &&
        (endpoint.endsWith('/members') || endpoint.endsWith('/join'))
      ) {
        // Only synthesize membership.changed on cross-tab BroadcastChannel events so same-tab doesn't double-fire
        if (isFromCrossTab) {
          evType = 'membership.changed';
          const rawAction = String(msgData?.requestBody?.action || '');
          if (endpoint.endsWith('/join')) {
            membershipAction = 'requested';
          } else if (rawAction === 'approve') {
            membershipAction = 'approved';
          } else if (rawAction === 'reject') {
            membershipAction = 'rejected';
          } else if (rawAction === 'remove') {
            membershipAction = 'removed';
          } else if (rawAction === 'add') {
            membershipAction = 'added';
          }
          const targetInstId = String(
            msgData?.requestBody?.institutional_id || ''
          );
          const activeUser = getStoredUser();
          if (
            targetInstId &&
            activeUser.institutional_id === targetInstId
          ) {
            targetUserId = activeUser.id;
          }
        } else {
          evType = 'channel.updated';
        }
      } else if (endpoint.includes('/channels')) {
        evType = 'channel.updated';
      }

      handleIncomingRealtimeEvent({
        revision: Date.now(),
        type: evType,
        channel_id:
          channelId ||
          announcement?.channel_id ||
          message?.channel_id ||
          thread?.channel_id,
        target_user_id: targetUserId,
        action: membershipAction,
        announcement,
        message,
        thread,
        timestamp: new Date().toISOString(),
      });
    };

    const handleLocalMutationEvent = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        endpoint?: string;
        data?: Record<string, unknown>;
        requestBody?: Record<string, unknown>;
      }>;
      if (customEv.detail) {
        processMutationPayload(customEv.detail, false);
      }
    };
    window.addEventListener('clarify_local_mutation', handleLocalMutationEvent);

    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('clarify_realtime_sync');
        bc.onmessage = (msgEvent) => {
          if (msgEvent.data) {
            processMutationPayload(
              msgEvent.data as {
                endpoint?: string;
                data?: Record<string, unknown>;
                requestBody?: Record<string, unknown>;
              },
              true
            );
          }
        };
      } catch {
        bc = null;
      }
    }

    // 3. Only open local Next.js SSE/poll (/api/v1/realtime/stream) when API_BASE_URL is a same-origin relative path
    const isUsingLocalNextApi = API_BASE_URL.startsWith('/');
    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let sseConnectedOnce = false;

    if (isUsingLocalNextApi && 'EventSource' in window) {
      try {
        eventSource = new EventSource('/api/v1/realtime/stream');
        eventSource.onopen = () => {
          if (sseConnectedOnce) {
            handleRealtimeReconnect();
          }
          sseConnectedOnce = true;
        };
        eventSource.onmessage = (e) => {
          try {
            const payload = JSON.parse(e.data) as RealtimeEvent;
            if (payload.revision && payload.revision > lastRevisionRef.current) {
              const isInitialConnect = payload.type === 'connected';
              lastRevisionRef.current = payload.revision;
              if (!isInitialConnect) {
                handleIncomingRealtimeEvent(payload);
              }
            }
          } catch {
            // Ignore malformed SSE payload
          }
        };
      } catch {
        eventSource = null;
      }
    }

    if (isUsingLocalNextApi) {
      pollInterval = setInterval(async () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        try {
          const res = await fetch(
            `/api/v1/realtime/stream?poll=1&since_revision=${lastRevisionRef.current}`,
            { cache: 'no-store' }
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            revision: number;
            events: RealtimeEvent[];
          };
          if (data.revision > lastRevisionRef.current) {
            const hadPriorRevision = lastRevisionRef.current > 0;
            lastRevisionRef.current = data.revision;
            if (hadPriorRevision) {
              for (const ev of data.events) {
                handleIncomingRealtimeEvent(ev);
              }
            }
          }
        } catch {
          // Ignore transient network errors
        }
      }, 2000);
    }

    return () => {
      unsubscribeReverb();
      adminHubUnsubscribes.forEach((unsub) => unsub());
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (debouncedRefreshTimerRef.current) {
        clearTimeout(debouncedRefreshTimerRef.current);
      }
      window.removeEventListener(
        'clarify_local_mutation',
        handleLocalMutationEvent
      );
      if (bc) {
        try {
          bc.close();
        } catch {
          // Ignore close error
        }
      }
      if (eventSource) {
        eventSource.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [
    isAuthenticated,
    user.id,
    adminCourseHubIdsKey,
    refreshChannels,
    refreshChannelRoster,
    refreshAdminHubRosters,
    scheduleDebouncedChannelRefresh,
    checkUnacknowledgedUrgentAnnouncement,
    notifyEventListeners,
    showToast,
  ]);

  const setUser = useCallback(
    (nextUser: User) => {
      setUserState(nextUser);
      setStoredUser(nextUser);
      setIsAuthenticated(true);
      setIsAuthReady(true);
      dismissedUrgentIdsRef.current.clear();
      if (nextUser.role !== 'it_admin') {
        void refreshChannels({ forceImmediate: true });
        void checkUnacknowledgedUrgentAnnouncement();
      } else {
        setChannels([]);
        channelsRef.current = [];
        setRosterChannelById({});
        rosterChannelByIdRef.current = {};
        setUrgentPopupAnnouncement(null);
      }
      setAnnouncementVersion((v) => v + 1);
    },
    [refreshChannels, checkUnacknowledgedUrgentAnnouncement]
  );

  const openAnnouncementModal = useCallback(
    (options?: {
      editingAnnouncement?: Announcement | null;
      defaultChannelId?: number;
      mode?: 'campus_wide' | 'course_hub';
    }) => {
      const resolvedMode =
        options?.mode ||
        (options?.defaultChannelId ? 'course_hub' : 'campus_wide');
      setAnnouncementModalState({
        isOpen: true,
        editingAnnouncement: options?.editingAnnouncement || null,
        defaultChannelId: options?.defaultChannelId || channels[0]?.id || 1,
        mode: resolvedMode,
      });
    },
    [channels]
  );

  const closeAnnouncementModal = useCallback(() => {
    setAnnouncementModalState((prev) => ({
      ...prev,
      isOpen: false,
      editingAnnouncement: null,
    }));
  }, []);

  const triggerAnnouncementRefresh = useCallback(() => {
    setAnnouncementVersion((v) => v + 1);
    void refreshChannels();
    void checkUnacknowledgedUrgentAnnouncement();
  }, [refreshChannels, checkUnacknowledgedUrgentAnnouncement]);

  return (
    <ClarifyContext.Provider
      value={{
        user,
        isAuthenticated,
        isAuthReady,
        setUser,
        clearSession,
        persistenceStatus,
        isDrawerOpen,
        setIsDrawerOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isChannelModalOpen,
        setIsChannelModalOpen,
        channelModalTargetHubId,
        openCourseHubModal,
        openAddSubChannelModal,
        openEditCourseHubModal,
        channelModalDefaultTab,
        activeHubTab,
        setActiveHubTab,
        announcementModalState,
        openAnnouncementModal,
        closeAnnouncementModal,
        urgentPopupAnnouncement,
        dismissUrgentPopup,
        subscribeRealtimeEvents,
        channels,
        refreshChannels,
        rosterChannelById,
        isLoadingRosterById,
        refreshChannelRoster,
        setRosterChannelSnapshot,
        announcementVersion,
        triggerAnnouncementRefresh,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </ClarifyContext.Provider>
  );
}

export function useClarify() {
  const ctx = useContext(ClarifyContext);
  if (!ctx) {
    throw new Error('useClarify must be used inside ClarifyProvider');
  }
  return ctx;
}
