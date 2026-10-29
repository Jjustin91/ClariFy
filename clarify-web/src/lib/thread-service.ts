import { mockThreads } from '@/mocks/threads';
import type { ClassFaq, CreateThreadInput, QaThread, ThreadReplyInput, ThreadStatus } from '@/types/api';

const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const currentStudentId = 1;

export async function listThreads(
  channelId: number,
  status?: ThreadStatus,
  viewerRole: 'student' | 'faculty' = 'student',
  viewerId = 1
): Promise<QaThread[]> {
  await wait();
  return mockThreads.filter(
    (thread) =>
      thread.channel_id === channelId &&
      (!status || thread.status === status) &&
      (!thread.is_private || viewerRole === 'faculty' || thread.author_id === viewerId)
  );
}

export async function createThread(channelId: number, payload: CreateThreadInput): Promise<QaThread> {
  await wait();
  const timestamp = new Date().toISOString();
  const created: QaThread = {
    id: Date.now(),
    channel_id: channelId,
    ...payload,
    status: 'open',
    is_pinned_faq: false,
    author_id: 1,
    author_name: 'Kobeni Higashiyama',
    created_at: timestamp,
    updated_at: timestamp,
    replies: [],
  };
  mockThreads.unshift(created);
  return created;
}

export async function updateThread(id: number, content: string): Promise<void> {
  await wait();
  const target = mockThreads.find((thread) => thread.id === id);
  if (!target || target.author_id !== currentStudentId || target.status !== 'open') {
    throw new Error('Only your own unresolved inquiry can be edited.');
  }
  target.content = content;
  target.updated_at = new Date().toISOString();
}

export async function deleteThread(id: number): Promise<void> {
  await wait();
  const index = mockThreads.findIndex((thread) => thread.id === id);
  if (
    index < 0 ||
    mockThreads[index].author_id !== currentStudentId ||
    mockThreads[index].status !== 'open'
  ) {
    throw new Error('Only your own unresolved inquiry can be deleted.');
  }
  mockThreads.splice(index, 1);
}

export async function replyToThread(id: number, payload: ThreadReplyInput): Promise<void> {
  await wait();
  const target = mockThreads.find((thread) => thread.id === id);
  if (!target) throw new Error('This inquiry is no longer available.');
  if (target.is_private && payload.pin_to_faq) {
    throw new Error('Private inquiries cannot be published to Class FAQs.');
  }
  if (payload.pin_to_faq && !payload.mark_resolved && target.status !== 'resolved') {
    throw new Error('Resolve this inquiry before publishing it to Class FAQs.');
  }
  const timestamp = new Date().toISOString();
  target.replies.push({
    id: Date.now(),
    content: payload.content,
    author_id: 3,
    author_name: 'Aki Hayakawa',
    created_at: timestamp,
  });
  target.updated_at = timestamp;
  if (payload.mark_resolved) target.status = 'resolved';
  if (payload.pin_to_faq) target.is_pinned_faq = true;
}

export async function convertThreadToFaq(id: number): Promise<void> {
  await wait();
  const target = mockThreads.find((thread) => thread.id === id);
  if (!target || target.replies.length === 0 || target.status !== 'resolved') {
    throw new Error('Resolve and reply to the inquiry before publishing it to Class FAQs.');
  }
  if (target.is_private) {
    throw new Error('Private inquiries cannot be published to Class FAQs.');
  }
  target.is_pinned_faq = true;
  target.status = 'resolved';
  target.updated_at = new Date().toISOString();
}

export async function listClassFaqs(channelId: number): Promise<ClassFaq[]> {
  await wait();
  return mockThreads
    .filter((thread) =>
      thread.channel_id === channelId &&
      thread.is_pinned_faq &&
      thread.status === 'resolved' &&
      !thread.is_private &&
      thread.replies.length > 0
    )
    .map((thread) => ({
      id: thread.id,
      subject_hashtag: thread.subject_hashtag,
      question: thread.content,
      answer: thread.replies[thread.replies.length - 1].content,
      published_at: thread.updated_at,
    }));
}
