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
  clearStoredSession,
  getAnnouncementsApi,
  getChannelsApi,
  getMeApi,
  getPersistenceStatusApi,
  getStoredSessionUser,
  getStoredToken,
  getStoredUser,
  setStoredUser,
} from '../lib/api-client';
import {
  type ReverbBroadcastPayload,
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
  announcementModalState: {
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
  };
  openAnnouncementModal: (options?: {
    editingAnnouncement?: Announcement | null;
    defaultChannelId?: number;
  }) => void;
  closeAnnouncementModal: () => void;
  urgentPopupAnnouncement: Announcement | null;
  dismissUrgentPopup: (announcementId: number) => void;
  subscribeRealtimeEvents: (listener: RealtimeEventListener) => () => void;
  channels: Channel[];
  refreshChannels: () => Promise<void>;
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
  }>({
    isOpen: false,
    editingAnnouncement: null,
    defaultChannelId: 1,
  });
  const [urgentPopupAnnouncement, setUrgentPopupAnnouncement] =
    useState<Announcement | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [announcementVersion, setAnnouncementVersion] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const lastRevisionRef = useRef<number>(0);
  const dismissedUrgentIdsRef = useRef<Set<number>>(new Set());
  const eventListenersRef = useRef<Set<RealtimeEventListener>>(new Set());

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

  const refreshChannels = useCallback(async () => {
    const sessionUser = getStoredSessionUser();
    const token = getStoredToken();
    if (!sessionUser || !token || sessionUser.role === 'it_admin') {
      setChannels([]);
      return;
    }
    try {
      const res = await getChannelsApi();
      setChannels(res.data);
    } catch {
      // Retain existing channels if backend is unreachable
    }
  }, []);

  const checkUnacknowledgedUrgentAnnouncement = useCallback(async () => {
    const sessionUser = getStoredSessionUser();
    const token = getStoredToken();
    if (!sessionUser || !token || sessionUser.role === 'it_admin') {
      return;
    }
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
    }
  }, []);

  const refreshPersistenceStatus = useCallback(async () => {
    try {
      const res = await getPersistenceStatusApi();
      setPersistenceStatus(res.data);
      if (res.data.revision > lastRevisionRef.current) {
        lastRevisionRef.current = res.data.revision;
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

  // Real-time synchronization via Laravel Reverb WebSockets + SSE + BroadcastChannel + fallback polling
  useEffect(() => {
    if (typeof window === 'undefined' || !isAuthenticated) return;

    const handleIncomingRealtimeEvent = (event: RealtimeEvent) => {
      const activeUser = getStoredUser();

      // 1. Urgent Announcement Popup trigger
      if (
        (event.type === 'announcement.urgent' ||
          event.type === 'announcement.created' ||
          event.type === 'announcement.updated') &&
        event.announcement?.is_urgent &&
        event.announcement.status === 'published' &&
        activeUser.role !== 'it_admin'
      ) {
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
      }

      // 2. Live Acknowledgment Counter update inside open Urgent Popup
      if (
        event.type === 'announcement.acknowledged' &&
        event.announcement
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

      notifyEventListeners(event);
      void refreshChannels();
      void checkUnacknowledgedUrgentAnnouncement();
      setAnnouncementVersion((v) => v + 1);
    };

    // 1. Laravel Reverb (Laravel Echo + Pusher-js WebSocket subscription)
    const unsubscribeReverb = subscribeGlobalReverb(
      (payload: ReverbBroadcastPayload) => {
        const normalizedEvent: RealtimeEvent = {
          revision: Date.now(),
          type: payload.type || 'db.changed',
          channel_id: payload.channel_id,
          actor_id: payload.actor_id,
          announcement: payload.announcement,
          message: payload.message,
          thread: payload.thread,
          timestamp: payload.timestamp || new Date().toISOString(),
        };
        handleIncomingRealtimeEvent(normalizedEvent);
      }
    );

    // 2. Cross-tab BroadcastChannel for instant zero-latency local browser sync
    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('clarify_realtime_sync');
        bc.onmessage = (msgEvent) => {
          const msgData = msgEvent.data as {
            endpoint?: string;
            data?: Record<string, unknown>;
          };
          const endpoint = String(msgData?.endpoint || '');
          let evType: RealtimeEvent['type'] = 'db.changed';
          let announcement: Announcement | undefined;
          let message: RealtimeEvent['message'];
          let thread: RealtimeEvent['thread'];

          if (endpoint.includes('/announcements') && endpoint.endsWith('/acknowledge')) {
            evType = 'announcement.acknowledged';
            announcement = msgData?.data as unknown as Announcement;
          } else if (endpoint.includes('/announcements')) {
            const ann = msgData?.data as unknown as Announcement | undefined;
            evType = ann?.is_urgent ? 'announcement.urgent' : 'announcement.created';
            announcement = ann;
          } else if (endpoint.includes('/chat')) {
            evType = 'chat.message';
            message = msgData?.data as unknown as RealtimeEvent['message'];
          } else if (endpoint.includes('/threads')) {
            evType = 'thread.updated';
            thread = msgData?.data as unknown as RealtimeEvent['thread'];
          }

          handleIncomingRealtimeEvent({
            revision: Date.now(),
            type: evType,
            announcement,
            message,
            thread,
            timestamp: new Date().toISOString(),
          });
        };
      } catch {
        bc = null;
      }
    }

    // 3. Server-Sent Events (SSE) subscription to /api/v1/realtime/stream
    let eventSource: EventSource | null = null;
    if ('EventSource' in window) {
      try {
        eventSource = new EventSource('/api/v1/realtime/stream');
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

    // 4. Lightweight 2.0s poll fallback (detects external PostgreSQL edits & environments buffering SSE)
    const pollInterval = setInterval(async () => {
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
            const latestEv = data.events[data.events.length - 1] || {
              revision: data.revision,
              type: 'db.changed',
              timestamp: new Date().toISOString(),
            };
            handleIncomingRealtimeEvent(latestEv);
          }
        }
      } catch {
        // Ignore transient network errors
      }
    }, 2000);

    return () => {
      unsubscribeReverb();
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
      clearInterval(pollInterval);
    };
  }, [
    isAuthenticated,
    refreshChannels,
    checkUnacknowledgedUrgentAnnouncement,
    notifyEventListeners,
  ]);

  const setUser = useCallback(
    (nextUser: User) => {
      setUserState(nextUser);
      setStoredUser(nextUser);
      setIsAuthenticated(true);
      setIsAuthReady(true);
      dismissedUrgentIdsRef.current.clear();
      if (nextUser.role !== 'it_admin') {
        void refreshChannels();
        void checkUnacknowledgedUrgentAnnouncement();
      } else {
        setChannels([]);
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
    }) => {
      setAnnouncementModalState({
        isOpen: true,
        editingAnnouncement: options?.editingAnnouncement || null,
        defaultChannelId: options?.defaultChannelId || channels[0]?.id || 1,
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
        announcementModalState,
        openAnnouncementModal,
        closeAnnouncementModal,
        urgentPopupAnnouncement,
        dismissUrgentPopup,
        subscribeRealtimeEvents,
        channels,
        refreshChannels,
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
