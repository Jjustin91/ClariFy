'use client';

import { useState, type FormEvent } from 'react';
import type { QaThread, ThreadReplyInput } from '@/types/api';

interface FacultyReplyPanelProps {
  thread: QaThread;
  onReply: (id: number, payload: ThreadReplyInput) => Promise<void>;
  onConvertToFaq: (id: number) => Promise<void>;
}

export function FacultyReplyPanel({ thread, onReply, onConvertToFaq }: FacultyReplyPanelProps) {
  const [content, setContent] = useState('');
  const [markResolved, setMarkResolved] = useState(thread.status === 'resolved');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reply = content.trim();
    if (!reply) {
      setError('Enter a reply before submitting.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onReply(thread.id, { content: reply, mark_resolved: markResolved, pin_to_faq: false });
      setContent('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send your reply.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const publishFaq = async () => {
    setIsPublishing(true);
    setError(null);
    try {
      await onConvertToFaq(thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish this inquiry to Class FAQs.');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <section className="rounded-xl border border-ustp-gold/60 bg-ustp-cream p-4">
      <h3 className="font-bold text-ustp-navy">Answer Ticket</h3>
      <form onSubmit={submitReply} className="mt-3 space-y-3">
        <label className="block space-y-1 text-sm font-semibold text-ustp-text">
          Faculty reply
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            required
            className="w-full rounded-lg border border-ustp-navy/20 bg-white px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-ustp-gold"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ustp-text">
          <input
            type="checkbox"
            checked={markResolved}
            onChange={(event) => setMarkResolved(event.target.checked)}
            className="accent-ustp-navy"
          />
          Mark as Resolved
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-ustp-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {isSubmitting ? 'Sending…' : 'Send reply'}
        </button>
      </form>
      {thread.replies.length > 0 &&
        thread.status === 'resolved' &&
        !thread.is_private &&
        !thread.is_pinned_faq && (
        <button
          type="button"
          disabled={isPublishing}
          onClick={() => void publishFaq()}
          className="mt-3 rounded-lg border border-ustp-navy px-4 py-2 text-sm font-bold text-ustp-navy hover:bg-white disabled:opacity-60"
        >
          {isPublishing ? 'Publishing…' : 'Pin Ticket / Publish to FAQ'}
        </button>
      )}
      {thread.is_pinned_faq && !thread.is_private && (
        <p className="mt-3 text-sm font-semibold text-emerald-800">Published to Class FAQs</p>
      )}
      {thread.replies.length > 0 && thread.status !== 'resolved' && !thread.is_private && (
        <p className="mt-3 text-sm text-ustp-text/70">Resolve this inquiry before publishing it to Class FAQs.</p>
      )}
      {thread.is_private && (
        <p className="mt-3 text-sm text-ustp-text/70">Private inquiries cannot be published to Class FAQs.</p>
      )}
    </section>
  );
}
