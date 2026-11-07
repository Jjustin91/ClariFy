'use client';

import React, { useState } from 'react';
import {
  Check,
  Clock,
  Download,
  Edit3,
  FileText,
  Maximize2,
  Pin,
  Trash2,
  X,
} from 'lucide-react';
import type { Announcement } from '../../types/api';
import { useClarify } from '../../context/ClarifyContext';
import {
  acknowledgeAnnouncementApi,
  deleteAnnouncementApi,
} from '../../lib/api-client';
import {
  canPublishOrManageAnnouncements,
  parseAnnouncementAttachment,
} from '../../lib/domain-logic';
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
    channels,
    openAnnouncementModal,
    triggerAnnouncementRefresh,
    showToast,
  } = useClarify();

  const [isAckLoading, setIsAckLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const {
    cleanContent,
    attachmentUrl,
    attachmentName,
    attachmentType,
  } = parseAnnouncementAttachment(announcement);

  const isRenderableImage = Boolean(
    attachmentType === 'image' &&
      attachmentUrl &&
      (attachmentUrl.startsWith('data:image/') ||
        attachmentUrl.startsWith('http://') ||
        attachmentUrl.startsWith('https://') ||
        attachmentUrl.startsWith('/assets/'))
  );

  const hasAttachment = Boolean(attachmentUrl || attachmentName);

  const matchedChannel = channels.find(
    (c) => Number(c.id) === Number(announcement.channel_id)
  );
  const isCampusWideMemo =
    announcement.channel_type === 'university' ||
    matchedChannel?.channel_type === 'university';
  const canManage = isCampusWideMemo
    ? user.role === 'dept_head'
    : canPublishOrManageAnnouncements(user.role);
  const isStudent = user.role === 'student';
  const timeFormatted = formatShortTime(announcement.published_at);
  const editedTimeFormatted = formatShortTime(announcement.updated_at);

  const courseCode =
    announcement.course_code ||
    (!isCampusWideMemo ? matchedChannel?.course_code : null) ||
    null;
  const courseHubName =
    announcement.channel_name ||
    (!isCampusWideMemo && matchedChannel?.name
      ? matchedChannel.name.replace(/^#\s*/, '').trim()
      : null);

  const departmentSubtitle =
    !isCampusWideMemo && courseHubName
      ? `${courseHubName} • ${announcement.publisher.department || 'CITC'} Department`
      : announcement.subtitle &&
        announcement.subtitle !== 'USTP Digital Transformation'
      ? announcement.subtitle
      : `${announcement.publisher.department || 'CITC'} Department`;

  const defaultAttachmentLabel = isCampusWideMemo
    ? 'USTP Official Memo'
    : 'Course Hub Announcement';
  const badgeBoxCode =
    !isCampusWideMemo && courseCode
      ? courseCode
      : announcement.publisher.department || 'CITC';

  const displayTags: string[] = isCampusWideMemo
    ? announcement.tags
    : [
        ...(announcement.is_urgent ? ['URGENT NOTICE'] : []),
        'COURSE HUB',
        ...(courseCode ? [courseCode] : []),
      ];

  const handleDownloadAttachment = () => {
    const fileName =
      attachmentName ||
      (isCampusWideMemo
        ? 'Official_USTP_Attachment.pdf'
        : 'Course_Hub_Attachment.pdf');
    if (
      attachmentUrl &&
      (attachmentUrl.startsWith('data:') ||
        attachmentUrl.startsWith('http://') ||
        attachmentUrl.startsWith('https://'))
    ) {
      const link = document.createElement('a');
      link.href = attachmentUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    // Fallback for legacy filename-only records: generate a clean text summary document download
    const summaryText = `USTP ClariFy — Official Attachment Reference\nTitle: ${announcement.title}\nFile: ${fileName}\nPublished by: ${announcement.publisher.name} (${departmentSubtitle})\n\n${cleanContent}\n`;
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };

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

  const lightboxModal =
    isLightboxOpen && isRenderableImage && attachmentUrl ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={attachmentName || announcement.title}
        onClick={() => setIsLightboxOpen(false)}
      >
        <div
          className="bg-white border border-slate-300 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-ustp-navy text-white">
            <div className="min-w-0 pr-3">
              <p className="text-xs sm:text-sm font-bold truncate">
                {attachmentName || announcement.title}
              </p>
              <p className="text-[11px] text-slate-300 truncate">
                {departmentSubtitle} • Posted by {announcement.publisher.name}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadAttachment}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                aria-label="Close image preview"
                className="p-1.5 rounded hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-4 bg-slate-900 flex items-center justify-center overflow-auto max-h-[78vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachmentUrl}
              alt={attachmentName || announcement.title}
              className="max-w-full max-h-[72vh] object-contain rounded"
            />
          </div>
        </div>
      </div>
    ) : null;

  if (variant === 'feed') {
    // Full-width Course Hub Noticeboard Feed Card matching Oct 22 MVP Screenshots Pages 1–2
    return (
      <>
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
              <p className="text-xs text-slate-600 font-medium mt-0.5">
                {departmentSubtitle}
              </p>

              {/* Tag Pills Row */}
              {displayTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {displayTags.map((tag) => (
                    <TagBadge key={tag} tag={tag} size="xs" />
                  ))}
                </div>
              )}

              {/* Publisher Metadata */}
              <p className="text-xs text-slate-600 mt-2 font-medium tabular-nums">
                Posted by {announcement.publisher.name} (
                {announcement.publisher.role === 'faculty'
                  ? 'Faculty'
                  : announcement.publisher.role === 'dept_head'
                  ? 'Department Head'
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
                    openAnnouncementModal({
                      editingAnnouncement: announcement,
                      mode: isCampusWideMemo ? 'campus_wide' : 'course_hub',
                    })
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
          <p className="text-[15px] text-ustp-text leading-relaxed mt-3 max-w-[72ch] whitespace-pre-wrap">
            {cleanContent}
          </p>

          {/* Rich Attachment Preview (Image or Document) */}
          {isRenderableImage && attachmentUrl ? (
            <div className="mt-3.5 max-w-lg">
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="group relative block rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-ustp-navy transition-colors text-left cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachmentUrl}
                  alt={attachmentName || announcement.title}
                  className="max-h-72 w-auto object-contain bg-slate-100"
                />
                <div className="px-3 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-ustp-text truncate">
                    {attachmentName || 'Attached Image'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ustp-navy shrink-0">
                    <Maximize2 className="w-3 h-3" />
                    View Full Size
                  </span>
                </div>
              </button>
            </div>
          ) : (
            hasAttachment && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleDownloadAttachment}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded text-xs font-semibold text-ustp-blue transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-mono truncate max-w-xs">
                    {attachmentName ||
                      (isCampusWideMemo
                        ? 'Official_USTP_Attachment.pdf'
                        : 'Course_Hub_Attachment.pdf')}
                  </span>
                  <Download className="w-3.5 h-3.5 shrink-0 text-ustp-navy" />
                </button>
              </div>
            )
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
                enrolled students acknowledged (
                {announcement.read_reach.percentage}%)
              </span>
              <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden hidden sm:block">
                <div
                  className="h-full bg-ustp-gold transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      announcement.read_reach.percentage
                    )}%`,
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
        {lightboxModal}
      </>
    );
  }

  // Grid Card Layout matching Wireframes Pages 2, 5, 6 (2-column body with left photo/thumbnail box + right excerpt)
  return (
    <>
      <article className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
        <div>
          {/* Top Row: Title + Department/Course Hub Subtitle on Left, Timestamp + Faculty Actions on Right */}
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
                {departmentSubtitle}
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
                      openAnnouncementModal({
                        editingAnnouncement: announcement,
                        mode: isCampusWideMemo ? 'campus_wide' : 'course_hub',
                      })
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

          {/* Colored Tag Pills Row differentiating Campus-Wide Memos vs Course Hub Announcements */}
          {displayTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {displayTags.map((tag) => (
                <TagBadge key={tag} tag={tag} size="xs" />
              ))}
            </div>
          )}

          {/* 2-Column Body matching Wireframes Pages 2, 5, 6: Left photo/notice box, Right text excerpt */}
          <div className="grid grid-cols-12 gap-4 mt-3.5 items-stretch">
            {isRenderableImage && attachmentUrl ? (
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                title={`Click to view ${attachmentName || 'image'} full size`}
                className="col-span-5 bg-slate-100 border border-slate-200 hover:border-ustp-navy rounded-md overflow-hidden flex flex-col justify-between min-h-[116px] cursor-pointer group relative"
              >
                <div className="w-full h-24 bg-slate-200 overflow-hidden relative flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachmentUrl}
                    alt={attachmentName || announcement.title}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-1.5 right-1.5 p-1 rounded bg-ustp-navy/85 text-white opacity-90 group-hover:opacity-100">
                    <Maximize2 className="w-3 h-3" />
                  </span>
                </div>
                <div className="p-1.5 bg-white border-t border-slate-200 w-full text-center">
                  <p className="text-[10px] font-bold text-ustp-text truncate">
                    {attachmentName || 'Attached Image'}
                  </p>
                </div>
              </button>
            ) : hasAttachment ? (
              <button
                type="button"
                onClick={handleDownloadAttachment}
                title={`Click to download ${
                  attachmentName || defaultAttachmentLabel
                }`}
                className="col-span-5 bg-slate-100 hover:bg-slate-200/70 border border-slate-200 hover:border-ustp-navy rounded-md p-3 flex flex-col items-center justify-center text-center min-h-[116px] overflow-hidden transition-colors cursor-pointer"
              >
                <div className="w-9 h-9 rounded bg-ustp-navy text-ustp-gold flex items-center justify-center mb-1.5 shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <p className="text-[11px] font-bold text-ustp-blue underline w-full truncate px-1">
                  {attachmentName || defaultAttachmentLabel}
                </p>
                <span className="text-[10px] font-mono text-slate-600 mt-0.5 inline-flex items-center gap-1">
                  <Download className="w-3 h-3" />
                  Download File
                </span>
              </button>
            ) : (
              <div className="col-span-5 bg-slate-100 border border-slate-200 rounded-md p-3 flex flex-col items-center justify-center text-center min-h-[116px] overflow-hidden">
                <div className="px-2 h-9 min-w-[36px] rounded bg-ustp-navy text-ustp-gold flex items-center justify-center font-extrabold text-xs mb-1.5 shrink-0">
                  {badgeBoxCode}
                </div>
                <p
                  title={defaultAttachmentLabel}
                  className="text-[11px] font-bold text-ustp-text w-full truncate px-1"
                >
                  {defaultAttachmentLabel}
                </p>
                <span className="text-[10px] font-mono text-slate-500 mt-0.5 tabular-nums w-full truncate">
                  By {announcement.publisher.name}
                </span>
              </div>
            )}

            <div className="col-span-7 flex flex-col justify-between">
              <p className="text-xs sm:text-sm text-ustp-text leading-relaxed line-clamp-5 whitespace-pre-wrap">
                {cleanContent}
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
      {lightboxModal}
    </>
  );
}
