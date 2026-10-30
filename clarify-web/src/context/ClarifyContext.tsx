'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import type {
  Announcement,
  Channel,
  PersistenceStatus,
  RealtimeEvent,
  User,
} from '../types/api';
import {
  getChannelsApi,
  getCurrentMockUser,
  getMeApi,
  getPersistenceStatusApi,
  getUseMockApi,
  setUseMockApi,
  switchDemoRole,
} from '../lib/api-client';
import { DEMO_USERS, INITIAL_CHANNELS } from '../mocks/seed-data';

export interface ToastItem {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ClarifyContextValue {
  user: User;
  setUser: (user: User) => void;
  switchRole: (role: 'student' | 'faculty' | 'it_admin') => void;
  useMock: boolean;
  toggleApiMode: (nextValue?: boolean) => void;
  persistenceStatus: PersistenceStatus | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChannelModalOpen: boolean;
  setIsChannelModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  channels: Channel[];
  refreshChannels: () => Promise<void>;
  announcementVersion: number;
  triggerAnnouncementRefresh: () => void;
  toasts: ToastItem[];
  showToast: (message: string, variant?: ToastItem['variant']) => void;
  dismissToast: (id: string) => void;
}

const ClarifyContext = createContext<ClarifyContextValue | undefined>(undefined);

export function ClarifyProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User>(DEMO_USERS.student);
  const [useMock, setUseMock] = useState<boolean>(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);
  const [announcementModalState, setAnnouncementModalState] = useState<{
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
  }>({
    isOpen: false,
    editingAnnouncement: null,
    defaultChannelId: 7,
  });
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [announcementVersion, setAnnouncementVersion] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastRevisionRef = useRef<number>(0);

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

  const refreshChannels = useCallback(async () => {
    try {
      const res = await getChannelsApi();
      setChannels(res.data);
    } catch {
      // Retain existing channels if backend is unreachable
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

  useEffect(() => {
    const initialMock = getUseMockApi();
    setUseMock(initialMock);
    setUserState(getCurrentMockUser());
    void refreshChannels();
    void refreshPersistenceStatus();

    // Sync active user profile from backend / PostgreSQL
    if (!initialMock) {
      getMeApi()
        .then((res) => {
          if (res?.data) {
            setUserState(res.data);
          }
        })
        .catch(() => {});
    }
  }, [refreshChannels, refreshPersistenceStatus]);

  // Real-time synchronization via Server-Sent Events (SSE) + BroadcastChannel + fallback polling
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleRealtimeTrigger = () => {
      void refreshChannels();
      setAnnouncementVersion((v) => v + 1);
    };

    // 1. Cross-tab BroadcastChannel for instant zero-latency local browser sync
    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('clarify_realtime_sync');
        bc.onmessage = () => {
          handleRealtimeTrigger();
        };
      } catch {
        bc = null;
      }
    }

    // 2. Server-Sent Events (SSE) subscription to /api/v1/realtime/stream
    let eventSource: EventSource | null = null;
    if (!useMock && 'EventSource' in window) {
      try {
        eventSource = new EventSource('/api/v1/realtime/stream');
        eventSource.onmessage = (e) => {
          try {
            const payload = JSON.parse(e.data) as RealtimeEvent;
            if (payload.revision && payload.revision > lastRevisionRef.current) {
              const isInitialConnect = payload.type === 'connected';
              lastRevisionRef.current = payload.revision;
              if (!isInitialConnect) {
                handleRealtimeTrigger();
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

    // 3. Lightweight 2.5s poll fallback (detects external PostgreSQL edits & environments buffering SSE)
    const pollInterval = setInterval(async () => {
      if (useMock) return;
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
            handleRealtimeTrigger();
          }
        }
      } catch {
        // Ignore transient network errors
      }
    }, 2500);

    return () => {
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
  }, [useMock, refreshChannels]);

  const setUser = useCallback(
    (nextUser: User) => {
      setUserState(nextUser);
      void refreshChannels();
      setAnnouncementVersion((v) => v + 1);
    },
    [refreshChannels]
  );

  const switchRole = useCallback(
    (role: 'student' | 'faculty' | 'it_admin') => {
      const nextUser = switchDemoRole(role);
      setUserState(nextUser);
      void refreshChannels();
      setAnnouncementVersion((v) => v + 1);
      const roleLabels = {
        student: 'Student View (Kobeni Higashiyama • 2020202020)',
        faculty: 'Faculty View (Aki Hayakawa • Faculty ID: 10492)',
        it_admin: 'IT Admin View (Engr. Makima Cruz • ICTO)',
      };
      showToast(`Switched active session to ${roleLabels[role]}`, 'info');
    },
    [refreshChannels, showToast]
  );

  const toggleApiMode = useCallback(
    (nextValue?: boolean) => {
      const target = nextValue !== undefined ? nextValue : !useMock;
      setUseMockApi(target);
      setUseMock(target);
      showToast(
        target
          ? 'API Mode: Client-side USTP Mock Seed active'
          : 'API Mode: Connected to ClariFy REST API (/api/v1)',
        'info'
      );
      void refreshChannels();
      void refreshPersistenceStatus();
      setAnnouncementVersion((v) => v + 1);
    },
    [useMock, refreshChannels, refreshPersistenceStatus, showToast]
  );

  const openAnnouncementModal = useCallback(
    (options?: {
      editingAnnouncement?: Announcement | null;
      defaultChannelId?: number;
    }) => {
      setAnnouncementModalState({
        isOpen: true,
        editingAnnouncement: options?.editingAnnouncement || null,
        defaultChannelId: options?.defaultChannelId || channels[0]?.id || 7,
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
  }, [refreshChannels]);

  return (
    <ClarifyContext.Provider
      value={{
        user,
        setUser,
        switchRole,
        useMock,
        toggleApiMode,
        persistenceStatus,
        isDrawerOpen,
        setIsDrawerOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isChannelModalOpen,
        setIsChannelModalOpen,
        announcementModalState,
        openAnnouncementModal,
        closeAnnouncementModal,
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
