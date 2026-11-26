import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUserInitials,
  patchAnnouncementInList,
  reduceUrgentPopupOnRealtimeEvent,
  removeAnnouncementFromList,
  resolveAvatarDisplayUrl,
  resolveDeletedAnnouncementId,
  validateProfileAvatarFile,
} from './domain-logic.ts';
import type { Announcement, RealtimeEvent } from '../types/api.ts';

function makeAnnouncement(id: number, overrides: Partial<Announcement> = {}): Announcement {
  return {
    id,
    channel_id: 7,
    channel_type: 'course_hub',
    title: `Urgent Notice #${id}`,
    content: 'Please acknowledge promptly.',
    attachment_url: null,
    tags: ['URGENT NOTICE'],
    is_urgent: true,
    is_pinned: true,
    status: 'published',
    is_edited: false,
    published_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
    read_reach: {
      acknowledged_count: 5,
      enrolled_total: 40,
      percentage: 12.5,
      has_current_user_acknowledged: false,
    },
    publisher: {
      id: 2,
      name: 'Prof. Aki Hayakawa',
      role: 'faculty',
      department: 'CITC',
      avatar_url: 'https://api.ustpclarify.tech/storage/avatars/2/avatar.jpg',
    },
    ...overrides,
  };
}

test('reduceUrgentPopupOnRealtimeEvent closes open urgent popup on matching announcement.deleted event', () => {
  const openPopup = makeAnnouncement(22);

  // Non-matching delete leaves popup open
  const otherDelete: RealtimeEvent = {
    revision: 1,
    type: 'announcement.deleted',
    channel_id: 7,
    announcement_id: 99,
    timestamp: '2026-11-20T09:05:00Z',
  };
  assert.equal(resolveDeletedAnnouncementId(otherDelete), 99);
  assert.equal(reduceUrgentPopupOnRealtimeEvent(openPopup, otherDelete, 10), openPopup);

  // Matching delete with top-level announcement_id closes popup immediately
  const matchingDeleteById: RealtimeEvent = {
    revision: 2,
    type: 'announcement.deleted',
    channel_id: 7,
    announcement_id: 22,
    timestamp: '2026-11-20T09:06:00Z',
  };
  assert.equal(resolveDeletedAnnouncementId(matchingDeleteById), 22);
  assert.equal(reduceUrgentPopupOnRealtimeEvent(openPopup, matchingDeleteById, 10), null);

  // Matching delete with nested announcement.id also closes popup
  const matchingDeleteNested: RealtimeEvent = {
    revision: 3,
    type: 'announcement.deleted',
    channel_id: 7,
    announcement: { id: 22 } as Announcement,
    timestamp: '2026-11-20T09:07:00Z',
  };
  assert.equal(reduceUrgentPopupOnRealtimeEvent(openPopup, matchingDeleteNested, 10), null);
});

test('reduceUrgentPopupOnRealtimeEvent patches live Read Reach on announcement.acknowledged while preserving local ack flag', () => {
  const openPopup = makeAnnouncement(22);
  const ackEvent: RealtimeEvent = {
    revision: 4,
    type: 'announcement.acknowledged',
    channel_id: 7,
    announcement_id: 22,
    actor_id: 88,
    announcement: makeAnnouncement(22, {
      read_reach: {
        acknowledged_count: 6,
        enrolled_total: 40,
        percentage: 15,
        has_current_user_acknowledged: true,
      },
    }),
    timestamp: '2026-11-20T09:08:00Z',
  };

  const next = reduceUrgentPopupOnRealtimeEvent(openPopup, ackEvent, 10);
  assert.ok(next);
  assert.equal(next.read_reach.acknowledged_count, 6);
  assert.equal(next.read_reach.percentage, 15);
  assert.equal(next.read_reach.has_current_user_acknowledged, false);
});

test('removeAnnouncementFromList and patchAnnouncementInList update local feed state cleanly', () => {
  const list = [makeAnnouncement(21), makeAnnouncement(22)];
  const removed = removeAnnouncementFromList(list, 22);
  assert.deepEqual(
    removed.map((a) => a.id),
    [21]
  );

  const patched = patchAnnouncementInList(
    list,
    makeAnnouncement(22, {
      read_reach: {
        acknowledged_count: 10,
        enrolled_total: 40,
        percentage: 25,
        has_current_user_acknowledged: true,
      },
    }),
    { currentUserId: 10, actorId: 99 }
  );
  assert.equal(patched[1].read_reach.acknowledged_count, 10);
  assert.equal(patched[1].read_reach.has_current_user_acknowledged, false);
});

test('resolveAvatarDisplayUrl rejects data: URIs, resolves storage URLs, and getUserInitials provides fallback', () => {
  assert.equal(
    resolveAvatarDisplayUrl('data:image/png;base64,AAAA', 'https://api.ustpclarify.tech/api/v1'),
    null
  );
  assert.equal(
    resolveAvatarDisplayUrl('/storage/avatars/5/pic.jpg', 'https://api.ustpclarify.tech/api/v1'),
    'https://api.ustpclarify.tech/storage/avatars/5/pic.jpg'
  );
  assert.equal(
    resolveAvatarDisplayUrl('https://api.ustpclarify.tech/storage/avatars/5/pic.jpg'),
    'https://api.ustpclarify.tech/storage/avatars/5/pic.jpg'
  );
  assert.equal(getUserInitials('Prof. Aki Hayakawa'), 'AH');
  assert.equal(getUserInitials('Kobeni'), 'K');
  assert.equal(getUserInitials(''), 'U');

  assert.equal(
    validateProfileAvatarFile({ name: 'pic.webp', size: 1024, type: 'image/webp' }).valid,
    true
  );
  assert.equal(
    validateProfileAvatarFile({ name: 'huge.jpg', size: 6 * 1024 * 1024, type: 'image/jpeg' }).valid,
    false
  );
  assert.equal(
    validateProfileAvatarFile({ name: 'shell.php', size: 100, type: 'application/x-php' }).valid,
    false
  );
});
