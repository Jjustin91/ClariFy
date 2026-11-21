import assert from 'node:assert/strict';
import test from 'node:test';

import type { Channel, QaThread } from '../types/api.ts';
import {
  courseQaReducer,
  createInitialCourseQaState,
  extractPublishedFaqs,
  formatCourseHubSubmitName,
  normalizeSubChannelSlug,
  removePendingRequestFromChannel,
  resolveHubChatChannels,
  sanitizeThreadForPrivacy,
} from './qa-reducer.ts';

function makeThread(overrides: Partial<QaThread> = {}): QaThread {
  return {
    id: 1,
    channel_id: 10,
    announcement_id: null,
    subject_hashtag: '#Midterm',
    content: 'Is Chapter 5 included in the exam?',
    is_private: false,
    is_resolved: false,
    is_pinned_faq: false,
    created_at: '2026-11-20T08:00:00Z',
    updated_at: '2026-11-20T08:00:00Z',
    author: {
      id: 42,
      name: 'Juan Dela Cruz',
      role: 'student',
      avatar_url: 'https://api.ustpclarify.tech/storage/avatars/42.png',
    },
    replies: [],
    ...overrides,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 10,
    name: 'IT314 Software Engineering',
    description: null,
    course_code: 'IT314',
    channel_type: 'course_hub',
    parent_hub_id: null,
    scope_college: 'CITC',
    scope_department: 'IT',
    scope_section: 'IT3R2',
    members_count: 35,
    ...overrides,
  };
}

test('sanitizeThreadForPrivacy strictly masks author id, name, and avatar when is_pinned_faq is true', () => {
  const pinned = makeThread({
    id: 5,
    is_pinned_faq: true,
    is_private: true,
    author: {
      id: 99,
      name: 'Real Student Name',
      role: 'student',
      avatar_url: 'https://api.ustpclarify.tech/storage/avatars/99.png',
    },
  });

  const sanitized = sanitizeThreadForPrivacy(pinned);
  assert.equal(sanitized.author.id, null);
  assert.equal(sanitized.author.name, 'Anonymous Student');
  assert.equal(sanitized.author.avatar_url, null);
  assert.equal(sanitized.is_private, false);

  const nonPinned = makeThread({ id: 6, is_pinned_faq: false });
  const untouched = sanitizeThreadForPrivacy(nonPinned);
  assert.equal(untouched.author.id, 42);
  assert.equal(untouched.author.name, 'Juan Dela Cruz');
});

test('courseQaReducer loads, deduplicates, sorts newest-first, upserts realtime updates, and removes deleted threads', () => {
  let state = createInitialCourseQaState(10);
  state = courseQaReducer(state, { type: 'LOAD_START' });
  assert.equal(state.isLoading, true);

  state = courseQaReducer(state, {
    type: 'LOAD_SUCCESS',
    channelId: 10,
    threads: [
      makeThread({ id: 1, created_at: '2026-11-20T08:00:00Z' }),
      makeThread({ id: 2, created_at: '2026-11-20T09:00:00Z' }),
      makeThread({ id: 1, created_at: '2026-11-20T08:00:00Z', content: 'Updated copy' }),
    ],
  });

  assert.equal(state.isLoading, false);
  assert.equal(state.hasLoadedOnce, true);
  assert.deepEqual(
    state.threads.map((t) => t.id),
    [2, 1]
  );
  assert.equal(state.threads[1].content, 'Updated copy');

  // Realtime FAQ pin masks identity immediately and ignores foreign channel events
  state = courseQaReducer(state, {
    type: 'UPSERT_THREAD',
    thread: makeThread({
      id: 99,
      channel_id: 999,
      subject_hashtag: '#OtherHub',
    }),
  });
  assert.equal(state.threads.length, 2);

  state = courseQaReducer(state, {
    type: 'UPSERT_THREAD',
    thread: makeThread({
      id: 2,
      channel_id: 10,
      is_resolved: true,
      is_pinned_faq: true,
      author: { id: 77, name: 'Leaked Name', role: 'student', avatar_url: 'http://x' },
    }),
  });
  assert.equal(state.threads[0].is_pinned_faq, true);
  assert.equal(state.threads[0].author.name, 'Anonymous Student');
  assert.equal(state.threads[0].author.id, null);

  // Thread delete removes it cleanly
  state = courseQaReducer(state, { type: 'REMOVE_THREAD', threadId: 1 });
  assert.deepEqual(
    state.threads.map((t) => t.id),
    [2]
  );
});

test('resolveHubChatChannels prevents duplicate #general pills when sub-channels include #general', () => {
  const hub = makeChannel({ id: 10, name: 'IT314 Software Engineering' });
  const subGeneral = makeChannel({
    id: 11,
    name: '# general',
    channel_type: 'course_hub',
    parent_hub_id: 10,
  });
  const subMedia = makeChannel({
    id: 12,
    name: '# media',
    channel_type: 'course_hub',
    parent_hub_id: 10,
  });

  const resolved = resolveHubChatChannels(hub, [subGeneral, subMedia, subGeneral]);
  assert.deepEqual(
    resolved.chatChannels.map((c) => c.id),
    [11, 12]
  );
  assert.equal(resolved.defaultChatChannel?.id, 11);

  // Only falls back to parent hub when zero sub-channels exist
  const fallback = resolveHubChatChannels(hub, []);
  assert.deepEqual(
    fallback.chatChannels.map((c) => c.id),
    [10]
  );
  assert.equal(fallback.defaultChatChannel?.id, 10);
});

test('extractPublishedFaqs returns only pinned FAQs with strict Anonymous Student masking', () => {
  const faqs = extractPublishedFaqs([
    makeThread({ id: 1, is_pinned_faq: false }),
    makeThread({
      id: 2,
      is_pinned_faq: true,
      is_private: true,
      author: {
        id: 88,
        name: 'Leaked Student',
        role: 'student',
        avatar_url: 'https://api.ustpclarify.tech/storage/avatars/88.png',
      },
    }),
  ]);

  assert.equal(faqs.length, 1);
  assert.equal(faqs[0].id, 2);
  assert.equal(faqs[0].author.id, null);
  assert.equal(faqs[0].author.name, 'Anonymous Student');
  assert.equal(faqs[0].author.avatar_url, null);
  assert.equal(faqs[0].is_private, false);
});

test('formatCourseHubSubmitName and normalizeSubChannelSlug match clarify-web conventions', () => {
  assert.equal(
    formatCourseHubSubmitName('it315', 'Capstone 1'),
    'IT315 Capstone 1'
  );
  assert.equal(
    formatCourseHubSubmitName('IT315', 'IT315 Capstone 1'),
    'IT315 Capstone 1'
  );
  assert.equal(
    formatCourseHubSubmitName('', '# Software Engineering'),
    'Software Engineering'
  );
  assert.equal(normalizeSubChannelSlug('# Project Groups  '), 'project-groups');
  assert.equal(normalizeSubChannelSlug('  Lab   Help '), 'lab-help');
  assert.equal(normalizeSubChannelSlug('   '), '');
});

test('removePendingRequestFromChannel clears stale pending row on 409 recovery', () => {
  const hub = makeChannel({
    id: 10,
    pending_requests: [
      {
        id: 50,
        institutional_id: '2023300050',
        name: 'Maria Clara',
        role: 'student',
        section: 'IT3R2',
        department: 'CITC',
      },
      {
        id: 51,
        institutional_id: '2023300051',
        name: 'Jose Rizal',
        role: 'student',
        section: 'IT3R2',
        department: 'CITC',
      },
    ],
  });

  const updated = removePendingRequestFromChannel(hub, '2023300050');
  assert.deepEqual(
    updated.pending_requests?.map((m) => m.institutional_id),
    ['2023300051']
  );
});

