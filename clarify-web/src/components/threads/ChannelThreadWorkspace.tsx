'use client';

import { useEffect, useState } from 'react';
import { useThreads } from '@/hooks/useThreads';
import { convertThreadToFaq, createThread, deleteThread, listClassFaqs, replyToThread, updateThread } from '@/lib/thread-service';
import type { ClassFaq, QaThread, ThreadReplyInput, ThreadStatus } from '@/types/api';
import { ClassFaqSidebar } from './ClassFaqSidebar';
import { CreateInquiryDrawer } from './CreateInquiryDrawer';
import { FacultyReplyPanel } from './FacultyReplyPanel';
import { QaThreadList } from './QaThreadList';

interface ChannelThreadWorkspaceProps {
  channelId: number;
}

export function ChannelThreadWorkspace({ channelId }: ChannelThreadWorkspaceProps) {
  const [userRole, setUserRole] = useState<'student' | 'faculty'>('student');
  const [status, setStatus] = useState<ThreadStatus | undefined>();
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [faqs, setFaqs] = useState<ClassFaq[]>([]);
  const [faqCompletedKey, setFaqCompletedKey] = useState<string | null>(null);
  const [faqRequestError, setFaqRequestError] = useState<{ key: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { items, isLoading, error, refetch } = useThreads(channelId, status, userRole, 1, reloadToken);
  const selectedThread = items.find((thread) => thread.id === selectedThreadId) ?? items[0] ?? null;
  const faqRequestKey = `${channelId}:${reloadToken}`;
  const faqLoading = faqCompletedKey !== faqRequestKey;
  const faqError = faqRequestError?.key === faqRequestKey ? faqRequestError.message : null;

  useEffect(() => {
    let active = true;
    listClassFaqs(channelId)
      .then((result) => {
        if (active) setFaqs(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setFaqRequestError({
            key: faqRequestKey,
            message: cause instanceof Error ? cause.message : 'Could not load Class FAQs.',
          });
        }
      })
      .finally(() => {
        if (active) setFaqCompletedKey(faqRequestKey);
      });
    return () => {
      active = false;
    };
  }, [channelId, reloadToken, faqRequestKey]);

  const refresh = () => {
    setActionError(null);
    setReloadToken((token) => token + 1);
  };

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The requested action could not be completed.');
      throw cause instanceof Error ? cause : new Error('The requested action could not be completed.');
    }
  };

  const submitInquiry = async (payload: { subject_hashtag: string; content: string; is_private: boolean }) => {
    await createThread(channelId, { ...payload, announcement_id: null });
    setStatus(undefined);
    refresh();
  };

  const removeInquiry = async (id: number) => {
    if (!window.confirm('Delete this unresolved inquiry?')) return;
    await runAction(() => deleteThread(id));
  };

  const submitReply = async (id: number, payload: ThreadReplyInput) => runAction(() => replyToThread(id, payload));

  const pinToFaq = async (id: number) => runAction(() => convertThreadToFaq(id));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ustp-navy">Isolated Q&amp;A Threads</h2>
            <p className="mt-1 text-sm text-ustp-text/70">Course questions stay organized in their own inquiry tickets.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white p-1 text-xs shadow-sm" aria-label="Demo role switcher">
            {(['student', 'faculty'] as const).map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={userRole === role}
                onClick={() => {
                  setUserRole(role);
                  setSelectedThreadId(null);
                }}
                className={`rounded-md px-3 py-2 font-bold capitalize ${
                  userRole === role ? 'bg-ustp-navy text-white' : 'text-ustp-navy hover:bg-ustp-cream'
                }`}
              >
                {role} view
              </button>
            ))}
          </div>
        </div>

        {userRole === 'student' && <CreateInquiryDrawer onSubmit={submitInquiry} />}
        {actionError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {actionError}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading inquiries">
            {[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-ustp-navy/10" />)}
          </div>
        ) : error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span>{error}</span>
            <button type="button" onClick={refetch} className="rounded-lg bg-red-700 px-3 py-2 font-bold text-white">Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ustp-navy/20 bg-white p-10 text-center text-sm text-ustp-text/70">
            No {status ? `${status} ` : ''}inquiries in this course hub yet.
          </div>
        ) : (
          <QaThreadList
            threads={items}
            status={status}
            userRole={userRole}
            currentUserId={1}
            selectedThreadId={selectedThread?.id ?? null}
            onStatusChange={(nextStatus) => {
              setStatus(nextStatus);
              setSelectedThreadId(null);
            }}
            onSelect={(thread: QaThread) => setSelectedThreadId(thread.id)}
            onEdit={(id, content) => runAction(() => updateThread(id, content))}
            onDelete={removeInquiry}
          />
        )}

        {userRole === 'faculty' && selectedThread && (
          <FacultyReplyPanel thread={selectedThread} onReply={submitReply} onConvertToFaq={pinToFaq} />
        )}
      </section>

      <div>
        {faqLoading ? (
          <div className="h-48 animate-pulse rounded-xl bg-ustp-navy/10" aria-label="Loading Class FAQs" />
        ) : faqError ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{faqError}</p>
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              className="mt-3 rounded-lg bg-red-700 px-3 py-2 font-bold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <ClassFaqSidebar faqs={faqs} />
        )}
      </div>
    </div>
  );
}
