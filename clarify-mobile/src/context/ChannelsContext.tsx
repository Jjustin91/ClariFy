import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getChannelsApi } from '../lib/api-client';
import {
  getJoinedCourseHubs,
  getTopLevelCourseHubs,
} from '../lib/domain-logic';
import type { ApiError, Channel } from '../types/api';
import { useAuth } from './AuthContext';

export interface ChannelsContextValue {
  channels: Channel[];
  allCourseHubs: Channel[];
  joinedCourseHubs: Channel[];
  primaryChannelId: number | null;
  isLoadingChannels: boolean;
  isRefreshingChannels: boolean;
  channelsError: ApiError | null;
  refreshChannels: (options?: { silent?: boolean }) => Promise<void>;
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChannelsContext = createContext<ChannelsContextValue | undefined>(
  undefined
);

/**
 * Shared server-state container for GET /channels (without ?include=roster)
 * and shell overlay toggles (right-hand sidebar & profile settings modal).
 * Ported from clarify-web/src/context/ClarifyContext.tsx.
 */
export function ChannelsProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isAuthReady } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(true);
  const [isRefreshingChannels, setIsRefreshingChannels] =
    useState<boolean>(false);
  const [channelsError, setChannelsError] = useState<ApiError | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] =
    useState<boolean>(false);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const hasLoadedOnceRef = useRef<boolean>(false);

  const refreshChannels = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isAuthReady || !isAuthenticated || !user) {
        return;
      }
      if (user.role === 'it_admin') {
        setChannels([]);
        setIsLoadingChannels(false);
        setIsRefreshingChannels(false);
        setChannelsError(null);
        return;
      }

      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      const silent = Boolean(options?.silent);
      if (!hasLoadedOnceRef.current && !silent) {
        setIsLoadingChannels(true);
      } else if (!silent) {
        setIsRefreshingChannels(true);
      }
      setChannelsError(null);

      const requestPromise = (async () => {
        try {
          // Never pass include: 'roster' on list fetch; use server members_count
          const res = await getChannelsApi();
          const list = Array.isArray(res?.data) ? res.data : [];
          setChannels(list);
          hasLoadedOnceRef.current = true;
        } catch (err) {
          setChannelsError(err as ApiError);
        } finally {
          setIsLoadingChannels(false);
          setIsRefreshingChannels(false);
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = requestPromise;
      return requestPromise;
    },
    [isAuthReady, isAuthenticated, user]
  );

  // Load channels once upon authenticated entry, and clear cleanly upon logout
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }
    if (!isAuthenticated || !user) {
      setChannels([]);
      setChannelsError(null);
      setIsSidebarOpen(false);
      setIsSettingsModalOpen(false);
      hasLoadedOnceRef.current = false;
      return;
    }

    void refreshChannels();
  }, [isAuthReady, isAuthenticated, user?.id, user?.role, refreshChannels]);

  const allCourseHubs = useMemo(
    () => getTopLevelCourseHubs(channels),
    [channels]
  );

  const joinedCourseHubs = useMemo(
    () => getJoinedCourseHubs(channels, user),
    [channels, user]
  );

  const primaryChannelId = useMemo(() => {
    return joinedCourseHubs[0]?.id ?? allCourseHubs[0]?.id ?? null;
  }, [joinedCourseHubs, allCourseHubs]);

  const value = useMemo<ChannelsContextValue>(
    () => ({
      channels,
      allCourseHubs,
      joinedCourseHubs,
      primaryChannelId,
      isLoadingChannels,
      isRefreshingChannels,
      channelsError,
      refreshChannels,
      isSidebarOpen,
      setIsSidebarOpen,
      isSettingsModalOpen,
      setIsSettingsModalOpen,
    }),
    [
      channels,
      allCourseHubs,
      joinedCourseHubs,
      primaryChannelId,
      isLoadingChannels,
      isRefreshingChannels,
      channelsError,
      refreshChannels,
      isSidebarOpen,
      isSettingsModalOpen,
    ]
  );

  return (
    <ChannelsContext.Provider value={value}>
      {children}
    </ChannelsContext.Provider>
  );
}

export function useChannels(): ChannelsContextValue {
  const ctx = useContext(ChannelsContext);
  if (!ctx) {
    throw new Error('useChannels must be used within a ChannelsProvider');
  }
  return ctx;
}
