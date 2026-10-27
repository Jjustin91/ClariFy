'use client';
import { useState } from 'react';
import type { Announcement, UserRole } from '@/types/api';

interface AnnouncementCardProps {
  announcement: Announcement;
  userRole: UserRole;
  onAcknowledge?: (id: number) => Promise<void>;
  onEdit?: (announcement: Announcement) => void;
  onDelete?: (id: number) => void;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

export function AnnouncementCard({
  announcement,
  userRole,
  onAcknowledge,
  onEdit,
  onDelete,
}: AnnouncementCardProps) {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  const isStudent = userRole === 'student';
  const { read_reach: reach, publisher } = announcement;

  const handleAcknowledge = async () => {
    if (!onAcknowledge) return;
    setIsAcknowledging(true);
    setAckError(null);
    try {
      await onAcknowledge(announcement.id);
    } catch (e) {
      setAckError(e instanceof Error ? e.message : 'Could not acknowledge. Try again.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  return (
    <article
      className={`rounded-lg bg-white p-5 shadow-sm border ${
        announcement.is_urgent ? 'border-ustp-orange' : 'border-gray-200'
      }`}
    >
      {/* Tags */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {announcement.is_pinned && (
          <span className="text-xs font-semibold text-ustp-orange">📌 Pinned</span>
        )}
        {announcement.tags.map((tag) => (
          <span
            key={tag}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              tag === 'URGENT NOTICE'
                ? 'bg-ustp-orange text-white'
                : 'bg-ustp-blue text-white'
            }`}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Title + meta */}
      <h3 className="text-lg font-bold text-ustp-navy">{announcement.title}</h3>
      <p className="mt-1 text-sm text-ustp-text/70">
        {publisher.name} · {publisher.department} · {formatDate(announcement.published_at)}
        {announcement.is_edited && (
          <span
            className="ml-2 cursor-help rounded bg-ustp-gold/20 px-2 py-0.5 text-xs font-semibold text-ustp-navy"
            title={`Edited on ${formatDate(announcement.updated_at)}`}
          >
            (Edited)
          </span>
        )}
      </p>

      {/* Body */}
      <p className="mt-3 whitespace-pre-line text-ustp-text">{announcement.content}</p>

      {/* Attachment */}
      {announcement.attachment_url && (
        <a
          href={announcement.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-semibold text-ustp-blue underline"
        >
          📎 View attachment
        </a>
      )}

      {/* Read Reach */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-ustp-text/70">
          <span>Read Reach</span>
          <span>
            {reach.acknowledged_count}/{reach.enrolled_total}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={reach.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-ustp-gold"
            style={{ width: `${Math.min(reach.percentage, 100)}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isStudent ? (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={isAcknowledging || reach.has_current_user_acknowledged}
            className="rounded bg-ustp-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {reach.has_current_user_acknowledged
              ? '✓ Acknowledged'
              : isAcknowledging
              ? 'Sending...'
              : 'Mark as Read / Acknowledge'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onEdit?.(announcement)}
              className="rounded border border-ustp-navy px-4 py-2 text-sm font-semibold text-ustp-navy"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(announcement.id)}
              className="rounded border border-red-600 px-4 py-2 text-sm font-semibold text-red-600"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {ackError && <p className="mt-2 text-sm text-red-600">{ackError}</p>}
    </article>
  );
}