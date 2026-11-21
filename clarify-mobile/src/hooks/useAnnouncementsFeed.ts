import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useOptionalRealtime } from '../context/RealtimeContext';
import {
  acknowledgeAnnouncementApi,
  deleteAnnouncementApi,
  getAnnouncementsApi,
} from '../lib/api-client';
import {
  announcementFeedReducer,
  createInitialAnnouncementFeedState,
  hasMoreAnnouncementPages,
  shouldRefetchAnnouncementOnAckError,
} from '../lib/feed-reducer';
import {
  computeDebouncedRefreshDelayMs,
  patchAnnouncementFeedOnRealtimeEvent,
} from '../lib/realtime-reducer';
import type { Announcement, ApiError } from '../types/api';

export interface UseAnnouncementsFeedParams {
  channelId?: number | null;
  search?: string;
  tag?: string;
  sort?: 'latest' | 'oldest' | 'urgent_first' | 'read_reach';
  perPage?: number;
  enabled?: boolean;
}

/**
 * Reusable server-paginated announcements feed hook with pull-to-refresh,
 * server-authoritative Read Reach acknowledge, targeted 409/422 reconciliation,
 * and realtime in-place patching + debounced refresh.
 */
export function useAnnouncementsFeed({
  channelId = null,
  search = '',
  tag = 'ALL',
  sort = 'latest',
  perPage = 10,
  enabled = true,
}: UseAnnouncementsFeedParams) {
  const { user, showToast } = useAuth();
  const realtime = useOptionalRealtime();
  const [state, dispatch] = useReducer(
    announcementFeedReducer,
    perPage,
    createInitialAnnouncementFeedState
  );
  const [deletingIds, setDeletingIds] = useState<number[]>([]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const requestSeqRef = useRef(0);
  const inFlightMoreRef = useRef(false);
  const mountedRef = useRef(true);
  const debouncedRealtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastAnnouncementVersionRef = useRef<number>(
    realtime?.announcementVersion ?? 0
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debouncedRealtimeTimerRef.current) {
        clearTimeout(debouncedRealtimeTimerRef.current);
        debouncedRealtimeTimerRef.current = null;
      }
    };
  }, []);

  const fetchPage = useCallback(
    async (
      targetPage: number,
      mode: 'initial' | 'refresh' | 'silent' | 'more'
    ): Promise<void> => {
      if (!enabled) {
        return;
      }

      if (mode === 'more') {
        if (inFlightMoreRef.current) return;
        inFlightMoreRef.current = true;
        dispatch({ type: 'LOAD_MORE_START' });
      } else if (mode === 'refresh') {
        dispatch({ type: 'REFRESH_START' });
      } else if (mode === 'initial') {
        dispatch({ type: 'LOAD_START' });
      }

      const seq = ++requestSeqRef.current;

      try {
        const res = await getAnnouncementsApi({
          channel_id: channelId,
          search: search.trim() || undefined,
          tag: tag && tag !== 'ALL' ? tag : undefined,
          sort,
          page: targetPage,
          per_page: perPage,
        });

        if (!mountedRef.current || seq !== requestSeqRef.current) {
          return;
        }

        const list = Array.isArray(res?.data) ? res.data : [];
        const meta = res?.meta ?? {
          current_page: targetPage,
          last_page: targetPage,
          per_page: perPage,
          total: list.length,
        };

        dispatch({
          type: 'LOAD_SUCCESS',
          items: list,
          meta,
          append: mode === 'more',
        });
      } catch (err) {
        if (!mountedRef.current || seq !== requestSeqRef.current) {
          return;
        }
        if (mode !== 'silent') {
          dispatch({
            type: 'LOAD_ERROR',
            error: err as ApiError,
          });
        }
      } finally {
        if (mode === 'more') {
          inFlightMoreRef.current = false;
        }
      }
    },
    [enabled, channelId, search, tag, sort, perPage]
  );

  const scheduleDebouncedSilentRefresh = useCallback(() => {
    if (!enabled || AppState.currentState !== 'active') {
      return;
    }
    if (debouncedRealtimeTimerRef.current) {
      return;
    }
    const delayMs = computeDebouncedRefreshDelayMs();
    debouncedRealtimeTimerRef.current = setTimeout(() => {
      debouncedRealtimeTimerRef.current = null;
      if (!mountedRef.current || AppState.currentState !== 'active') {
        return;
      }
      void fetchPage(1, 'silent');
    }, delayMs);
  }, [enabled, fetchPage]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void fetchPage(1, 'initial');
  }, [enabled, fetchPage]);

  // Subscribe to realtime announcement events: patch in-place when possible, else debounced refresh
  useEffect(() => {
    if (!enabled || !realtime || !user?.id) {
      return;
    }

    return realtime.subscribeRealtimeEvents((event) => {
      const { state: nextState, shouldRefetch } =
        patchAnnouncementFeedOnRealtimeEvent(
          stateRef.current,
          event,
          user.id,
          channelId
        );

      if (nextState !== stateRef.current) {
        if (event.type === 'announcement.deleted') {
          const targetId = event.announcement?.id ?? event.message_id;
          if (targetId && targetId > 0) {
            dispatch({ type: 'REMOVE_ANNOUNCEMENT', announcementId: targetId });
          }
        } else {
          const updatedItem = nextState.items.find((item) => {
            const prev = stateRef.current.items.find((p) => p.id === item.id);
            return prev !== item;
          });
          if (updatedItem) {
            dispatch({ type: 'PATCH_ANNOUNCEMENT', announcement: updatedItem });
          }
        }
      }

      if (shouldRefetch) {
        scheduleDebouncedSilentRefresh();
      }
    });
  }, [enabled, realtime, user?.id, channelId, scheduleDebouncedSilentRefresh]);

  // React to foreground catch-up or manual announcementVersion bumps
  useEffect(() => {
    if (!enabled || !realtime) {
      return;
    }
    if (realtime.announcementVersion === lastAnnouncementVersionRef.current) {
      return;
    }
    lastAnnouncementVersionRef.current = realtime.announcementVersion;
    scheduleDebouncedSilentRefresh();
  }, [enabled, realtime, realtime?.announcementVersion, scheduleDebouncedSilentRefresh]);

  const refresh = useCallback(async () => {
    await fetchPage(1, 'refresh');
  }, [fetchPage]);

  const retry = useCallback(async () => {
    await fetchPage(1, 'initial');
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      state.isLoading ||
      state.isRefreshing ||
      state.isLoadingMore ||
      !hasMoreAnnouncementPages(state)
    ) {
      return;
    }
    await fetchPage(state.meta.current_page + 1, 'more');
  }, [enabled, state, fetchPage]);

  /**
   * Fallback targeted refresh for a single announcement ID when acknowledge returns 409 or 422.
   */
  const refetchSingleAnnouncementFallback = useCallback(
    async (target: Announcement) => {
      try {
        const res = await getAnnouncementsApi({
          channel_id: channelId ?? target.channel_id,
          search: search.trim() || undefined,
          tag: tag && tag !== 'ALL' ? tag : undefined,
          sort,
          page: 1,
          per_page: Math.max(perPage, state.items.length || perPage),
        });
        const fresh = (res?.data || []).find((item) => item.id === target.id);
        if (mountedRef.current && fresh) {
          dispatch({ type: 'PATCH_ANNOUNCEMENT', announcement: fresh });
        }
      } catch {
        // Non-fatal fallback; keep existing card visible
      }
    },
    [channelId, search, tag, sort, perPage, state.items.length]
  );

  const acknowledge = useCallback(
    async (announcement: Announcement) => {
      if (
        announcement.read_reach?.has_current_user_acknowledged ||
        state.ackLoadingIds.includes(announcement.id)
      ) {
        return;
      }

      dispatch({ type: 'ACK_START', announcementId: announcement.id });

      try {
        const res = await acknowledgeAnnouncementApi(announcement.id);
        if (!mountedRef.current) return;

        if (res?.data) {
          dispatch({ type: 'ACK_SUCCESS', announcement: res.data });
        } else {
          dispatch({ type: 'ACK_FINISH', announcementId: announcement.id });
        }
        showToast(
          res?.message || 'Announcement acknowledged. Read Reach updated.',
          'success'
        );
      } catch (err) {
        if (!mountedRef.current) return;
        const apiErr = err as ApiError;

        if (shouldRefetchAnnouncementOnAckError(apiErr)) {
          await refetchSingleAnnouncementFallback(announcement);
          dispatch({ type: 'ACK_FINISH', announcementId: announcement.id });
          showToast(
            apiErr.status === 409
              ? 'Already acknowledged. Refreshed latest Read Reach.'
              : apiErr.message || 'Announcement updated. Refreshed latest state.',
            'info'
          );
          return;
        }

        dispatch({ type: 'ACK_FINISH', announcementId: announcement.id });
        if (apiErr.status !== 401) {
          showToast(
            apiErr.message || 'Failed to acknowledge announcement.',
            'error'
          );
        }
      }
    },
    [state.ackLoadingIds, showToast, refetchSingleAnnouncementFallback]
  );

  const deleteAnnouncement = useCallback(
    async (announcement: Announcement) => {
      if (deletingIds.includes(announcement.id)) {
        return;
      }
      setDeletingIds((prev) => [...prev, announcement.id]);
      try {
        const res = await deleteAnnouncementApi(announcement.id);
        if (!mountedRef.current) return;
        dispatch({
          type: 'REMOVE_ANNOUNCEMENT',
          announcementId: announcement.id,
        });
        realtime?.triggerAnnouncementRefresh();
        showToast(
          res?.message || 'Announcement archived and removed from noticeboard.',
          'info'
        );
      } catch (err) {
        if (!mountedRef.current) return;
        const apiErr = err as ApiError;
        if (apiErr.status === 404 || apiErr.status === 409) {
          dispatch({
            type: 'REMOVE_ANNOUNCEMENT',
            announcementId: announcement.id,
          });
          showToast(
            'Announcement was already archived. Refreshed feed.',
            'info'
          );
        } else if (apiErr.status !== 401) {
          showToast(
            apiErr.message || 'Failed to archive announcement.',
            'error'
          );
        }
      } finally {
        if (mountedRef.current) {
          setDeletingIds((prev) => prev.filter((id) => id !== announcement.id));
        }
      }
    },
    [deletingIds, realtime, showToast]
  );

  return {
    ...state,
    deletingIds,
    hasMore: hasMoreAnnouncementPages(state),
    refresh,
    retry,
    loadMore,
    acknowledge,
    deleteAnnouncement,
  };
}
