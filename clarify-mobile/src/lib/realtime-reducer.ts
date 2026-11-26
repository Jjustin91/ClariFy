import type {
  Announcement,
  Channel,
  RealtimeEvent,
  User,
} from '../types/api.ts';
import {
  getChannelParentHubId,
  isUserCourseAdmin,
  patchChannelsOnThreadEvent,
} from './domain-logic.ts';
import {
  announcementFeedReducer,
  type AnnouncementFeedState,
} from './feed-reducer.ts';
import type { ReverbBroadcastPayload } from './reverb-client.ts';

export const ALL_REALTIME_EVENT_TYPES: readonly RealtimeEvent['type'][] = [
  'connected',
  'announcement.urgent',
  'announcement.created',
  'announcement.updated',
  'announcement.deleted',
  'announcement.acknowledged',
  'chat.message',
  'chat.message_unsent',
  'thread.created',
  'thread.updated',
  'thread.deleted',
  'thread.replied',
  'thread.faq_pinned',
  'channel.created',
  'channel.updated',
  'membership.changed',
  'admin.updated',
  'db.changed',
] as const;

export interface RealtimeToastNotice {
  message: string;
  variant: 'success' | 'info' | 'error';
}

export interface RealtimeEventPlan {
  shouldScheduleChannelRefresh: boolean;
  shouldImmediateChannelRefresh: boolean;
  rosterChannelIdToRefresh: number | null;
  shouldBumpAnnouncementVersion: boolean;
  shouldBumpAdminVersion: boolean;
  shouldCheckUrgentAnnouncement: boolean;
  urgentPopupCandidate: Announcement | null;
  dismissUrgentPopupId: number | null;
  toast: RealtimeToastNotice | null;
  ignoredReason: string | null;
}

/**
 * Extracts the deleted announcement ID from an `announcement.deleted` realtime event.
 */
export function resolveDeletedAnnouncementId(
  event: Pick<
    RealtimeEvent,
    'type' | 'announcement_id' | 'announcement' | 'message_id'
  >
): number | null {
  if (event.type !== 'announcement.deleted') {
    return null;
  }
  const candidate = Number(
    event.announcement_id ?? event.announcement?.id ?? event.message_id ?? 0
  );
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

/**
 * Pure reducer for `urgentPopupAnnouncement` state on incoming realtime events.
 * Closes the urgent popup when `announcement.deleted` matches its ID, and patches live
 * Read Reach counts on `announcement.acknowledged` while preserving the local ack flag.
 */
export function reduceUrgentPopupOnRealtimeEvent(
  current: Announcement | null,
  event: RealtimeEvent,
  currentUserId?: number
): Announcement | null {
  if (!current) {
    return null;
  }

  if (event.type === 'announcement.deleted') {
    const deletedId = resolveDeletedAnnouncementId(event);
    if (deletedId !== null && Number(current.id) === deletedId) {
      return null;
    }
    return current;
  }

  if (event.type === 'announcement.acknowledged') {
    const incoming = event.announcement;
    const targetId = Number(event.announcement_id ?? incoming?.id ?? 0);
    if (
      targetId > 0 &&
      Number(current.id) === targetId &&
      incoming?.read_reach
    ) {
      const isSelfAck =
        Boolean(currentUserId) &&
        Boolean(event.actor_id) &&
        Number(event.actor_id) === Number(currentUserId);
      return {
        ...current,
        read_reach: {
          acknowledged_count: incoming.read_reach.acknowledged_count,
          enrolled_total: incoming.read_reach.enrolled_total,
          percentage: incoming.read_reach.percentage,
          has_current_user_acknowledged: isSelfAck
            ? Boolean(incoming.read_reach.has_current_user_acknowledged)
            : Boolean(current.read_reach.has_current_user_acknowledged),
        },
      };
    }
    return current;
  }

  if (event.type === 'announcement.updated' && event.announcement) {
    if (
      Number(event.announcement.id) === Number(current.id) &&
      event.announcement.status === 'archived'
    ) {
      return null;
    }
  }

  if (
    event.type === 'membership.changed' &&
    (event.action === 'left' || event.action === 'removed') &&
    Boolean(currentUserId) &&
    Number(event.target_user_id) === Number(currentUserId) &&
    event.channel_id &&
    Number(current.channel_id) === Number(event.channel_id)
  ) {
    return null;
  }

  return current;
}

/**
 * Returns debounced refresh delay (~1.5s + 0-400ms random jitter) so concurrent
 * realtime events collapse into a single network refetch.
 */
export function computeDebouncedRefreshDelayMs(
  randomValue: number = Math.random()
): number {
  const clamped = Math.min(0.9999, Math.max(0, randomValue));
  return 1500 + Math.floor(clamped * 400);
}

/**
 * Normalizes a raw Reverb broadcast payload into a strongly typed RealtimeEvent.
 */
export function normalizeReverbPayloadToEvent(
  payload: ReverbBroadcastPayload,
  fallbackChannelId?: number,
  nowMs: number = Date.now()
): RealtimeEvent {
  return {
    revision: nowMs,
    type: payload.type || 'db.changed',
    channel_id: payload.channel_id ?? fallbackChannelId,
    announcement_id: payload.announcement_id ?? payload.announcement?.id,
    message_id: payload.message_id,
    target_user_id: payload.target_user_id,
    action: payload.action,
    actor_id: payload.actor_id,
    announcement: payload.announcement,
    message: payload.message,
    thread: payload.thread,
    timestamp: payload.timestamp || new Date(nowMs).toISOString(),
  };
}

/**
 * Resolves the top-level Course Hub ID for a channel or sub-channel ID.
 */
function resolveTargetHubId(
  channels: Channel[],
  rawChannelId: number
): number {
  const matched = channels.find((c) => Number(c.id) === rawChannelId);
  const parentHubId = getChannelParentHubId(matched);
  return parentHubId && parentHubId > 0 ? parentHubId : rawChannelId;
}

/**
 * Formats a concise chat preview snippet for Course Hub cards when a realtime chat event arrives.
 */
function formatChatPreviewSnippet(event: RealtimeEvent): string {
  const msg = event.message;
  const senderName = msg?.author?.name?.trim() || 'Campus Member';
  if (msg?.attachment && !msg.content?.trim()) {
    return `${senderName}: Shared an attachment in chat`;
  }
  const rawText = (msg?.content || '').trim();
  if (!rawText) {
    return `${senderName}: Sent a message`;
  }
  if (rawText.startsWith('__CLARIFY_MEDIA__')) {
    return `${senderName}: Shared an attachment in chat`;
  }
  const truncated =
    rawText.length > 90 ? `${rawText.slice(0, 87).trimEnd()}...` : rawText;
  return `${senderName}: ${truncated}`;
}

/**
 * Pure reducer that patches the local channels list from a RealtimeEvent payload
 * without needing an immediate full channel list refetch.
 */
export function reduceChannelsOnRealtimeEvent(
  channels: Channel[],
  event: RealtimeEvent,
  currentUser: User,
  currentlyViewedHubId = 0
): { channels: Channel[]; mutated: boolean } {
  if (channels.length === 0) {
    return { channels, mutated: false };
  }

  switch (event.type) {
    case 'thread.created':
    case 'thread.updated':
    case 'thread.deleted':
    case 'thread.replied':
    case 'thread.faq_pinned':
      return patchChannelsOnThreadEvent(
        channels,
        event,
        currentUser,
        currentlyViewedHubId
      );

    case 'chat.message': {
      const rawChannelId = Number(
        event.channel_id || event.message?.channel_id || 0
      );
      if (rawChannelId <= 0) {
        return { channels, mutated: false };
      }

      const targetHubId = resolveTargetHubId(channels, rawChannelId);
      const actorId = Number(event.actor_id || event.message?.author?.id || 0);
      const isOtherActor = actorId === 0 || actorId !== Number(currentUser.id);
      const shouldBumpUnseen =
        isOtherActor && targetHubId !== Number(currentlyViewedHubId);

      let mutated = false;
      const nextChannels = channels.map((ch) => {
        if (Number(ch.id) !== targetHubId) return ch;
        mutated = true;

        const prevBreakdown = ch.new_activity_breakdown ?? {
          chat: 0,
          announcements: 0,
          qa: 0,
        };

        return {
          ...ch,
          chat_messages_count: Math.max(0, Number(ch.chat_messages_count ?? 0)) + 1,
          latest_activity_preview: event.message
            ? formatChatPreviewSnippet(event)
            : ch.latest_activity_preview,
          latest_activity_at: 'Just now',
          has_updates: shouldBumpUnseen ? true : ch.has_updates,
          new_activity_count: shouldBumpUnseen
            ? (ch.new_activity_count ?? 0) + 1
            : ch.new_activity_count ?? 0,
          new_activity_breakdown: shouldBumpUnseen
            ? {
                ...prevBreakdown,
                chat: (prevBreakdown.chat ?? 0) + 1,
              }
            : prevBreakdown,
          new_activity_sub_channel_id:
            shouldBumpUnseen && rawChannelId !== targetHubId
              ? rawChannelId
              : ch.new_activity_sub_channel_id,
        };
      });

      return { channels: mutated ? nextChannels : channels, mutated };
    }

    case 'chat.message_unsent': {
      const rawChannelId = Number(event.channel_id || 0);
      if (rawChannelId <= 0) {
        return { channels, mutated: false };
      }
      const targetHubId = resolveTargetHubId(channels, rawChannelId);
      let mutated = false;
      const nextChannels = channels.map((ch) => {
        if (Number(ch.id) !== targetHubId) return ch;
        mutated = true;
        return {
          ...ch,
          chat_messages_count: Math.max(
            0,
            Number(ch.chat_messages_count ?? 0) - 1
          ),
        };
      });
      return { channels: mutated ? nextChannels : channels, mutated };
    }

    case 'announcement.urgent':
    case 'announcement.created': {
      const rawChannelId = Number(
        event.channel_id || event.announcement?.channel_id || 0
      );
      if (rawChannelId <= 0) {
        return { channels, mutated: false };
      }
      const targetHubId = resolveTargetHubId(channels, rawChannelId);
      const actorId = Number(
        event.actor_id || event.announcement?.publisher?.id || 0
      );
      const isOtherActor = actorId === 0 || actorId !== Number(currentUser.id);
      const shouldBumpUnseen =
        isOtherActor && targetHubId !== Number(currentlyViewedHubId);

      if (!shouldBumpUnseen && !event.announcement?.content) {
        return { channels, mutated: false };
      }

      let mutated = false;
      const nextChannels = channels.map((ch) => {
        if (Number(ch.id) !== targetHubId) return ch;
        mutated = true;

        const prevBreakdown = ch.new_activity_breakdown ?? {
          chat: 0,
          announcements: 0,
          qa: 0,
        };

        const pubName =
          event.announcement?.publisher?.name ||
          ch.instructor_name ||
          'Faculty';
        const annContent = (event.announcement?.content || '').trim();
        const preview = annContent
          ? `${pubName}: ${annContent.length > 90 ? `${annContent.slice(0, 87).trimEnd()}...` : annContent}`
          : ch.latest_activity_preview;

        return {
          ...ch,
          latest_activity_preview: preview,
          latest_activity_at: annContent ? 'Just now' : ch.latest_activity_at,
          has_updates: shouldBumpUnseen ? true : ch.has_updates,
          new_activity_count: shouldBumpUnseen
            ? (ch.new_activity_count ?? 0) + 1
            : ch.new_activity_count ?? 0,
          new_activity_breakdown: shouldBumpUnseen
            ? {
                ...prevBreakdown,
                announcements: (prevBreakdown.announcements ?? 0) + 1,
              }
            : prevBreakdown,
        };
      });

      return { channels: mutated ? nextChannels : channels, mutated };
    }

    case 'connected':
    case 'announcement.updated':
    case 'announcement.deleted':
    case 'announcement.acknowledged':
    case 'channel.created':
    case 'channel.updated':
    case 'membership.changed':
    case 'admin.updated':
    case 'db.changed':
      return { channels, mutated: false };

    default: {
      const exhaustiveCheck: never = event.type;
      return { channels, mutated: Boolean(exhaustiveCheck && false) };
    }
  }
}

/**
 * Pure side-effect planner covering EVERY event type in RealtimeEvent['type'].
 * Determines which targeted resource should be refetched (debounced or immediate),
 * whether an urgent popup or toast should appear, or why an event is intentionally a no-op.
 */
export function planRealtimeEventEffects(
  event: RealtimeEvent,
  currentUser: User,
  options: {
    channels?: Channel[];
    dismissedUrgentIds?: ReadonlySet<number>;
    cachedRosterChannelIds?: ReadonlySet<number>;
  } = {}
): RealtimeEventPlan {
  const emptyPlan: RealtimeEventPlan = {
    shouldScheduleChannelRefresh: false,
    shouldImmediateChannelRefresh: false,
    rosterChannelIdToRefresh: null,
    shouldBumpAnnouncementVersion: false,
    shouldBumpAdminVersion: false,
    shouldCheckUrgentAnnouncement: false,
    urgentPopupCandidate: null,
    dismissUrgentPopupId: null,
    toast: null,
    ignoredReason: null,
  };

  const channels = options.channels ?? [];
  const dismissedUrgentIds = options.dismissedUrgentIds ?? new Set<number>();
  const cachedRosterChannelIds =
    options.cachedRosterChannelIds ?? new Set<number>();
  const isSelfActor =
    Boolean(event.actor_id) && Number(event.actor_id) === Number(currentUser.id);
  const isItAdmin = currentUser.role === 'it_admin';

  switch (event.type) {
    case 'connected':
      return {
        ...emptyPlan,
        ignoredReason:
          'Connection handshake acknowledgement; no data refetch required.',
      };

    case 'announcement.urgent': {
      const ann = event.announcement;
      const isPublished = !ann?.status || ann.status === 'published';
      const hasFullAnnouncement = Boolean(
        ann && ann.id && ann.title && ann.content && isPublished
      );
      const isAlreadyDismissed = ann?.id
        ? dismissedUrgentIds.has(ann.id)
        : false;
      const isAlreadyAcked = Boolean(
        ann?.read_reach?.has_current_user_acknowledged && isSelfActor
      );
      const shouldShowPopup =
        !isItAdmin &&
        !isSelfActor &&
        hasFullAnnouncement &&
        !isAlreadyDismissed &&
        !isAlreadyAcked;

      const normalizedCandidate =
        shouldShowPopup && ann
          ? {
              ...ann,
              read_reach: {
                ...ann.read_reach,
                has_current_user_acknowledged: false,
              },
            }
          : null;

      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        shouldBumpAnnouncementVersion: !isItAdmin,
        shouldCheckUrgentAnnouncement:
          !isItAdmin && !isSelfActor && !hasFullAnnouncement,
        urgentPopupCandidate: normalizedCandidate,
      };
    }

    case 'announcement.created':
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        shouldBumpAnnouncementVersion: !isItAdmin,
      };

    case 'announcement.updated': {
      const ann = event.announcement;
      const isUrgentUpdate = Boolean(ann?.is_urgent);
      const isPublished = !ann?.status || ann.status === 'published';
      const hasFullAnnouncement = Boolean(
        ann && ann.id && ann.title && ann.content && isPublished
      );
      const shouldShowPopup =
        !isItAdmin &&
        !isSelfActor &&
        isUrgentUpdate &&
        hasFullAnnouncement &&
        Boolean(ann?.id && !dismissedUrgentIds.has(ann.id));

      const normalizedCandidate =
        shouldShowPopup && ann
          ? {
              ...ann,
              read_reach: {
                ...ann.read_reach,
                has_current_user_acknowledged: false,
              },
            }
          : null;

      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        shouldBumpAnnouncementVersion: !isItAdmin,
        urgentPopupCandidate: normalizedCandidate,
      };
    }

    case 'announcement.deleted': {
      const deletedId = resolveDeletedAnnouncementId(event);
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        shouldBumpAnnouncementVersion: !isItAdmin && deletedId === null,
        dismissUrgentPopupId: deletedId,
      };
    }

    case 'announcement.acknowledged':
      // Handled in-place by feed subscribers when full announcement is attached;
      // bump announcementVersion only when global minimal payload lacks read_reach.
      return {
        ...emptyPlan,
        shouldBumpAnnouncementVersion:
          !isItAdmin && !event.announcement?.read_reach,
        ignoredReason: event.announcement?.read_reach
          ? null
          : 'Minimal global ack event lacks read_reach; scheduled feed refresh.',
      };

    case 'chat.message':
      return {
        ...emptyPlan,
        // Local channel preview/counts already patched when event.message is present;
        // refetch channels only when payload was minimal (no message body).
        shouldScheduleChannelRefresh: !isItAdmin && !event.message,
      };

    case 'chat.message_unsent':
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
      };

    case 'thread.created':
    case 'thread.updated':
    case 'thread.deleted':
    case 'thread.replied':
    case 'thread.faq_pinned':
      return {
        ...emptyPlan,
        // Local unread_count & unseen qa breakdown patched by reduceChannelsOnRealtimeEvent;
        // schedule debounced channel sync to reconcile server totals cleanly.
        shouldScheduleChannelRefresh: !isItAdmin,
      };

    case 'channel.created':
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
      };

    case 'channel.updated': {
      const affectedChannelId =
        event.channel_id && event.channel_id > 0 ? Number(event.channel_id) : null;
      const shouldRefreshRoster = Boolean(
        !isItAdmin &&
          affectedChannelId &&
          cachedRosterChannelIds.has(affectedChannelId)
      );
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        rosterChannelIdToRefresh: shouldRefreshRoster ? affectedChannelId : null,
      };
    }

    case 'membership.changed': {
      const affectedChannelId =
        event.channel_id && event.channel_id > 0 ? Number(event.channel_id) : null;
      const isTargetUser =
        Boolean(event.target_user_id) &&
        Number(event.target_user_id) === Number(currentUser.id);
      const affectedHub = affectedChannelId
        ? channels.find((c) => Number(c.id) === affectedChannelId)
        : undefined;
      const isAdminOfAffectedHub = Boolean(
        affectedHub && isUserCourseAdmin(affectedHub, currentUser)
      );
      const shouldRefreshRoster = Boolean(
        !isItAdmin &&
          affectedChannelId &&
          (isAdminOfAffectedHub ||
            cachedRosterChannelIds.has(affectedChannelId))
      );

      let toast: RealtimeToastNotice | null = null;
      if (isTargetUser) {
        const hubName = affectedHub?.name || 'Course Hub';
        if (event.action === 'approved') {
          toast = {
            message: `Your request to join ${hubName} was approved!`,
            variant: 'success',
          };
        } else if (event.action === 'rejected') {
          toast = {
            message: `Your request to join ${hubName} was declined.`,
            variant: 'info',
          };
        } else if (event.action === 'removed') {
          toast = {
            message: `You were removed from ${hubName}.`,
            variant: 'info',
          };
        } else if (event.action === 'added') {
          toast = {
            message: `You were added to ${hubName}.`,
            variant: 'success',
          };
        }
      }

      return {
        ...emptyPlan,
        shouldImmediateChannelRefresh: !isItAdmin && isTargetUser,
        shouldScheduleChannelRefresh: !isItAdmin && !isTargetUser,
        rosterChannelIdToRefresh: shouldRefreshRoster ? affectedChannelId : null,
        shouldBumpAnnouncementVersion: !isItAdmin && isTargetUser,
        toast,
      };
    }

    case 'admin.updated':
      return {
        ...emptyPlan,
        shouldBumpAdminVersion: true,
        shouldScheduleChannelRefresh: !isItAdmin,
      };

    case 'db.changed':
      return {
        ...emptyPlan,
        shouldScheduleChannelRefresh: !isItAdmin,
        shouldBumpAnnouncementVersion: !isItAdmin,
        shouldBumpAdminVersion: isItAdmin,
      };

    default: {
      const exhaustiveCheck: never = event.type;
      return {
        ...emptyPlan,
        ignoredReason: `Unhandled event type: ${String(exhaustiveCheck)}`,
      };
    }
  }
}

/**
 * Reconciles an AnnouncementFeedState against a RealtimeEvent without unnecessary refetches.
 * Crucially preserves the local user's `has_current_user_acknowledged` flag when another user
 * broadcasts `announcement.acknowledged`.
 */
export function patchAnnouncementFeedOnRealtimeEvent(
  state: AnnouncementFeedState,
  event: RealtimeEvent,
  currentUserId: number,
  activeChannelFilterId?: number | null
): { state: AnnouncementFeedState; shouldRefetch: boolean } {
  const matchesFilter = (channelId?: number) =>
    !activeChannelFilterId ||
    !channelId ||
    Number(channelId) === Number(activeChannelFilterId);

  switch (event.type) {
    case 'announcement.acknowledged': {
      const incoming = event.announcement;
      if (!incoming?.id || !incoming.read_reach) {
        return { state, shouldRefetch: matchesFilter(event.channel_id) };
      }

      const existing = state.items.find((item) => item.id === incoming.id);
      if (!existing) {
        return { state, shouldRefetch: false };
      }

      const isSelfAck =
        Boolean(event.actor_id) && Number(event.actor_id) === Number(currentUserId);

      const patched: Announcement = {
        ...existing,
        read_reach: {
          acknowledged_count: incoming.read_reach.acknowledged_count,
          enrolled_total: incoming.read_reach.enrolled_total,
          percentage: incoming.read_reach.percentage,
          has_current_user_acknowledged: isSelfAck
            ? Boolean(incoming.read_reach.has_current_user_acknowledged)
            : Boolean(existing.read_reach.has_current_user_acknowledged),
        },
      };

      return {
        state: announcementFeedReducer(state, {
          type: 'PATCH_ANNOUNCEMENT',
          announcement: patched,
        }),
        shouldRefetch: false,
      };
    }

    case 'announcement.updated':
    case 'announcement.urgent': {
      const incoming = event.announcement;
      if (incoming?.id && incoming.title && incoming.content) {
        const existing = state.items.find((item) => item.id === incoming.id);
        if (existing) {
          const isSelfActor =
            Boolean(event.actor_id) &&
            Number(event.actor_id) === Number(currentUserId);
          const merged: Announcement = {
            ...incoming,
            read_reach: {
              ...incoming.read_reach,
              has_current_user_acknowledged: isSelfActor
                ? incoming.read_reach.has_current_user_acknowledged
                : existing.read_reach.has_current_user_acknowledged,
            },
          };
          return {
            state: announcementFeedReducer(state, {
              type: 'PATCH_ANNOUNCEMENT',
              announcement: merged,
            }),
            shouldRefetch: false,
          };
        }
      }
      return {
        state,
        shouldRefetch: matchesFilter(event.channel_id ?? incoming?.channel_id),
      };
    }

    case 'announcement.created':
      return {
        state,
        shouldRefetch: matchesFilter(
          event.channel_id ?? event.announcement?.channel_id
        ),
      };

    case 'announcement.deleted': {
      const targetId =
        event.announcement_id ?? event.announcement?.id ?? event.message_id;
      if (targetId && targetId > 0) {
        const exists = state.items.some((item) => item.id === targetId);
        if (exists) {
          return {
            state: announcementFeedReducer(state, {
              type: 'REMOVE_ANNOUNCEMENT',
              announcementId: targetId,
            }),
            shouldRefetch: false,
          };
        }
        return { state, shouldRefetch: false };
      }
      return {
        state,
        shouldRefetch: matchesFilter(event.channel_id),
      };
    }

    case 'membership.changed': {
      const isSelfLeftOrRemoved =
        Boolean(event.target_user_id) &&
        Number(event.target_user_id) === Number(currentUserId) &&
        (event.action === 'left' || event.action === 'removed');
      if (
        isSelfLeftOrRemoved &&
        event.channel_id &&
        Number(event.channel_id) > 0
      ) {
        return {
          state: announcementFeedReducer(state, {
            type: 'REMOVE_CHANNEL_ANNOUNCEMENTS',
            channelIds: [Number(event.channel_id)],
          }),
          shouldRefetch: true,
        };
      }
      return { state, shouldRefetch: false };
    }

    case 'db.changed':
      return { state, shouldRefetch: true };

    default:
      return { state, shouldRefetch: false };
  }
}

export interface PushNotificationDataPayload {
  type?: string;
  channel_id?: number | string | null;
  announcement_id?: number | string | null;
}

/**
 * Resolves a deep-link route inside `(drawer)` from an Expo push notification payload
 * (e.g. DispatchUrgentPushAlerts `{ type: 'announcement.urgent', announcement_id, channel_id }`).
 */
export function resolvePushNotificationRoute(
  rawData: Record<string, unknown> | null | undefined,
  knownCourseHubIds?: ReadonlySet<number>
): string | null {
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  const data = rawData as PushNotificationDataPayload;
  const parsedChannelId = Number(data.channel_id ?? 0);
  const parsedAnnouncementId = Number(data.announcement_id ?? 0);
  const hasValidChannelId =
    Number.isInteger(parsedChannelId) && parsedChannelId > 0;
  const hasValidAnnouncementId =
    Number.isInteger(parsedAnnouncementId) && parsedAnnouncementId > 0;

  if (
    hasValidChannelId &&
    (!knownCourseHubIds ||
      knownCourseHubIds.size === 0 ||
      knownCourseHubIds.has(parsedChannelId))
  ) {
    return hasValidAnnouncementId
      ? `/(drawer)/channels/${parsedChannelId}?announcementId=${parsedAnnouncementId}`
      : `/(drawer)/channels/${parsedChannelId}`;
  }

  if (hasValidAnnouncementId) {
    return `/(drawer)/announcements?announcementId=${parsedAnnouncementId}`;
  }

  if (hasValidChannelId) {
    return '/(drawer)/announcements';
  }

  return null;
}

/**
 * Computes a visible user-facing status banner message when realtime updates are unavailable
 * (e.g., blank EXPO_PUBLIC_REVERB_APP_KEY on a non-local host, or socket failed/unavailable).
 * Returns null when realtime is healthy or intentionally paused in the background.
 */
export function getRealtimeUnavailableBannerMessage(params: {
  isAuthenticated: boolean;
  isConfigured: boolean;
  unconfiguredMessage?: string | null;
  connectionState:
    | 'unconfigured'
    | 'initialized'
    | 'connecting'
    | 'connected'
    | 'unavailable'
    | 'failed'
    | 'disconnected'
    | 'paused';
}): string | null {
  if (!params.isAuthenticated) {
    return null;
  }

  if (!params.isConfigured || params.connectionState === 'unconfigured') {
    return (
      params.unconfiguredMessage ||
      'Live updates unavailable. Pull down to refresh announcements and chat.'
    );
  }

  if (
    params.connectionState === 'unavailable' ||
    params.connectionState === 'failed'
  ) {
    return 'Live updates unavailable — reconnecting. Pull down to refresh.';
  }

  return null;
}

/**
 * Normalizes the pending verification badge count for the IT Admin drawer entry.
 * Prefers `metrics.pending_verifications_count` from the API, falling back to a local count if needed.
 */
export function resolveAdminPendingCount(
  metricsPendingCount: number | null | undefined,
  fallbackCount?: number | null
): number | null {
  if (
    typeof metricsPendingCount === 'number' &&
    Number.isFinite(metricsPendingCount) &&
    metricsPendingCount >= 0
  ) {
    return Math.floor(metricsPendingCount);
  }
  if (
    typeof fallbackCount === 'number' &&
    Number.isFinite(fallbackCount) &&
    fallbackCount >= 0
  ) {
    return Math.floor(fallbackCount);
  }
  return null;
}

/**
 * Formats the pending verification count for display in the IT Admin drawer badge.
 * Returns null when the badge should be hidden (null, undefined, or <= 0).
 */
export function formatAdminPendingBadgeLabel(
  count: number | null | undefined
): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  const normalized = Math.floor(count);
  return normalized > 99 ? '99+' : String(normalized);
}

/**
 * Returns true only when the active user is an authenticated IT Administrator
 * and the app is in the foreground (prevents background/non-admin fetches).
 */
export function shouldFetchAdminPendingCount(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  isAppActive: boolean
): boolean {
  return Boolean(user && user.id > 0 && user.role === 'it_admin' && isAppActive);
}


