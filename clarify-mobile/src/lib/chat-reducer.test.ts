import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage, User } from '../types/api.ts';
import {
  canUnsendChatMessage,
  courseChatReducer,
  createInitialCourseChatState,
  getChatMessageActionCapabilities,
  getChatSenderInitial,
  isFacultyChatRole,
  mergeAndDedupeChatMessages,
  toInvertedChatList,
} from './chat-reducer.ts';

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
  institutional_id: '10492',
  name: 'Prof. Aki Hayakawa',
  email: 'aki.hayakawa@ustp.edu.ph',
  role: 'faculty',
  verification_status: 'approved',
};

function makeMessage(
  id: number | string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    channel_id: 100,
    sender_id: 10,
    is_unsent: false,
    content: `Message ${id}`,
    attachment: null,
    created_at: '2026-11-21T08:00:00Z',
    status: 'sent',
    author: {
      id: 10,
      name: 'Juan Dela Cruz',
      role: 'student',
      avatar_url: null,
    },
    ...overrides,
  };
}

test('courseChatReducer merges cursor-paginated older messages with deduplication and preserves inverted FlatList order', () => {
  let state = createInitialCourseChatState(100);
  state = courseChatReducer(state, {
    type: 'LOAD_SUCCESS',
    messages: [
      makeMessage(50, { created_at: '2026-11-21T08:05:00Z' }),
      makeMessage(51, { created_at: '2026-11-21T08:06:00Z' }),
    ],
    hasMore: true,
    nextBefore: 50,
  });

  assert.deepEqual(
    state.messages.map((m) => m.id),
    [50, 51]
  );
  assert.equal(state.hasMore, true);
  assert.equal(state.nextBefore, 50);

  // Older page overlaps id 50 and prepends 48, 49
  state = courseChatReducer(state, { type: 'LOAD_OLDER_START' });
  state = courseChatReducer(state, {
    type: 'LOAD_OLDER_SUCCESS',
    messages: [
      makeMessage(48, { created_at: '2026-11-21T08:01:00Z' }),
      makeMessage(49, { created_at: '2026-11-21T08:02:00Z' }),
      makeMessage(50, { created_at: '2026-11-21T08:05:00Z' }),
    ],
    hasMore: false,
    nextBefore: null,
  });

  assert.deepEqual(
    state.messages.map((m) => m.id),
    [48, 49, 50, 51]
  );
  assert.equal(state.hasMore, false);
  assert.equal(state.nextBefore, null);

  // Inverted list places newest message (51) at index 0 for inverted FlatList
  assert.deepEqual(
    toInvertedChatList(state.messages).map((m) => m.id),
    [51, 50, 49, 48]
  );
});

test('optimistic send reconciles by temp_id even when realtime broadcast arrives before HTTP response', () => {
  let state = createInitialCourseChatState(100);
  state = courseChatReducer(state, {
    type: 'LOAD_SUCCESS',
    messages: [makeMessage(100)],
    hasMore: false,
    nextBefore: null,
  });

  const tempId = 'temp-1700-abc123';
  const optimistic = makeMessage(tempId, {
    temp_id: tempId,
    content: 'Hello from mobile!',
    status: 'sending',
  });

  state = courseChatReducer(state, {
    type: 'OPTIMISTIC_ADD',
    message: optimistic,
  });
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].status, 'sending');

  // Realtime event arrives first with matching temp_id and confirmed server id 101
  const confirmed = makeMessage(101, {
    temp_id: tempId,
    content: 'Hello from mobile!',
  });
  state = courseChatReducer(state, {
    type: 'REALTIME_MESSAGE',
    message: confirmed,
  });

  assert.deepEqual(
    state.messages.map((m) => m.id),
    [100, 101]
  );
  assert.equal(state.messages[1].status, 'sent');

  // HTTP POST response resolves afterwards: must stay strictly deduplicated
  state = courseChatReducer(state, {
    type: 'SEND_SUCCESS',
    tempId,
    message: confirmed,
  });
  assert.deepEqual(
    state.messages.map((m) => m.id),
    [100, 101]
  );
});

test('failed send marks bubble failed with error message and supports retry and dismiss', () => {
  let state = createInitialCourseChatState(100);
  const tempId = 'temp-offline-1';

  state = courseChatReducer(state, {
    type: 'OPTIMISTIC_ADD',
    message: makeMessage(tempId, {
      temp_id: tempId,
      content: 'Offline test message',
      status: 'sending',
    }),
  });

  state = courseChatReducer(state, {
    type: 'SEND_FAILED',
    tempId,
    errorMessage: 'No network connection.',
  });
  assert.equal(state.messages[0].status, 'failed');
  assert.equal(state.failedErrorByTempId[tempId], 'No network connection.');

  // Retry flips back to sending and clears error text
  state = courseChatReducer(state, { type: 'RETRY_START', tempId });
  assert.equal(state.messages[0].status, 'sending');
  assert.equal(state.failedErrorByTempId[tempId], undefined);

  // Confirm on retry success
  state = courseChatReducer(state, {
    type: 'SEND_SUCCESS',
    tempId,
    message: makeMessage(202, {
      temp_id: tempId,
      content: 'Offline test message',
    }),
  });
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, 202);
  assert.equal(state.messages[0].status, 'sent');

  // Failed message can also be dismissed cleanly
  const tempId2 = 'temp-offline-2';
  state = courseChatReducer(state, {
    type: 'OPTIMISTIC_ADD',
    message: makeMessage(tempId2, { temp_id: tempId2, status: 'sending' }),
  });
  state = courseChatReducer(state, {
    type: 'SEND_FAILED',
    tempId: tempId2,
    errorMessage: 'Timeout',
  });
  state = courseChatReducer(state, { type: 'DISMISS_FAILED', tempId: tempId2 });
  assert.deepEqual(
    state.messages.map((m) => m.id),
    [202]
  );
});

test('MARK_UNSENT scrubs content/attachment and stale merges never restore unsent content', () => {
  let state = createInitialCourseChatState(100);
  state = courseChatReducer(state, {
    type: 'LOAD_SUCCESS',
    messages: [
      makeMessage(301, {
        content: 'Typo message',
        attachment: {
          url: '/storage/chat/100/file.pdf',
          name: 'file.pdf',
          type: 'document',
          mime: 'application/pdf',
          size: 1024,
        },
      }),
    ],
    hasMore: false,
    nextBefore: null,
  });

  state = courseChatReducer(state, {
    type: 'MARK_UNSENT',
    messageId: 301,
  });

  assert.equal(state.messages[0].is_unsent, true);
  assert.equal(state.messages[0].content, '');
  assert.equal(state.messages[0].attachment, null);

  // Merging a stale non-unsent copy with same id must NOT resurrect deleted content
  const merged = mergeAndDedupeChatMessages(state.messages, [
    makeMessage(301, { content: 'Stale copy' }),
  ]);
  assert.equal(merged[0].is_unsent, true);
  assert.equal(merged[0].content, '');
  assert.equal(merged[0].attachment, null);
});

test('canUnsendChatMessage enforces original-sender and confirmed-message rules', () => {
  const ownSent = makeMessage(401, {
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });
  const otherSent = makeMessage(402, {
    author: { id: facultyUser.id, name: facultyUser.name, role: 'faculty' },
  });
  const ownUnsent = makeMessage(403, {
    is_unsent: true,
    content: '',
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });
  const ownSending = makeMessage('temp-1', {
    temp_id: 'temp-1',
    status: 'sending',
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });
  const ownFailed = makeMessage('temp-2', {
    temp_id: 'temp-2',
    status: 'failed',
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });

  assert.equal(canUnsendChatMessage(ownSent, studentUser), true);
  assert.equal(canUnsendChatMessage(otherSent, studentUser), false);
  // Even faculty cannot unsend another user's message (ChannelPolicy::unsendMessage)
  assert.equal(canUnsendChatMessage(ownSent, facultyUser), false);
  assert.equal(canUnsendChatMessage(ownUnsent, studentUser), false);
  assert.equal(canUnsendChatMessage(ownSending, studentUser), false);
  assert.equal(canUnsendChatMessage(ownFailed, studentUser), false);
});

test('getChatSenderInitial and isFacultyChatRole match clarify-web avatar conventions', () => {
  assert.equal(isFacultyChatRole('faculty'), true);
  assert.equal(isFacultyChatRole('dept_head'), true);
  assert.equal(isFacultyChatRole('it_admin'), true);
  assert.equal(isFacultyChatRole('student'), false);

  assert.equal(getChatSenderInitial('Prof. Aki Hayakawa', 'faculty'), 'A');
  assert.equal(getChatSenderInitial('ENGR. Maria Santos', 'faculty'), 'M');
  assert.equal(getChatSenderInitial('Dr. Jose Rizal', 'dept_head'), 'J');
  assert.equal(getChatSenderInitial('Rojo, Jay', 'student'), 'R');
  assert.equal(getChatSenderInitial('', 'faculty'), 'F');
  assert.equal(getChatSenderInitial('', 'student'), 'S');
});

test('getChatMessageActionCapabilities controls Copy and Unsend in long-press popup', () => {
  const ownText = makeMessage(501, {
    content: 'See you in lab!',
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });
  const otherText = makeMessage(502, {
    content: 'Bring your laptops.',
    author: { id: facultyUser.id, name: facultyUser.name, role: 'faculty' },
  });
  const unsentMsg = makeMessage(503, {
    is_unsent: true,
    content: '',
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });
  const ownAttachmentOnly = makeMessage(504, {
    content: '',
    attachment: {
      url: '/storage/chat/100/lab.pdf',
      name: 'lab.pdf',
      type: 'document',
      mime: 'application/pdf',
      size: 2048,
    },
    author: { id: studentUser.id, name: studentUser.name, role: 'student' },
  });

  assert.deepEqual(getChatMessageActionCapabilities(ownText, studentUser), {
    canCopy: true,
    canUnsend: true,
    canOpenMenu: true,
  });
  assert.deepEqual(getChatMessageActionCapabilities(otherText, studentUser), {
    canCopy: true,
    canUnsend: false,
    canOpenMenu: true,
  });
  assert.deepEqual(getChatMessageActionCapabilities(unsentMsg, studentUser), {
    canCopy: false,
    canUnsend: false,
    canOpenMenu: false,
  });
  assert.deepEqual(
    getChatMessageActionCapabilities(ownAttachmentOnly, studentUser),
    {
      canCopy: false,
      canUnsend: true,
      canOpenMenu: true,
    }
  );
});

