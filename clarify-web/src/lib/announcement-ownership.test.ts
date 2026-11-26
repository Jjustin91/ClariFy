import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSessionAnnouncementsForChannels,
  getAnnouncementsApi,
  leaveChannelApi,
  patchAnnouncementLocally,
} from './api-client.ts';
import { canManageAnnouncement } from './domain-logic.ts';
import type { Announcement, Channel, User } from '../types/api.ts';

function makeUser(role: User['role'], id: number): User {
  return {
    id,
    institutional_id: `ID-${id}`,
    name: `User ${id}`,
    email: `user${id}@ustp.edu.ph`,
    role,
    verification_status: 'approved',
  };
}

function makeAnnouncement(
  id: number,
  overrides: Partial<Announcement> = {}
): Announcement {
  return {
    id,
    channel_id: 10,
    channel_type: 'course_hub',
    title: `Notice #${id}`,
    content: `Body for notice #${id}`,
    attachment_url: null,
    tags: [],
    is_urgent: false,
    is_pinned: false,
    status: 'published',
    is_edited: false,
    published_at: '2026-11-26T10:00:00Z',
    updated_at: '2026-11-26T10:00:00Z',
    read_reach: {
      acknowledged_count: 1,
      enrolled_total: 10,
      percentage: 10,
      has_current_user_acknowledged: true,
    },
    publisher: {
      id: 100,
      name: 'Prof. One',
      role: 'faculty',
      department: 'CITC',
    },
    ...overrides,
  };
}

test('clearSessionAnnouncementsForChannels removes matching hub and sub-channel entries without touching other channels', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // Populate sessionAnnouncementsById with hub 10, sub-channel 11, parent_hub_id 10, and unrelated hub 20
    const hubAnn = makeAnnouncement(501, { channel_id: 10 });
    const subAnn = makeAnnouncement(502, { channel_id: 11 });
    const parentTaggedAnn = {
      ...makeAnnouncement(503, { channel_id: 12 }),
      parent_hub_id: 10,
    } as Announcement;
    const otherHubAnn = makeAnnouncement(504, { channel_id: 20 });

    patchAnnouncementLocally(hubAnn);
    patchAnnouncementLocally(subAnn);
    patchAnnouncementLocally(parentTaggedAnn);
    patchAnnouncementLocally(otherHubAnn);

    clearSessionAnnouncementsForChannels([10, 11]);

    // Mock GET /announcements returning empty server list to prove only otherHubAnn remains in session cache
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          meta: { current_page: 1, last_page: 1, per_page: 10, total: 0 },
        }),
      }) as Response) as typeof fetch;

    const feed = await getAnnouncementsApi({ page: 1, per_page: 10 });
    assert.deepEqual(
      feed.data.map((a) => a.id),
      [504]
    );

    // Clean up remaining entry
    clearSessionAnnouncementsForChannels([20]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('leaveChannelApi clears sessionAnnouncementsById for the left hub and its sub-channels on success', async () => {
  const originalFetch = globalThis.fetch;

  try {
    patchAnnouncementLocally(makeAnnouncement(601, { channel_id: 30 }));
    patchAnnouncementLocally(makeAnnouncement(602, { channel_id: 31 }));
    patchAnnouncementLocally(
      makeAnnouncement(603, { channel_id: 1, channel_type: 'university' })
    );

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/channels/30/leave')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: 'You have left hub 30.',
            data: { id: 30, name: 'Hub 30', channel_type: 'course_hub' },
            left_channel_ids: [30, 31],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          meta: { current_page: 1, last_page: 1, per_page: 10, total: 0 },
        }),
      } as Response;
    }) as typeof fetch;

    await leaveChannelApi(30);

    const feed = await getAnnouncementsApi({ page: 1, per_page: 10 });
    assert.deepEqual(
      feed.data.map((a) => a.id),
      [603]
    );

    clearSessionAnnouncementsForChannels([1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web canManageAnnouncement uses can_manage when present and enforces publisher ownership fallback', () => {
  const facultyA = makeUser('faculty', 100);
  const facultyB = makeUser('faculty', 200);
  const deptHead = makeUser('dept_head', 300);
  const student = makeUser('student', 400);

  const channels: Channel[] = [
    {
      id: 10,
      course_code: 'IT314',
      name: '# IT314',
      description: 'Hub',
      channel_type: 'course_hub',
      scope_college: 'CITC',
      scope_department: 'CITC',
      scope_section: 'IT3R2',
    },
    {
      id: 1,
      course_code: 'CAMPUS',
      name: '# USTP Campus-Wide',
      description: 'Campus',
      channel_type: 'university',
      scope_college: 'USTP',
      scope_department: 'CITC',
      scope_section: null,
    },
  ];

  const facultyAHubPost = makeAnnouncement(701, {
    channel_id: 10,
    channel_type: 'course_hub',
    publisher: { id: 100, name: 'Prof. A', role: 'faculty', department: 'CITC' },
  });
  const deptHeadHubPost = makeAnnouncement(702, {
    channel_id: 10,
    channel_type: 'course_hub',
    publisher: { id: 300, name: 'Chair', role: 'dept_head', department: 'CITC' },
  });
  const campusPost = makeAnnouncement(703, {
    channel_id: 1,
    channel_type: 'university',
    publisher: { id: 100, name: 'Prof. A', role: 'faculty', department: 'CITC' },
  });

  // Fallback without can_manage
  assert.equal(canManageAnnouncement(facultyAHubPost, facultyA, channels), true);
  assert.equal(canManageAnnouncement(facultyAHubPost, facultyB, channels), false);
  assert.equal(canManageAnnouncement(facultyAHubPost, deptHead, channels), false);
  assert.equal(canManageAnnouncement(deptHeadHubPost, deptHead, channels), true);
  assert.equal(canManageAnnouncement(campusPost, deptHead, channels), true);
  assert.equal(canManageAnnouncement(campusPost, facultyB, channels), false);
  assert.equal(canManageAnnouncement(facultyAHubPost, student, channels), false);

  // Explicit server can_manage takes precedence for faculty/dept_head
  assert.equal(
    canManageAnnouncement(
      { ...facultyAHubPost, can_manage: false },
      facultyA,
      channels
    ),
    false
  );
  assert.equal(
    canManageAnnouncement(
      { ...facultyAHubPost, can_manage: true },
      facultyB,
      channels
    ),
    true
  );
  // Students never manage even if payload were malformed
  assert.equal(
    canManageAnnouncement(
      { ...facultyAHubPost, can_manage: true },
      student,
      channels
    ),
    false
  );
});
