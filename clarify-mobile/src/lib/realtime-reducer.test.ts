import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapHttpErrorToApiError,
  registerExpoPushTokenApi,
} from './api-client.ts';
import {
  announcementFeedReducer,
  createInitialAnnouncementFeedState,
} from './feed-reducer.ts';
import {
  ALL_REALTIME_EVENT_TYPES,
  computeDebouncedRefreshDelayMs,
  formatAdminPendingBadgeLabel,
  getRealtimeUnavailableBannerMessage,
  normalizeReverbPayloadToEvent,
  patchAnnouncementFeedOnRealtimeEvent,
  planRealtimeEventEffects,
  reduceChannelsOnRealtimeEvent,
  reduceUrgentPopupOnRealtimeEvent,
  resolveAdminPendingCount,
  resolveDeletedAnnouncementId,
  resolvePushNotificationRoute,
  shouldFetchAdminPendingCount,
} from './realtime-reducer.ts';
import {
  computeReconnectBackoffMs,
  getReverbConfigurationStatus,
  getReverbEcho,
  resolveReverbConfig,
} from './reverb-client.ts';
import {
  clearSecureToken,
  setSecureToken,
  setSecureTokenStorageAdapterForTests,
} from './secure-token.ts';
import type { Announcement, Channel, RealtimeEvent, User } from '../types/api.ts';

const studentUser: User = {
  id: 10,
  institutional_id: '2023300010',
  name: 'Juan Dela Cruz',
  email: 'juan.delacruz@ustp.edu.ph',
  role: 'student',
  verification_status: 'approved',
};

const facultyUser: User = {
  id: 2,
  institutional_id: 'FAC-002',
  name: 'Prof. Aki Hayakawa',
  email: 'aki.hayakawa@ustp.edu.ph',
  role: 'faculty',
  verification_status: 'approved',
};

const itAdminUser: User = {
  id: 1,
  institutional_id: 'ADM-001',
  name: 'IT Admin',
  email: 'admin@ustp.edu.ph',
  role: 'it_admin',
  verification_status: 'approved',
};

function makeChannel(id: number, overrides: Partial<Channel> = {}): Channel {
  return {
    id,
    parent_hub_id: null,
    course_code: 'IT314',
    name: '#IT314 Software Engineering',
    description: 'Scoped Course Hub',
    channel_type: 'course_hub',
    scope_college: 'CITC',
    scope_department: 'CITC',
    scope_section: 'IT3R2',
    unread_count: 1,
    chat_messages_count: 5,
    has_updates: false,
    new_activity_count: 0,
    new_activity_breakdown: { chat: 0, announcements: 0, qa: 0 },
    members_count: 42,
    students_count: 40,
    roster: [],
    ...overrides,
  };
}

function makeAnnouncement(
  id: number,
  overrides: Partial<Announcement> = {}
): Announcement {
  return {
    id,
    channel_id: 100,
    channel_type: 'course_hub',
    course_code: 'IT314',
    channel_name: 'IT314 Software Engineering',
    title: `Notice #${id}`,
    content: `Announcement content #${id}`,
    attachment_url: null,
    tags: ['CITC'],
    is_urgent: false,
    is_pinned: false,
    status: 'published',
    is_edited: false,
    published_at: '2026-11-20T08:00:00Z',
    updated_at: '2026-11-20T08:00:00Z',
    read_reach: {
      acknowledged_count: 10,
      enrolled_total: 40,
      percentage: 25,
      has_current_user_acknowledged: false,
    },
    publisher: {
      id: 2,
      name: 'Prof. Aki Hayakawa',
      role: 'faculty',
      department: 'CITC',
    },
    ...overrides,
  };
}

test('resolveReverbConfig enforces WSS on 443 for production host and refuses unconfigured production', () => {
  const missingKey = resolveReverbConfig(
    {},
    'https://api.ustpclarify.tech/api/v1'
  );
  assert.equal(missingKey, null);

  const prod = resolveReverbConfig(
    {
      EXPO_PUBLIC_REVERB_APP_KEY: 'prod-reverb-key',
      EXPO_PUBLIC_REVERB_SCHEME: 'http', // Must be ignored on non-local host
    },
    'https://api.ustpclarify.tech/api/v1'
  );
  assert.ok(prod);
  assert.equal(prod.wsHost, 'api.ustpclarify.tech');
  assert.equal(prod.wsPort, 443);
  assert.equal(prod.wssPort, 443);
  assert.equal(prod.forceTLS, true);
  assert.equal(prod.forceTLS, true);
  assert.equal(prod.wssPort, 443);
  assert.equal(
    prod.authEndpoint,
    'https://api.ustpclarify.tech/api/v1/broadcasting/auth'
  );

  const local = resolveReverbConfig(
    { EXPO_PUBLIC_REVERB_HOST: '127.0.0.1' },
    'http://127.0.0.1:8000/api/v1'
  );
  assert.ok(local);
  assert.equal(local.isLocalHost, true);
  assert.equal(local.forceTLS, false);
  assert.equal(local.wsPort, 8080);
  assert.deepEqual(local.enabledTransports, ['ws', 'wss']);
});

test('getReverbEcho never connects anonymously without a SecureStore bearer token', async () => {
  setSecureTokenStorageAdapterForTests({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  });
  await clearSecureToken();
  assert.equal(getReverbEcho(), null);
});

test('debounce jitter and exponential reconnect backoff stay within safe bounds', () => {
  assert.equal(computeDebouncedRefreshDelayMs(0), 1500);
  assert.equal(computeDebouncedRefreshDelayMs(0.5), 1700);
  assert.ok(computeDebouncedRefreshDelayMs(1) < 1900);

  assert.equal(computeReconnectBackoffMs(0, 0), 1000);
  assert.equal(computeReconnectBackoffMs(1, 0), 2000);
  assert.equal(computeReconnectBackoffMs(2, 0), 4000);
  assert.equal(computeReconnectBackoffMs(10, 0), 30000);
  assert.ok(computeReconnectBackoffMs(10, 0.99) < 30500);
});

test('reduceChannelsOnRealtimeEvent patches chat, sub-channel activity, unsent, announcement, and thread events accurately', () => {
  const hub = makeChannel(100);
  const subChannel = makeChannel(101, {
    parent_hub_id: 100,
    name: '# general',
  });
  const baseChannels = [hub, subChannel];

  // Sub-channel chat from another user increments parent hub chat count + breakdown + sub_channel_id
  const chatEvent = normalizeReverbPayloadToEvent({
    type: 'chat.message',
    channel_id: 101,
    actor_id: 2,
    message: {
      id: 500,
      channel_id: 101,
      content: 'Lab exercise 4 is uploaded.',
      created_at: '2026-11-20T09:00:00Z',
      author: { id: 2, name: 'Prof. Aki Hayakawa', role: 'faculty' },
    },
  });

  const afterChat = reduceChannelsOnRealtimeEvent(
    baseChannels,
    chatEvent,
    studentUser,
    0
  );
  assert.equal(afterChat.mutated, true);
  assert.equal(afterChat.channels[0].chat_messages_count, 6);
  assert.equal(afterChat.channels[0].has_updates, true);
  assert.equal(afterChat.channels[0].new_activity_count, 1);
  assert.equal(afterChat.channels[0].new_activity_breakdown?.chat, 1);
  assert.equal(afterChat.channels[0].new_activity_sub_channel_id, 101);
  assert.equal(
    afterChat.channels[0].latest_activity_preview,
    'Prof. Aki Hayakawa: Lab exercise 4 is uploaded.'
  );

  // When currently viewing hub 100, unseen activity is NOT bumped
  const whileViewing = reduceChannelsOnRealtimeEvent(
    baseChannels,
    chatEvent,
    studentUser,
    100
  );
  assert.equal(whileViewing.channels[0].has_updates, false);
  assert.equal(whileViewing.channels[0].new_activity_count, 0);

  // chat.message_unsent decrements count safely
  const afterUnsent = reduceChannelsOnRealtimeEvent(
    afterChat.channels,
    normalizeReverbPayloadToEvent({
      type: 'chat.message_unsent',
      channel_id: 101,
      message_id: 500,
    }),
    studentUser,
    0
  );
  assert.equal(afterUnsent.channels[0].chat_messages_count, 5);

  // thread.created from another user increments unread_count and qa breakdown
  const afterThread = reduceChannelsOnRealtimeEvent(
    baseChannels,
    normalizeReverbPayloadToEvent({
      type: 'thread.created',
      channel_id: 100,
      actor_id: 22,
      thread: {
        id: 77,
        channel_id: 100,
        announcement_id: null,
        subject_hashtag: '#Midterm',
        content: 'What chapters are covered?',
        is_private: false,
        is_resolved: false,
        is_pinned_faq: false,
        created_at: '2026-11-20T09:10:00Z',
        updated_at: '2026-11-20T09:10:00Z',
        author: { id: 22, name: 'Maria', role: 'student', avatar_url: null },
        replies: [],
      },
    }),
    studentUser,
    0
  );
  assert.equal(afterThread.mutated, true);
  assert.equal(afterThread.channels[0].unread_count, 2);
  assert.equal(afterThread.channels[0].new_activity_breakdown?.qa, 1);
});

test('planRealtimeEventEffects exhaustively handles all 18 RealtimeEvent types', () => {
  const hub = makeChannel(100);
  const urgentAnn = makeAnnouncement(99, { is_urgent: true, is_pinned: true });

  for (const evType of ALL_REALTIME_EVENT_TYPES) {
    const ev: RealtimeEvent = {
      revision: 1,
      type: evType,
      channel_id: 100,
      actor_id: 2,
      target_user_id: studentUser.id,
      action: 'approved',
      announcement: evType.startsWith('announcement.') ? urgentAnn : undefined,
      timestamp: '2026-11-20T09:00:00Z',
    };

    const plan = planRealtimeEventEffects(ev, studentUser, {
      channels: [hub],
      cachedRosterChannelIds: new Set([100]),
    });

    assert.equal(typeof plan.shouldScheduleChannelRefresh, 'boolean');
    assert.equal(typeof plan.shouldImmediateChannelRefresh, 'boolean');
  }

  // connected is explicitly ignored with reason
  const connectedPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({ type: 'connected' }),
    studentUser
  );
  assert.equal(connectedPlan.shouldScheduleChannelRefresh, false);
  assert.ok(connectedPlan.ignoredReason);

  // announcement.urgent with minimal global payload triggers urgent check
  const minimalUrgentPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: 2,
    }),
    studentUser
  );
  assert.equal(minimalUrgentPlan.shouldCheckUrgentAnnouncement, true);
  assert.equal(minimalUrgentPlan.urgentPopupCandidate, null);

  // announcement.urgent with full payload surfaces urgentPopupCandidate unless dismissed
  const fullUrgentPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: 2,
      announcement: urgentAnn,
    }),
    studentUser
  );
  assert.equal(fullUrgentPlan.urgentPopupCandidate?.id, 99);

  const dismissedPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: 2,
      announcement: urgentAnn,
    }),
    studentUser,
    { dismissedUrgentIds: new Set([99]) }
  );
  assert.equal(dismissedPlan.urgentPopupCandidate, null);

  // membership.changed targeting student triggers immediate refresh + approval toast
  const memberApprovedPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'membership.changed',
      channel_id: 100,
      target_user_id: studentUser.id,
      action: 'approved',
      actor_id: 2,
    }),
    studentUser,
    { channels: [hub] }
  );
  assert.equal(memberApprovedPlan.shouldImmediateChannelRefresh, true);
  assert.equal(memberApprovedPlan.toast?.variant, 'success');

  // membership.changed for course admin refreshes ONLY affected channel roster
  const adminRosterPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'membership.changed',
      channel_id: 100,
      target_user_id: studentUser.id,
      action: 'requested',
      actor_id: studentUser.id,
    }),
    facultyUser,
    { channels: [hub] }
  );
  assert.equal(adminRosterPlan.rosterChannelIdToRefresh, 100);
  assert.equal(adminRosterPlan.toast, null);

  // admin.updated bumps adminVersion for IT Admin
  const itAdminPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({ type: 'admin.updated' }),
    itAdminUser
  );
  assert.equal(itAdminPlan.shouldBumpAdminVersion, true);
  assert.equal(itAdminPlan.shouldScheduleChannelRefresh, false);
});

test('patchAnnouncementFeedOnRealtimeEvent preserves local ack flag on other users acks and removes deleted cards', () => {
  const initial = announcementFeedReducer(
    createInitialAnnouncementFeedState(10),
    {
      type: 'LOAD_SUCCESS',
      items: [makeAnnouncement(10), makeAnnouncement(11)],
      meta: { current_page: 1, last_page: 1, per_page: 10, total: 2 },
      append: false,
    }
  );

  // Another student (id 77) acknowledges announcement 10: broadcast says has_current_user_acknowledged=true
  // Local viewer (id 10) has NOT acknowledged yet, so local flag MUST stay false!
  const otherAckEvent = normalizeReverbPayloadToEvent({
    type: 'announcement.acknowledged',
    channel_id: 100,
    actor_id: 77,
    announcement: makeAnnouncement(10, {
      read_reach: {
        acknowledged_count: 11,
        enrolled_total: 40,
        percentage: 27.5,
        has_current_user_acknowledged: true,
      },
    }),
  });

  const afterOtherAck = patchAnnouncementFeedOnRealtimeEvent(
    initial,
    otherAckEvent,
    studentUser.id
  );
  assert.equal(afterOtherAck.shouldRefetch, false);
  assert.equal(afterOtherAck.state.items[0].read_reach.acknowledged_count, 11);
  assert.equal(afterOtherAck.state.items[0].read_reach.percentage, 27.5);
  assert.equal(
    afterOtherAck.state.items[0].read_reach.has_current_user_acknowledged,
    false
  );

  // announcement.deleted removes the matching card and decrements total
  const deleteEvent = normalizeReverbPayloadToEvent({
    type: 'announcement.deleted',
    channel_id: 100,
    message_id: 11,
  });
  const afterDelete = patchAnnouncementFeedOnRealtimeEvent(
    afterOtherAck.state,
    deleteEvent,
    studentUser.id
  );
  assert.equal(afterDelete.shouldRefetch, false);
  assert.deepEqual(
    afterDelete.state.items.map((a) => a.id),
    [10]
  );
  assert.equal(afterDelete.state.meta.total, 1);
});

test('resolvePushNotificationRoute maps course hub and campus-wide push payloads accurately', () => {
  const knownCourseHubs = new Set<number>([100, 101]);

  assert.equal(
    resolvePushNotificationRoute(
      { type: 'announcement.urgent', channel_id: 100, announcement_id: 55 },
      knownCourseHubs
    ),
    '/(drawer)/channels/100?announcementId=55'
  );

  // Campus-wide university channel (id 1 not in course hubs) routes to announcements feed
  assert.equal(
    resolvePushNotificationRoute(
      { type: 'announcement.urgent', channel_id: 1, announcement_id: 55 },
      knownCourseHubs
    ),
    '/(drawer)/announcements?announcementId=55'
  );

  assert.equal(resolvePushNotificationRoute(null, knownCourseHubs), null);
  assert.equal(resolvePushNotificationRoute({}, knownCourseHubs), null);
});

test('registerExpoPushTokenApi posts to canonical POST /devices/token with Bearer auth', async () => {
  const originalFetch = globalThis.fetch;
  const captured: { url: string; method?: string; body?: string; auth?: string }[] = [];

  try {
    setSecureTokenStorageAdapterForTests({
      getItemAsync: async () => 'token-push-123',
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    });
    await setSecureToken('token-push-123');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      captured.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
        auth: headers.Authorization,
      });
      return {
        ok: true,
        status: 201,
        headers: { get: () => null } as unknown as Headers,
        json: async () => ({ message: 'Registered' }),
      } as Response;
    }) as typeof fetch;

    await registerExpoPushTokenApi('ExponentPushToken[abc123]', 'android');

    assert.equal(captured.length, 1);
    assert.ok(captured[0].url.endsWith('/devices/token'));
    assert.equal(captured[0].method, 'POST');
    assert.equal(captured[0].auth, 'Bearer token-push-123');
    assert.deepEqual(JSON.parse(captured[0].body || '{}'), {
      expo_push_token: 'ExponentPushToken[abc123]',
      platform: 'android',
    });
  } finally {
    globalThis.fetch = originalFetch;
    await clearSecureToken();
  }
});

test('getReverbConfigurationStatus and getRealtimeUnavailableBannerMessage surface visible banner when Reverb key is blank', () => {
  const unconfigured = getReverbConfigurationStatus(
    { EXPO_PUBLIC_REVERB_APP_KEY: '' },
    'https://api.ustpclarify.tech/api/v1'
  );
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.reason, 'missing_app_key');
  assert.match(unconfigured.message, /Live updates unavailable/i);

  const bannerWhenUnconfigured = getRealtimeUnavailableBannerMessage({
    isAuthenticated: true,
    isConfigured: false,
    unconfiguredMessage: unconfigured.message,
    connectionState: 'unconfigured',
  });
  assert.ok(bannerWhenUnconfigured);
  assert.match(bannerWhenUnconfigured, /Live updates unavailable/i);

  const bannerWhenConnected = getRealtimeUnavailableBannerMessage({
    isAuthenticated: true,
    isConfigured: true,
    connectionState: 'connected',
  });
  assert.equal(bannerWhenConnected, null);

  // Background pause should not show an error banner
  const bannerWhenPaused = getRealtimeUnavailableBannerMessage({
    isAuthenticated: true,
    isConfigured: true,
    connectionState: 'paused',
  });
  assert.equal(bannerWhenPaused, null);

  // Socket failure/unavailable shows reconnecting banner
  const bannerWhenFailed = getRealtimeUnavailableBannerMessage({
    isAuthenticated: true,
    isConfigured: true,
    connectionState: 'failed',
  });
  assert.ok(bannerWhenFailed);
  assert.match(bannerWhenFailed, /Live updates unavailable/i);

  // Logged-out users see no banner
  assert.equal(
    getRealtimeUnavailableBannerMessage({
      isAuthenticated: false,
      isConfigured: false,
      connectionState: 'unconfigured',
    }),
    null
  );
});

test('mapHttpErrorToApiError extracts 429 retry seconds from AuthController JSON message when Retry-After header is absent', () => {
  const err = mapHttpErrorToApiError({
    status: 429,
    json: {
      status: 429,
      message: 'Too many registration attempts. Please try again in 37 seconds.',
    },
    retryAfterHeader: null,
    endpoint: '/auth/register',
  });
  assert.equal(err.status, 429);
  assert.equal(err.retryAfter, 37);
  assert.equal(err.message, 'Too many attempts, try again in 37 seconds');
});

test('urgent popup plan hides modal for it_admin, publisher self-actor, drafts, and dismissed IDs while resetting recipient ack state', () => {
  const urgentPublished = makeAnnouncement(201, {
    is_urgent: true,
    status: 'published',
    read_reach: {
      acknowledged_count: 1,
      enrolled_total: 40,
      percentage: 2.5,
      has_current_user_acknowledged: true,
    },
  });

  // Student receives urgent popup with has_current_user_acknowledged normalized to false
  const studentPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: facultyUser.id,
      announcement: urgentPublished,
    }),
    studentUser
  );
  assert.equal(studentPlan.urgentPopupCandidate?.id, 201);
  assert.equal(
    studentPlan.urgentPopupCandidate?.read_reach.has_current_user_acknowledged,
    false
  );
  assert.equal(studentPlan.shouldCheckUrgentAnnouncement, false);

  // IT Admin NEVER sees urgent popup or triggers urgent check
  const adminFullPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: facultyUser.id,
      announcement: urgentPublished,
    }),
    itAdminUser
  );
  assert.equal(adminFullPlan.urgentPopupCandidate, null);
  assert.equal(adminFullPlan.shouldCheckUrgentAnnouncement, false);

  const adminMinimalPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: facultyUser.id,
    }),
    itAdminUser
  );
  assert.equal(adminMinimalPlan.urgentPopupCandidate, null);
  assert.equal(adminMinimalPlan.shouldCheckUrgentAnnouncement, false);

  // Publisher (self-actor) NEVER receives their own urgent popup
  const selfPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.urgent',
      channel_id: 100,
      actor_id: facultyUser.id,
      announcement: urgentPublished,
    }),
    facultyUser
  );
  assert.equal(selfPlan.urgentPopupCandidate, null);
  assert.equal(selfPlan.shouldCheckUrgentAnnouncement, false);

  // Draft urgent announcement does not pop up
  const draftUrgent = makeAnnouncement(202, {
    is_urgent: true,
    status: 'draft',
  });
  const draftPlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.updated',
      channel_id: 100,
      actor_id: facultyUser.id,
      announcement: draftUrgent,
    }),
    studentUser
  );
  assert.equal(draftPlan.urgentPopupCandidate, null);

  // Published urgent update surfaces popup unless dismissed
  const urgentUpdatePlan = planRealtimeEventEffects(
    normalizeReverbPayloadToEvent({
      type: 'announcement.updated',
      channel_id: 100,
      actor_id: facultyUser.id,
      announcement: urgentPublished,
    }),
    studentUser
  );
  assert.equal(urgentUpdatePlan.urgentPopupCandidate?.id, 201);
  assert.equal(
    urgentUpdatePlan.urgentPopupCandidate?.read_reach
      .has_current_user_acknowledged,
    false
  );
});

test('admin pending badge count helpers resolve metrics count, format badge labels, and restrict fetching to active it_admin', () => {
  assert.equal(resolveAdminPendingCount(7, 2), 7);
  assert.equal(resolveAdminPendingCount(0, 5), 0);
  assert.equal(resolveAdminPendingCount(undefined, 4), 4);
  assert.equal(resolveAdminPendingCount(null, null), null);
  assert.equal(resolveAdminPendingCount(-2, 3), 3);

  assert.equal(formatAdminPendingBadgeLabel(null), null);
  assert.equal(formatAdminPendingBadgeLabel(undefined), null);
  assert.equal(formatAdminPendingBadgeLabel(0), null);
  assert.equal(formatAdminPendingBadgeLabel(-1), null);
  assert.equal(formatAdminPendingBadgeLabel(1), '1');
  assert.equal(formatAdminPendingBadgeLabel(99), '99');
  assert.equal(formatAdminPendingBadgeLabel(100), '99+');

  assert.equal(shouldFetchAdminPendingCount(itAdminUser, true), true);
  assert.equal(shouldFetchAdminPendingCount(itAdminUser, false), false);
  assert.equal(shouldFetchAdminPendingCount(studentUser, true), false);
  assert.equal(shouldFetchAdminPendingCount(facultyUser, true), false);
  assert.equal(shouldFetchAdminPendingCount(null, true), false);
});

test('reduceUrgentPopupOnRealtimeEvent and planRealtimeEventEffects close urgent popup on matching announcement.deleted', () => {
  const openUrgent = makeAnnouncement(22, { is_urgent: true, is_pinned: true });

  const nonMatchingDelete = normalizeReverbPayloadToEvent({
    type: 'announcement.deleted',
    channel_id: 100,
    announcement_id: 99,
  });
  assert.equal(resolveDeletedAnnouncementId(nonMatchingDelete), 99);
  assert.equal(
    reduceUrgentPopupOnRealtimeEvent(openUrgent, nonMatchingDelete, studentUser.id),
    openUrgent
  );

  const matchingDelete = normalizeReverbPayloadToEvent({
    type: 'announcement.deleted',
    channel_id: 100,
    announcement_id: 22,
  });
  assert.equal(resolveDeletedAnnouncementId(matchingDelete), 22);
  assert.equal(
    reduceUrgentPopupOnRealtimeEvent(openUrgent, matchingDelete, studentUser.id),
    null
  );

  const deletePlan = planRealtimeEventEffects(matchingDelete, studentUser);
  assert.equal(deletePlan.dismissUrgentPopupId, 22);
  assert.equal(deletePlan.shouldBumpAnnouncementVersion, false);

  // Feed patch also removes card using top-level announcement_id
  const initialFeed = announcementFeedReducer(
    createInitialAnnouncementFeedState(10),
    {
      type: 'LOAD_SUCCESS',
      items: [openUrgent, makeAnnouncement(23)],
      meta: { current_page: 1, last_page: 1, per_page: 10, total: 2 },
      append: false,
    }
  );
  const afterDeleteFeed = patchAnnouncementFeedOnRealtimeEvent(
    initialFeed,
    matchingDelete,
    studentUser.id
  );
  assert.equal(afterDeleteFeed.shouldRefetch, false);
  assert.deepEqual(
    afterDeleteFeed.state.items.map((a) => a.id),
    [23]
  );
});



