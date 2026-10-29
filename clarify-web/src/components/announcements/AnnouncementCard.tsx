'use client';

import { useState, useRef, useLayoutEffect } from 'react';
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

  // States for text overflow detection and expansion
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // Local optimistic state for live Read Reach updates
  const [localReach, setLocalReach] = useState(announcement.read_reach);

  const isStudent = userRole === 'student';
  const { publisher } = announcement;

  // Detect if content height overflows 3 lines
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) {
      const hasOverflow = el.scrollHeight > el.clientHeight;
      setIsClamped(hasOverflow);
    }
  }, [announcement.content]);

  const handleAcknowledge = async () => {
    if (!onAcknowledge || localReach.has_current_user_acknowledged) return;
    setIsAcknowledging(true);
    setAckError(null);

    try {
      await onAcknowledge(announcement.id);
      setLocalReach((prev) => {
        const newCount = prev.acknowledged_count + 1;
        const newPercentage = Math.round((newCount / prev.enrolled_total) * 1000) / 10;
        return {
          ...prev,
          acknowledged_count: newCount,
          percentage: Math.min(newPercentage, 100),
          has_current_user_acknowledged: true,
        };
      });
    } catch (e) {
      setAckError(e instanceof Error ? e.message : 'Could not acknowledge. Try again.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  return (
    <article
      className={`flex flex-col h-full rounded-lg bg-white p-5 shadow-sm border ${
        announcement.is_urgent ? 'border-ustp-orange' : 'border-gray-200'
      }`}
    >
      {/* Top Header Section */}
      <div>
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

        {/* Title + Meta */}
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

        {/* Body Content with Smart Overflow Detection */}
        <div className="mt-3">
          <p
            ref={textRef}
            className={`whitespace-pre-line text-ustp-text ${
              !isExpanded ? 'line-clamp-3' : ''
            }`}
          >
            {announcement.content}
          </p>

          {(isClamped || isExpanded) && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 block text-xs font-bold text-ustp-navy hover:underline focus:outline-none"
            >
              {isExpanded ? 'See less' : 'See more...'}
            </button>
          )}
        </div>

        {/* Attachment Link */}
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
      </div>

      {/* Bottom Sticky Footer Container (Always aligned across grid) */}
      <div className="mt-auto pt-4 space-y-4">
        {/* Read Reach Progress Bar */}
        <div>
          <div className="mb-1 flex justify-between text-xs text-ustp-text/70">
            <span>Read Reach</span>
            <span>
              {localReach.acknowledged_count}/{localReach.enrolled_total}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-valuenow={localReach.percentage}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-ustp-gold transition-all duration-300"
              style={{ width: `${Math.min(localReach.percentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {isStudent ? (
            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={isAcknowledging || localReach.has_current_user_acknowledged}
              className="rounded bg-ustp-navy px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {localReach.has_current_user_acknowledged
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
                className="rounded border border-ustp-navy px-4 py-2 text-sm font-semibold text-ustp-navy hover:bg-ustp-navy/5"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete?.(announcement.id)}
                className="rounded border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>

        {ackError && <p className="text-sm text-red-600">{ackError}</p>}
      </div>
    </article>
  );
}