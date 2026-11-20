import assert from 'node:assert/strict';
import test from 'node:test';

import { mapHttpErrorToApiError } from './api-client.ts';
import {
  announcementFeedReducer,
  buildScopedChannelHierarchy,
  createInitialAnnouncementFeedState,
  formatServerReadReachText,
  getChannelMembersCount,
  getReadReachBarFillPercent,
  hasMoreAnnouncementPages,
  patchOnlyTargetAnnouncementFromList,
  shouldRefetchAnnouncementOnAckError,
} from './feed-reducer.ts';
import type { Announcement, Channel, User } from '../types/api.ts';

function makeAnnouncement(
  id: number,
  overrides: Partial<Announcement> = {}
): Announcement {
  return {
    id,
    channel_id: 10,
    channel_type: 'course_hub',
    course_code: 'IT314',
    channel_name: 'IT314 Software Engineering',
    title: `Announcement #${id}`,
    content: `Body for announcement ${id}`,
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

function makeChannel(
  id: number,
  overrides: Partial<Channel> = {}
): Channel {
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
    members_count: 42,
    students_count: 40,
    roster: [],
    ...overrides,
  };
}

const sampleStudent: User = {
  id: 99,
  institutional_id: '2023300123',
  name: 'Juan Dela Cruz',
  email: 'juan.delacruz@ustp.edu.ph',
  role: 'student',
  verification_status: 'approved',
};

test('feed reducer handles initial load, append pagination with dedupe, and pull-to-refresh reset', () => {
  let state = createInitialAnnouncementFeedState(2);
  assert.equal(state.isLoading, true);

  state = announcementFeedReducer(state, {
    type: 'LOAD_SUCCESS',
    items: [makeAnnouncement(1), makeAnnouncement(2)],
    meta: { current_page: 1, last_page: 2, per_page: 2, total: 3 },
    append: false,
  });

  assert.equal(state.isLoading, false);
  assert.equal(state.items.length, 2);
  assert.equal(hasMoreAnnouncementPages(state), true);

  state = announcementFeedReducer(state, { type: 'LOAD_MORE_START' });
  assert.equal(state.isLoadingMore, true);

  // Page 2 includes duplicate ID 2 plus new ID 3
  state = announcementFeedReducer(state, {
    type: 'LOAD_SUCCESS',
    items: [makeAnnouncement(2, { title: 'Updated #2' }), makeAnnouncement(3)],
    meta: { current_page: 2, last_page: 2, per_page: 2, total: 3 },
    append: true,
  });

  assert.equal(state.isLoadingMore, false);
  assert.deepEqual(
    state.items.map((a) => a.id),
    [1, 2, 3]
  );
  assert.equal(state.items[1].title, 'Updated #2');
  assert.equal(hasMoreAnnouncementPages(state), false);

  // Pull-to-refresh replaces items cleanly
  state = announcementFeedReducer(state, { type: 'REFRESH_START' });
  assert.equal(state.isRefreshing, true);

  state = announcementFeedReducer(state, {
    type: 'LOAD_SUCCESS',
    items: [makeAnnouncement(4)],
    meta: { current_page: 1, last_page: 1, per_page: 2, total: 1 },
    append: false,
  });
  assert.equal(state.isRefreshing, false);
  assert.deepEqual(
    state.items.map((a) => a.id),
    [4]
  );
});

test('acknowledge updates Read Reach strictly from server response without client-side recalculation', () => {
  const initial = makeAnnouncement(101, {
    read_reach: {
      acknowledged_count: 10,
      enrolled_total: 40,
      percentage: 25,
      has_current_user_acknowledged: false,
    },
  });

  let state = announcementFeedReducer(createInitialAnnouncementFeedState(10), {
    type: 'LOAD_SUCCESS',
    items: [initial, makeAnnouncement(102)],
    meta: { current_page: 1, last_page: 1, per_page: 10, total: 2 },
    append: false,
  });

  state = announcementFeedReducer(state, {
    type: 'ACK_START',
    announcementId: 101,
  });
  assert.deepEqual(state.ackLoadingIds, [101]);

  // Server returns authoritative numbers (e.g. concurrent reads bumped count to 14 & percentage to 35)
  const serverUpdated = makeAnnouncement(101, {
    read_reach: {
      acknowledged_count: 14,
      enrolled_total: 40,
      percentage: 35,
      has_current_user_acknowledged: true,
    },
  });

  state = announcementFeedReducer(state, {
    type: 'ACK_SUCCESS',
    announcement: serverUpdated,
  });

  assert.deepEqual(state.ackLoadingIds, []);
  assert.equal(state.items[0].read_reach.acknowledged_count, 14);
  assert.equal(state.items[0].read_reach.enrolled_total, 40);
  assert.equal(state.items[0].read_reach.percentage, 35);
  assert.equal(state.items[0].read_reach.has_current_user_acknowledged, true);
  assert.equal(
    formatServerReadReachText(state.items[0].read_reach),
    '14 of 40 acknowledged (35%)'
  );
  assert.equal(getReadReachBarFillPercent(state.items[0].read_reach), 35);
  // Untouched sibling card remains intact
  assert.equal(state.items[1].read_reach.has_current_user_acknowledged, false);
});

test('409 and 422 trigger targeted single-announcement patch without mutating sibling cards', () => {
  assert.equal(
    shouldRefetchAnnouncementOnAckError(
      mapHttpErrorToApiError({ status: 409 })
    ),
    true
  );
  assert.equal(
    shouldRefetchAnnouncementOnAckError(
      mapHttpErrorToApiError({ status: 422 })
    ),
    true
  );
  assert.equal(
    shouldRefetchAnnouncementOnAckError(
      mapHttpErrorToApiError({ status: 403 })
    ),
    false
  );

  let state = announcementFeedReducer(createInitialAnnouncementFeedState(10), {
    type: 'LOAD_SUCCESS',
    items: [
      makeAnnouncement(201, { title: 'Original 201' }),
      makeAnnouncement(202, { title: 'Original 202' }),
    ],
    meta: { current_page: 1, last_page: 1, per_page: 10, total: 2 },
    append: false,
  });

  state = announcementFeedReducer(state, {
    type: 'ACK_START',
    announcementId: 201,
  });

  const patched = patchOnlyTargetAnnouncementFromList(state, 201, [
    makeAnnouncement(201, {
      title: 'Fresh 201',
      read_reach: {
        acknowledged_count: 11,
        enrolled_total: 40,
        percentage: 27.5,
        has_current_user_acknowledged: true,
      },
    }),
    makeAnnouncement(202, { title: 'Should Not Overwrite 202' }),
  ]);

  assert.equal(patched.items[0].title, 'Fresh 201');
  assert.equal(patched.items[0].read_reach.has_current_user_acknowledged, true);
  assert.equal(patched.items[1].title, 'Original 202');
  assert.deepEqual(patched.ackLoadingIds, []);
});

test('scoped channel hierarchy groups parent_hub_id sub-channels and uses members_count (never roster.length)', () => {
  const hub1 = makeChannel(10, {
    members_count: 45,
    students_count: 43,
    // API overlays only self-entry when full roster is not requested
    roster: [
      {
        id: sampleStudent.id,
        institutional_id: sampleStudent.institutional_id,
        name: sampleStudent.name,
        role: 'student',
        section: 'IT3R2',
        department: 'CITC',
      },
    ],
  });
  const subGeneral = makeChannel(11, {
    parent_hub_id: 10,
    name: '#general',
    members_count: 45,
  });
  const subMedia = makeChannel(12, {
    parent_hub_id: 10,
    name: '#media',
    members_count: 45,
  });
  const hub2 = makeChannel(20, {
    course_code: 'ES211a',
    name: '#ES211a Engineering Math',
    members_count: 31,
    students_count: 30,
    roster: [],
  });

  assert.equal(getChannelMembersCount(hub1), 45);
  assert.equal(getChannelMembersCount(hub2), 31);

  const nodes = buildScopedChannelHierarchy(
    [hub1, subGeneral, subMedia, hub2],
    sampleStudent
  );

  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].hub.id, 10);
  assert.equal(nodes[0].membersCount, 45);
  assert.equal(nodes[0].isJoined, true);
  assert.deepEqual(
    nodes[0].subChannels.map((s) => s.name),
    ['#general', '#media']
  );

  assert.equal(nodes[1].hub.id, 20);
  assert.equal(nodes[1].membersCount, 31);
  assert.equal(nodes[1].isJoined, false);
  assert.equal(nodes[1].subChannels.length, 0);

  // Search matches sub-channel name and keeps parent hub
  const filtered = buildScopedChannelHierarchy(
    [hub1, subGeneral, subMedia, hub2],
    sampleStudent,
    'media'
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].hub.id, 10);
});

test('error mapping covers 401, 403, 404, 409, 422, 429, and 500 accurately', () => {
  const err401 = mapHttpErrorToApiError({
    status: 401,
    endpoint: '/announcements',
  });
  assert.equal(err401.status, 401);
  assert.match(err401.message, /session has expired/i);

  const err403 = mapHttpErrorToApiError({
    status: 403,
    json: { message: 'Access Denied: You are not an approved member.' },
  });
  assert.equal(err403.status, 403);
  assert.match(err403.message, /Access Denied/i);

  const err404 = mapHttpErrorToApiError({ status: 404 });
  assert.equal(err404.status, 404);

  const err409 = mapHttpErrorToApiError({ status: 409 });
  assert.equal(err409.status, 409);
  assert.match(err409.message, /already been handled/i);

  const err422 = mapHttpErrorToApiError({
    status: 422,
    json: {
      errors: {
        contact_number: ['Invalid Philippine mobile number.'],
      },
    },
  });
  assert.equal(err422.status, 422);
  assert.equal(
    err422.errors?.contact_number?.[0],
    'Invalid Philippine mobile number.'
  );

  const err429 = mapHttpErrorToApiError({
    status: 429,
    retryAfterHeader: '45',
  });
  assert.equal(err429.status, 429);
  assert.equal(err429.retryAfter, 45);
  assert.equal(err429.message, 'Too many attempts, try again in 45 seconds');

  const err500 = mapHttpErrorToApiError({ status: 500 });
  assert.equal(err500.status, 500);
});
