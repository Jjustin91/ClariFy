import type {
  Announcement,
  ApiError,
  Channel,
  PaginatedMeta,
  ReadReach,
  User,
} from '../types/api.ts';
import {
  getJoinedCourseHubs,
  getSubChannelsForHub,
  getTopLevelCourseHubs,
} from './domain-logic.ts';

export interface AnnouncementFeedState {
  items: Announcement[];
  meta: PaginatedMeta;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: ApiError | null;
  ackLoadingIds: number[];
}

export const DEFAULT_FEED_META: PaginatedMeta = {
  current_page: 1,
  last_page: 1,
  per_page: 10,
  total: 0,
};

export function createInitialAnnouncementFeedState(
  perPage = 10
): AnnouncementFeedState {
  return {
    items: [],
    meta: {
      ...DEFAULT_FEED_META,
      per_page: perPage,
    },
    isLoading: true,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    ackLoadingIds: [],
  };
}

export type AnnouncementFeedAction =
  | { type: 'LOAD_START' }
  | { type: 'REFRESH_START' }
  | { type: 'LOAD_MORE_START' }
  | {
      type: 'LOAD_SUCCESS';
      items: Announcement[];
      meta: PaginatedMeta;
      append: boolean;
    }
  | { type: 'LOAD_ERROR'; error: ApiError }
  | { type: 'ACK_START'; announcementId: number }
  | { type: 'ACK_SUCCESS'; announcement: Announcement }
  | { type: 'ACK_FINISH'; announcementId: number }
  | { type: 'PATCH_ANNOUNCEMENT'; announcement: Announcement }
  | { type: 'RESET'; perPage?: number };

/**
 * Merges incoming paginated items while preserving order and preventing duplicate IDs.
 */
function mergeUniqueAnnouncements(
  existing: Announcement[],
  incoming: Announcement[]
): Announcement[] {
  const byId = new Map<number, Announcement>();
  const orderedIds: number[] = [];

  for (const item of existing) {
    byId.set(item.id, item);
    orderedIds.push(item.id);
  }

  for (const item of incoming) {
    if (!byId.has(item.id)) {
      orderedIds.push(item.id);
    }
    byId.set(item.id, item);
  }

  return orderedIds.map((id) => byId.get(id)!);
}

/**
 * Pure reducer managing paginated announcements feed, pull-to-refresh,
 * server-authoritative Read Reach updates, and single-card reconciliation.
 */
export function announcementFeedReducer(
  state: AnnouncementFeedState,
  action: AnnouncementFeedAction
): AnnouncementFeedState {
  switch (action.type) {
    case 'LOAD_START':
      return {
        ...state,
        isLoading: true,
        isRefreshing: false,
        isLoadingMore: false,
        error: null,
      };

    case 'REFRESH_START':
      return {
        ...state,
        isRefreshing: true,
        isLoadingMore: false,
        error: null,
      };

    case 'LOAD_MORE_START':
      return {
        ...state,
        isLoadingMore: true,
        error: null,
      };

    case 'LOAD_SUCCESS':
      return {
        ...state,
        items: action.append
          ? mergeUniqueAnnouncements(state.items, action.items)
          : action.items,
        meta: action.meta,
        isLoading: false,
        isRefreshing: false,
        isLoadingMore: false,
        error: null,
      };

    case 'LOAD_ERROR':
      return {
        ...state,
        isLoading: false,
        isRefreshing: false,
        isLoadingMore: false,
        error: action.error,
      };

    case 'ACK_START': {
      if (state.ackLoadingIds.includes(action.announcementId)) {
        return state;
      }
      return {
        ...state,
        ackLoadingIds: [...state.ackLoadingIds, action.announcementId],
      };
    }

    case 'ACK_SUCCESS':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.announcement.id ? action.announcement : item
        ),
        ackLoadingIds: state.ackLoadingIds.filter(
          (id) => id !== action.announcement.id
        ),
      };

    case 'ACK_FINISH':
      return {
        ...state,
        ackLoadingIds: state.ackLoadingIds.filter(
          (id) => id !== action.announcementId
        ),
      };

    case 'PATCH_ANNOUNCEMENT':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.announcement.id ? action.announcement : item
        ),
      };

    case 'RESET':
      return createInitialAnnouncementFeedState(
        action.perPage ?? state.meta.per_page
      );

    default:
      return state;
  }
}

/**
 * Returns true if an acknowledge error should trigger a targeted announcement refetch.
 * Per API contract: 409 (already handled/conflict) and 422 (stale/invalid state).
 */
export function shouldRefetchAnnouncementOnAckError(
  err: ApiError | null | undefined
): boolean {
  return err?.status === 409 || err?.status === 422;
}

/**
 * Given a fallback list of server announcements fetched after a 409/422 error,
 * patches ONLY the matching announcement ID without disturbing other loaded cards.
 */
export function patchOnlyTargetAnnouncementFromList(
  state: AnnouncementFeedState,
  targetId: number,
  serverItems: Announcement[]
): AnnouncementFeedState {
  const fresh = serverItems.find((item) => item.id === targetId);
  if (!fresh) {
    return announcementFeedReducer(state, {
      type: 'ACK_FINISH',
      announcementId: targetId,
    });
  }
  return announcementFeedReducer(state, {
    type: 'ACK_SUCCESS',
    announcement: fresh,
  });
}

/**
 * Returns true when another server page exists beyond the currently loaded page.
 */
export function hasMoreAnnouncementPages(state: AnnouncementFeedState): boolean {
  return state.meta.current_page < state.meta.last_page;
}

/**
 * Clamps the visual bar width percentage to [0, 100] while leaving the numeric
 * label strictly equal to whatever the server returned in `read_reach.percentage`.
 */
export function getReadReachBarFillPercent(readReach: ReadReach): number {
  const numeric = Number(readReach.percentage);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.min(100, numeric);
}

/**
 * Formats the Read Reach summary strictly using server-returned values
 * (no client-side minimums or recalculation).
 */
export function formatServerReadReachText(readReach: ReadReach): string {
  if (readReach.enrolled_total <= 0) {
    return 'No enrolled students yet';
  }
  return `${readReach.acknowledged_count} of ${readReach.enrolled_total} acknowledged (${readReach.percentage}%)`;
}

/**
 * Returns the accurate member count strictly from `channel.members_count`.
 * Never derives counts from `channel.roster.length` because channel lists do not load full rosters.
 */
export function getChannelMembersCount(channel: Channel | undefined): number {
  if (!channel || typeof channel.members_count !== 'number') {
    return 0;
  }
  return Math.max(0, channel.members_count);
}

export interface CourseHubHierarchyNode {
  hub: Channel;
  subChannels: Channel[];
  membersCount: number;
  studentsCount: number;
  isJoined: boolean;
}

/**
 * Organizes top-level Course Hubs with their nested `parent_hub_id` sub-channels,
 * filtering cleanly by search query without ever requiring full rosters.
 */
export function buildScopedChannelHierarchy(
  channels: Channel[],
  user: User | null | undefined,
  searchQuery = ''
): CourseHubHierarchyNode[] {
  const allHubs = getTopLevelCourseHubs(channels);
  const joinedIds = new Set(
    getJoinedCourseHubs(channels, user).map((hub) => hub.id)
  );
  const q = searchQuery.trim().toLowerCase();

  const nodes: CourseHubHierarchyNode[] = [];
  for (const hub of allHubs) {
    const subChannels = getSubChannelsForHub(channels, hub.id);
    if (q) {
      const hubText = `${hub.name} ${hub.course_code || ''} ${
        hub.scope_section || ''
      } ${hub.scope_department || ''}`.toLowerCase();
      const subMatches = subChannels.some((sub) =>
        sub.name.toLowerCase().includes(q)
      );
      if (!hubText.includes(q) && !subMatches) {
        continue;
      }
    }

    nodes.push({
      hub,
      subChannels,
      membersCount: getChannelMembersCount(hub),
      studentsCount:
        typeof hub.students_count === 'number'
          ? Math.max(0, hub.students_count)
          : 0,
      isJoined: joinedIds.has(hub.id),
    });
  }

  return nodes;
}
