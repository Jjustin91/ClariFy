'use client';

import React, { useState } from 'react';
import {
  Check,
  Clock,
  Edit3,
  FileText,
  Pin,
  Trash2,
} from 'lucide-react';
import type { Announcement } from '../../types/api';
import { useClarify } from '../../context/ClarifyContext';
import {
  acknowledgeAnnouncementApi,
  deleteAnnouncementApi,
} from '../../lib/api-client';
import { canPublishOrManageAnnouncements } from '../../lib/domain-logic';
import { TagBadge } from '../ui/StateViews';

export function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila',
    });
  } catch {
    return '12:35 PM';
  }
}

export function AnnouncementCard({
  announcement,
  variant = 'grid',
  onUpdated,
}: {
  announcement: Announcement;
  variant?: 'grid' | 'feed';
  onUpdated?: () => void;
}) {
  const {
    user,
    openAnnouncementModal,
    triggerAnnouncementRefresh,
    showToast,
  } = useClarify();

  const [isAckLoading, setIsAckLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canManage = canPublishOrManageAnnouncements(user.role);
  const isStudent = user.role === 'student';
  const timeFormatted = formatShortTime(announcement.published_at);
  const editedTimeFormatted = formatShortTime(announcement.updated_at);

  const handleAcknowledge = async () => {
    if (announcement.read_reach.has_current_user_acknowledged || isAckLoading) {
      return;
    }
    setIsAckLoading(true);
    try {
      const res = await acknowledgeAnnouncementApi(announcement.id);
      showToast(
        res.message || 'Announcement acknowledged. Read Reach updated.',
        'success'
      );
      triggerAnnouncementRefresh();
      onUpdated?.();
    } catch {
      showToast('Failed to acknowledge announcement.', 'error');
    } finally {
      setIsAckLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await deleteAnnouncementApi(announcement.id);
      showToast(res.message || 'Announcement archived.', 'info');
      triggerAnnouncementRefresh();
      onUpdated?.();
    } catch {
      showToast('Failed to archive announcement.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (variant === 'feed') {
    // Full-width Course Hub Noticeboard Feed Card matching Oct 22 MVP Screenshots Pages 1–2
    return (
      <article className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {announcement.is_pinned && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ustp-navy">
                  <Pin className="w-3.5 h-3.5 text-ustp-gold fill-ustp-gold" />
                  Pinned
                </span>
              )}
              <h3 className="text-base sm:text-lg font-extrabold text-ustp-text tracking-tight leading-snug">
                {announcement.title}
              </h3>
              {announcement.is_edited && (
                <span
                  title={`Last edited at ${editedTimeFormatted} (${announcement.updated_at})`}
                  className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-mono tabular-nums"
                >
                  (Edited {editedTimeFormatted})
                </span>
              )}
              {announcement.status === 'draft' && (
                <span className="text-xs font-bold text-slate-700 bg-slate-200 px-2 py-0.5 rounded">
                  DRAFT
                </span>
              )}
            </div>

            {/* Tag Pills Row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {announcement.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} size="xs" />
              ))}
            </div>

            {/* Publisher Metadata */}
            <p className="text-xs text-slate-600 mt-2 font-medium tabular-nums">
              Posted by {announcement.publisher.name} (
              {announcement.publisher.role === 'faculty'
                ? 'Faculty'
                : announcement.publisher.role.toUpperCase()}
              ) • {timeFormatted}
            </p>
          </div>

          {/* Faculty Edit / Delete Controls (Strictly Hidden for Students — FR-04_REV) */}
          {canManage && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  openAnnouncementModal({ editingAnnouncement: announcement })
                }
                aria-label={`Edit announcement ${announcement.title}`}
                className="p-1.5 text-slate-600 hover:text-ustp-navy hover:bg-slate-100 rounded cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDelete}
                aria-label={`Delete announcement ${announcement.title}`}
                className="p-1.5 text-slate-600 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Announcement Body */}
        <p className="text-[15px] text-ustp-text leading-relaxed mt-3 max-w-[72ch]">
          {announcement.content}
        </p>

        {/* Attachment Preview Bar if present */}
        {announcement.attachment_url && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-ustp-blue">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono">
              {announcement.attachment_name || 'Official_USTP_Attachment.pdf'}
            </span>
          </div>
        )}

        {/* Footer Bar matching Oct 22 MVP Screenshot */}
        <div className="mt-4 pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700 tabular-nums">
              Read Reach:{' '}
              <span className="text-ustp-navy font-extrabold">
                {announcement.read_reach.acknowledged_count} of{' '}
                {announcement.read_reach.enrolled_total}
              </span>{' '}
              enrolled students acknowledged ({announcement.read_reach.percentage}%)
            </span>
            <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden hidden sm:block">
              <div
                className="h-full bg-ustp-gold transition-all duration-200"
                style={{
                  width: `${Math.min(100, announcement.read_reach.percentage)}%`,
                }}
              />
            </div>
          </div>

          {isStudent ? (
            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={
                announcement.read_reach.has_current_user_acknowledged ||
                isAckLoading
              }
              className={`px-3.5 py-1.5 rounded text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                announcement.read_reach.has_current_user_acknowledged
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 cursor-default'
                  : 'bg-ustp-navy text-white hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-gold'
              }`}
            >
              {announcement.read_reach.has_current_user_acknowledged ? (
                <span className="inline-flex items-center gap-1">
                  Acknowledged <Check className="w-3.5 h-3.5" />
                </span>
              ) : isAckLoading ? (
                'Recording...'
              ) : (
                'Mark as Read / Acknowledge'
              )}
            </button>
          ) : (
            <span className="text-xs font-bold text-emerald-700 whitespace-nowrap">
              Live Delivery Tracking Active
            </span>
          )}
        </div>
      </article>
    );
  }

  // Grid Card Layout matching Wireframes Pages 2, 5, 6 (2-column body with left photo/thumbnail box + right excerpt)
  return (
    <article className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
      <div>
        {/* Top Row: Title + Subtitle on Left, Timestamp + Faculty Actions on Right */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm sm:text-base font-extrabold text-ustp-text tracking-tight leading-snug">
                {announcement.title}
              </h3>
              {announcement.is_edited && (
                <span
                  title={`Edited at ${editedTimeFormatted} (${announcement.updated_at})`}
                  className="text-[11px] font-mono font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded tabular-nums"
                >
                  (Edited)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 font-medium">
              {announcement.subtitle || 'USTP Digital Transformation'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-slate-500 font-mono tabular-nums flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeFormatted}
            </span>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openAnnouncementModal({ editingAnnouncement: announcement })
                  }
                  aria-label={`Edit ${announcement.title}`}
                  className="p-1 text-slate-500 hover:text-ustp-navy rounded cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  aria-label={`Delete ${announcement.title}`}
                  className="p-1 text-slate-500 hover:text-red-700 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Colored Tag Pills Row matching Wireframe */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {announcement.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} size="xs" />
          ))}
        </div>

        {/* 2-Column Body matching Wireframes Pages 2, 5, 6: Left photo/memo box, Right text excerpt */}
        <div className="grid grid-cols-12 gap-4 mt-3.5 items-stretch">
          <div className="col-span-5 bg-slate-100 border border-slate-200 rounded-md p-3 flex flex-col items-center justify-center text-center min-h-[116px] overflow-hidden">
            <div className="w-9 h-9 rounded bg-ustp-navy text-ustp-gold flex items-center justify-center font-extrabold text-xs mb-1.5 shrink-0">
              {announcement.publisher.department}
            </div>
            <p
              title={announcement.attachment_name || 'USTP Official Memo'}
              className="text-[11px] font-bold text-ustp-text w-full truncate px-1"
            >
              {announcement.attachment_name || 'USTP Official Memo'}
            </p>
            <span className="text-[10px] font-mono text-slate-500 mt-0.5 tabular-nums w-full truncate">
              By {announcement.publisher.name}
            </span>
          </div>

          <div className="col-span-7 flex flex-col justify-between">
            <p className="text-xs sm:text-sm text-ustp-text leading-relaxed line-clamp-5">
              {announcement.content}
            </p>
          </div>
        </div>
      </div>

      {/* Card Footer: Read Reach & Student Acknowledge Action */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <div className="text-xs font-mono tabular-nums text-slate-600">
          Read Reach:{' '}
          <span className="font-bold text-ustp-navy">
            {announcement.read_reach.percentage}% (
            {announcement.read_reach.acknowledged_count}/
            {announcement.read_reach.enrolled_total})
          </span>
        </div>

        {isStudent ? (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={
              announcement.read_reach.has_current_user_acknowledged ||
              isAckLoading
            }
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors cursor-pointer ${
              announcement.read_reach.has_current_user_acknowledged
                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                : 'bg-ustp-navy text-white hover:opacity-95'
            }`}
          >
            {announcement.read_reach.has_current_user_acknowledged
              ? 'Acknowledged ✓'
              : 'Mark as Read / Acknowledge'}
          </button>
        ) : (
          <span className="text-[11px] font-bold text-emerald-700">
            Live Delivery Tracking
          </span>
        )}
      </div>
    </article>
  );
}
