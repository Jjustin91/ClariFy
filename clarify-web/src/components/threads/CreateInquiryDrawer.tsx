'use client';

import { useState, type FormEvent } from 'react';

interface CreateInquiryDrawerProps {
  onSubmit: (payload: { subject_hashtag: string; content: string; is_private: boolean }) => Promise<void>;
}

export function CreateInquiryDrawer({ onSubmit }: CreateInquiryDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanSubject = subject.trim();
    const cleanContent = content.trim();
    if (!cleanSubject || !cleanContent) {
      setError('Enter a subject and question before submitting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        subject_hashtag: cleanSubject.startsWith('#') ? cleanSubject : `#${cleanSubject}`,
        content: cleanContent,
        is_private: isPrivate,
      });
      setSubject('');
      setContent('');
      setIsPrivate(false);
      setIsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit your inquiry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-ustp-navy/10 bg-white p-4 shadow-sm">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((open) => !open);
          setError(null);
        }}
        className="flex w-full items-center justify-between text-left font-bold text-ustp-navy"
      >
        <span>Create Ticket</span>
        <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm font-semibold text-ustp-text">
            Subject hashtag
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="#Defence"
              required
              className="w-full rounded-lg border border-ustp-navy/20 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-ustp-gold"
            />
          </label>
          <label className="block space-y-1 text-sm font-semibold text-ustp-text">
            Your question
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              required
              className="w-full rounded-lg border border-ustp-navy/20 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-ustp-gold"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-ustp-text">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
              className="mt-1 accent-ustp-navy"
            />
            <span>Make Inquiry Private (Visible only to Instructor)</span>
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-ustp-navy px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Submitting…' : 'Submit inquiry'}
          </button>
        </form>
      )}
    </section>
  );
}
