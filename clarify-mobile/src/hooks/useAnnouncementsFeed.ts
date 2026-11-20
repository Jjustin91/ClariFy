import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useAuth } from '../context/AuthContext';
import {
  acknowledgeAnnouncementApi,
  getAnnouncementsApi,
} from '../lib/api-client';
import {
  announcementFeedReducer,
  createInitialAnnouncementFeedState,
  hasMoreAnnouncementPages,
  shouldRefetchAnnouncementOnAckError,
} from '../lib/feed-reducer';
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
 * server-authoritative Read Reach acknowledge, and targeted 409/422 reconciliation.
 */
export function useAnnouncementsFeed({
  channelId = null,
  search = '',
  tag = 'ALL',
  sort = 'latest',
  perPage = 10,
  enabled = true,
}: UseAnnouncementsFeedParams) {
  const { showToast } = useAuth();
  const [state, dispatch] = useReducer(
    announcementFeedReducer,
    perPage,
    createInitialAnnouncementFeedState
  );

  const requestSeqRef = useRef(0);
  const inFlightMoreRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (
      targetPage: number,
      mode: 'initial' | 'refresh' | 'more'
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
      } else {
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
        dispatch({
          type: 'LOAD_ERROR',
          error: err as ApiError,
        });
      } finally {
        if (mode === 'more') {
          inFlightMoreRef.current = false;
        }
      }
    },
    [enabled, channelId, search, tag, sort, perPage]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void fetchPage(1, 'initial');
  }, [enabled, fetchPage]);

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
   * Uses existing GET /announcements until backend adds GET /announcements/{id} (see API REQUEST).
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

  return {
    ...state,
    hasMore: hasMoreAnnouncementPages(state),
    refresh,
    retry,
    loadMore,
    acknowledge,
  };
}
