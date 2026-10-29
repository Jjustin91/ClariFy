'use client';

import { useState } from 'react';
import type { QaThread, UserRole } from '@/types/api';

interface QaThreadCardProps {
  thread: QaThread;
  userRole: UserRole;
  currentUserId: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: (id: number, content: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function QaThreadCard({
  thread,
  userRole,
  currentUserId,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: QaThreadCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [content, setContent] = useState(thread.content);
  const [actionError, setActionError] = useState<string | null>(null);
  const canEdit = userRole === 'student' && thread.author_id === currentUserId && thread.status === 'open';
  const displayName = thread.is_pinned_faq ? 'Anonymous Student' : thread.author_name;

  const saveEdit = async () => {
    const nextContent = content.trim();
    if (!nextContent) return;
    setActionError(null);
    try {
      await onEdit(thread.id, nextContent);
      setIsEditing(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update this inquiry.');
    }
  };

  const removeInquiry = async () => {
    setActionError(null);
    try {
      await onDelete(thread.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not delete this inquiry.');
    }
  };

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        selected ? 'border-ustp-gold ring-2 ring-ustp-gold/30' : 'border-ustp-navy/10'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => {
            setIsExpanded((expanded) => !expanded);
            onSelect();
          }}
          className="min-w-0 flex-1 text-left"
        >
          <span className="font-bold text-ustp-navy">{thread.subject_hashtag}</span>
          <span
            className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
              thread.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {thread.status === 'resolved' ? 'RESOLVED' : 'OPEN'}
          </span>
          {thread.is_private && (
            <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              Private
            </span>
          )}
          {thread.is_pinned_faq && (
            <span className="ml-2 inline-flex rounded-full bg-ustp-gold/20 px-2 py-0.5 text-xs font-semibold text-ustp-navy">
              Pinned to Class FAQs
            </span>
          )}
        </button>
        <time className="text-xs text-ustp-text/60" dateTime={thread.created_at}>
          {formatDate(thread.created_at)}
        </time>
      </div>

      {isExpanded && (
        <>
          <p className="mt-2 text-sm font-semibold text-ustp-text">{displayName}</p>
          {isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                aria-label="Edit inquiry"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-ustp-navy/20 p-3 text-sm text-ustp-text focus:outline-none focus:ring-2 focus:ring-ustp-gold"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEdit()} className="rounded bg-ustp-navy px-3 py-1.5 text-xs font-bold text-white">
                  Save changes
                </button>
                <button type="button" onClick={() => setIsEditing(false)} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ustp-text">{thread.content}</p>
          )}
          {actionError && <p role="alert" className="mt-2 text-sm text-red-700">{actionError}</p>}

          {thread.replies.length > 0 && (
            <div className="mt-4 space-y-3 border-l-2 border-ustp-gold pl-4">
              {thread.replies.map((reply) => (
                <div key={reply.id}>
                  <p className="text-xs font-bold text-ustp-navy">Faculty Reply · {reply.author_name}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ustp-text">{reply.content}</p>
                  <time className="mt-1 block text-xs text-ustp-text/50" dateTime={reply.created_at}>
                    {formatDate(reply.created_at)}
                  </time>
                </div>
              ))}
            </div>
          )}

          {canEdit && !isEditing && (
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setIsEditing(true)} className="rounded border border-ustp-navy/20 px-3 py-1.5 text-xs font-semibold text-ustp-navy">
                Edit
              </button>
              <button type="button" onClick={() => void removeInquiry()} className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
