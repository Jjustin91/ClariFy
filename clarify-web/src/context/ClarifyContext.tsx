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
  getMeApi,
  getPersistenceStatusApi,
  getStoredUser,
  setStoredUser,
} from '../lib/api-client';

export interface ToastItem {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ClarifyContextValue {
  user: User;
  setUser: (user: User) => void;
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

const INITIAL_USER_FALLBACK: User = {
  id: 1,
  institutional_id: '2020202020',
  name: 'Kobeni Higashiyama',
  email: 'higashiyama.kobeni@ustp.edu.ph',
  contact_number: '+63 917 842 2020',
  role: 'student',
  verification_status: 'approved',
  academic_profile: {
    campus: 'CDO Campus',
    college: 'CITC',
    department: 'CITC',
    program: 'BS Information Technology',
    year_level: 3,
    section: 'IT3R2',
    semester_code: '2026-1ST-SEM',
  },
};

export function ClarifyProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User>(INITIAL_USER_FALLBACK);
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
    defaultChannelId: 1,
  });
  const [channels, setChannels] = useState<Channel[]>([]);
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
    const savedUser = getStoredUser();
    setUserState(savedUser);
    void refreshChannels();
    void refreshPersistenceStatus();

    // Sync active user profile from PostgreSQL / Laravel backend
    getMeApi()
      .then((res) => {
        if (res?.data) {
          setUserState(res.data);
          setStoredUser(res.data);
        }
      })
      .catch(() => {});
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
  }, [refreshChannels]);

  const setUser = useCallback(
    (nextUser: User) => {
      setUserState(nextUser);
      setStoredUser(nextUser);
      void refreshChannels();
      setAnnouncementVersion((v) => v + 1);
    },
    [refreshChannels]
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
  }, [refreshChannels]);

  return (
    <ClarifyContext.Provider
      value={{
        user,
        setUser,
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
