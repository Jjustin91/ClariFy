import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getChannelRosterApi, getChannelsApi } from '../lib/api-client';
import {
  getJoinedCourseHubs,
  getTopLevelCourseHubs,
  reconcileFetchedChannelsWithStaleGuard,
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
  applyChannelsPatch: (
    updater: (prev: Channel[]) => { channels: Channel[]; mutated: boolean }
  ) => void;
  rosterByChannelId: Record<number, Channel>;
  isLoadingRosterById: Record<number, boolean>;
  refreshChannelRoster: (channelId: number) => Promise<Channel | null>;
  setRosterChannelSnapshot: (channel: Channel) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChannelsContext = createContext<ChannelsContextValue | undefined>(
  undefined
);

/**
 * Shared server-state container for GET /channels (without ?include=roster),
 * on-demand per-channel rosters, stale-guarded realtime patching,
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
  const [rosterByChannelId, setRosterByChannelId] = useState<
    Record<number, Channel>
  >({});
  const [isLoadingRosterById, setIsLoadingRosterById] = useState<
    Record<number, boolean>
  >({});
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] =
    useState<boolean>(false);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightRosterByIdRef = useRef<Map<number, Promise<Channel | null>>>(
    new Map()
  );
  const hasLoadedOnceRef = useRef<boolean>(false);
  const mutationGenerationRef = useRef<number>(0);
  const lastRealtimeMutationAtRef = useRef<number>(0);

  const applyChannelsPatch = useCallback(
    (
      updater: (prev: Channel[]) => { channels: Channel[]; mutated: boolean }
    ) => {
      setChannels((prev) => {
        const result = updater(prev);
        if (!result.mutated) {
          return prev;
        }
        mutationGenerationRef.current += 1;
        lastRealtimeMutationAtRef.current = Date.now();
        return result.channels;
      });
    },
    []
  );

  const setRosterChannelSnapshot = useCallback((channel: Channel) => {
    const cid = Number(channel.id);
    if (cid <= 0) return;
    setRosterByChannelId((prev) => ({
      ...prev,
      [cid]: channel,
    }));
  }, []);

  const refreshChannelRoster = useCallback(
    async (channelId: number): Promise<Channel | null> => {
      const numericId = Number(channelId);
      if (
        !isAuthReady ||
        !isAuthenticated ||
        !user ||
        user.role === 'it_admin' ||
        numericId <= 0
      ) {
        return null;
      }

      const existingPromise = inFlightRosterByIdRef.current.get(numericId);
      if (existingPromise) {
        return existingPromise;
      }

      setIsLoadingRosterById((prev) => ({ ...prev, [numericId]: true }));

      const requestPromise = (async () => {
        try {
          const res = await getChannelRosterApi(numericId);
          const freshChannel = res?.data ?? null;
          if (freshChannel) {
            setRosterByChannelId((prev) => ({
              ...prev,
              [numericId]: freshChannel,
            }));
          }
          return freshChannel;
        } catch {
          return null;
        } finally {
          setIsLoadingRosterById((prev) => ({ ...prev, [numericId]: false }));
          inFlightRosterByIdRef.current.delete(numericId);
        }
      })();

      inFlightRosterByIdRef.current.set(numericId, requestPromise);
      return requestPromise;
    },
    [isAuthReady, isAuthenticated, user]
  );

  const refreshChannels = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isAuthReady || !isAuthenticated || !user) {
        return;
      }
      if (user.role === 'it_admin') {
        setChannels([]);
        setRosterByChannelId({});
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

      const requestGeneration = mutationGenerationRef.current;
      const requestStartedAt = Date.now();

      const requestPromise = (async () => {
        try {
          // Never pass include: 'roster' on list fetch; use server members_count
          const res = await getChannelsApi();
          const list = Array.isArray(res?.data) ? res.data : [];
          setChannels((prev) => {
            const { channels: reconciled } =
              reconcileFetchedChannelsWithStaleGuard({
                fetchedChannels: list,
                currentChannels: prev,
                requestGeneration,
                currentMutationGeneration: mutationGenerationRef.current,
                requestStartedAt,
                lastRealtimeMutationAt: lastRealtimeMutationAtRef.current,
              });
            return reconciled;
          });
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

  // Load channels once upon authenticated entry, and clear refs cleanly upon logout
  useEffect(() => {
    if (!isAuthReady) {
      return;
    }
    if (!isAuthenticated || !user) {
      hasLoadedOnceRef.current = false;
      mutationGenerationRef.current = 0;
      lastRealtimeMutationAtRef.current = 0;
      inFlightRosterByIdRef.current.clear();
      return;
    }

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void refreshChannels();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthReady, isAuthenticated, user, refreshChannels]);

  const effectiveChannels = useMemo(
    () => (isAuthenticated && user ? channels : []),
    [isAuthenticated, user, channels]
  );

  const effectiveRosterByChannelId = useMemo(
    () => (isAuthenticated && user ? rosterByChannelId : {}),
    [isAuthenticated, user, rosterByChannelId]
  );

  const effectiveChannelsError = isAuthenticated && user ? channelsError : null;
  const effectiveSidebarOpen = isAuthenticated && user ? isSidebarOpen : false;
  const effectiveSettingsModalOpen =
    isAuthenticated && user ? isSettingsModalOpen : false;

  const allCourseHubs = useMemo(
    () => getTopLevelCourseHubs(effectiveChannels),
    [effectiveChannels]
  );

  const joinedCourseHubs = useMemo(
    () => getJoinedCourseHubs(effectiveChannels, user),
    [effectiveChannels, user]
  );

  const primaryChannelId = useMemo(() => {
    return joinedCourseHubs[0]?.id ?? allCourseHubs[0]?.id ?? null;
  }, [joinedCourseHubs, allCourseHubs]);

  const value = useMemo<ChannelsContextValue>(
    () => ({
      channels: effectiveChannels,
      allCourseHubs,
      joinedCourseHubs,
      primaryChannelId,
      isLoadingChannels,
      isRefreshingChannels,
      channelsError: effectiveChannelsError,
      refreshChannels,
      applyChannelsPatch,
      rosterByChannelId: effectiveRosterByChannelId,
      isLoadingRosterById,
      refreshChannelRoster,
      setRosterChannelSnapshot,
      isSidebarOpen: effectiveSidebarOpen,
      setIsSidebarOpen,
      isSettingsModalOpen: effectiveSettingsModalOpen,
      setIsSettingsModalOpen,
    }),
    [
      effectiveChannels,
      allCourseHubs,
      joinedCourseHubs,
      primaryChannelId,
      isLoadingChannels,
      isRefreshingChannels,
      effectiveChannelsError,
      refreshChannels,
      applyChannelsPatch,
      effectiveRosterByChannelId,
      isLoadingRosterById,
      refreshChannelRoster,
      setRosterChannelSnapshot,
      effectiveSidebarOpen,
      effectiveSettingsModalOpen,
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
