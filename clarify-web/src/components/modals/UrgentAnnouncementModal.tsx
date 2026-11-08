'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Radio,
  Smartphone,
  X,
} from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { acknowledgeAnnouncementApi } from '../../lib/api-client';
import { parseAnnouncementAttachment } from '../../lib/domain-logic';
import { formatShortTime } from '../announcements/AnnouncementCard';
import { TagBadge } from '../ui/StateViews';

export function UrgentAnnouncementModal() {
  const {
    user,
    urgentPopupAnnouncement,
    dismissUrgentPopup,
    triggerAnnouncementRefresh,
    showToast,
  } = useClarify();

  const [isAckLoading, setIsAckLoading] = useState(false);

  if (!urgentPopupAnnouncement || user.role === 'it_admin') {
    return null;
  }

  const isStudent = user.role === 'student';
  const hasAcknowledged =
    urgentPopupAnnouncement.read_reach.has_current_user_acknowledged;
  const timeFormatted = formatShortTime(urgentPopupAnnouncement.published_at);
  const { cleanContent, attachmentUrl, attachmentName, attachmentType } =
    parseAnnouncementAttachment(urgentPopupAnnouncement);

  const handleAcknowledge = async () => {
    if (isAckLoading) return;
    setIsAckLoading(true);
    try {
      const res = await acknowledgeAnnouncementApi(urgentPopupAnnouncement.id);
      showToast(
        res.message ||
          'Urgent announcement acknowledged! Read Reach counter updated.',
        'success'
      );
      triggerAnnouncementRefresh();
      dismissUrgentPopup(urgentPopupAnnouncement.id);
    } catch {
      showToast('Failed to record acknowledgment. Please try again.', 'error');
    } finally {
      setIsAckLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[1px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="urgent-popup-title"
    >
      <div className="bg-white border-2 border-red-700 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Top Urgent Alert Header */}
        <div className="bg-red-700 text-white px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/15 text-ustp-gold">
              <Radio className="w-5 h-5 animate-pulse" />
            </span>
            <div>
              <span className="text-[11px] font-mono font-extrabold uppercase tracking-wider text-ustp-gold block">
                LIVE REVERB URGENT CAMPUS NOTICE
              </span>
              <h2
                id="urgent-popup-title"
                className="text-sm sm:text-base font-extrabold tracking-tight"
              >
                Immediate Attention &amp; Acknowledgment Required
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => dismissUrgentPopup(urgentPopupAnnouncement.id)}
            aria-label="Dismiss urgent notice popup"
            className="p-1 rounded hover:bg-white/15 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {urgentPopupAnnouncement.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} size="xs" />
              ))}
              {urgentPopupAnnouncement.trigger_sms_fallback && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <Smartphone className="w-3 h-3" />
                  SMS Fallback Active
                </span>
              )}
            </div>

            <h3 className="text-lg sm:text-xl font-extrabold text-ustp-navy leading-snug pt-1">
              {urgentPopupAnnouncement.title}
            </h3>

            <p className="text-xs text-slate-600 font-medium tabular-nums">
              Published by{' '}
              <span className="font-bold text-ustp-text">
                {urgentPopupAnnouncement.publisher.name}
              </span>{' '}
              ({urgentPopupAnnouncement.publisher.department}) • {timeFormatted}
            </p>
          </div>

          <div className="p-4 bg-red-50/70 border border-red-200 rounded-lg text-sm text-ustp-text leading-relaxed whitespace-pre-wrap">
            {cleanContent}
          </div>

          {attachmentType === 'image' &&
          attachmentUrl &&
          (attachmentUrl.startsWith('data:image/') ||
            attachmentUrl.startsWith('blob:') ||
            attachmentUrl.startsWith('http') ||
            attachmentUrl.startsWith('/storage/') ||
            attachmentUrl.startsWith('/assets/')) ? (
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50 max-h-56 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentUrl}
                alt={attachmentName || urgentPopupAnnouncement.title}
                className="max-h-52 w-auto object-contain"
              />
            </div>
          ) : (
            (attachmentUrl || attachmentName) && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-ustp-blue">
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono">
                  {attachmentName || 'Official_USTP_Attachment.pdf'}
                </span>
              </div>
            )
          )}

          {/* Live Acknowledgment Counter Bar */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Live Acknowledgment Counter:
              </span>
              {urgentPopupAnnouncement.read_reach.enrolled_total > 0 ? (
                <span className="font-mono font-extrabold text-ustp-navy tabular-nums">
                  {urgentPopupAnnouncement.read_reach.acknowledged_count} of{' '}
                  {urgentPopupAnnouncement.read_reach.enrolled_total} students (
                  {urgentPopupAnnouncement.read_reach.percentage}%)
                </span>
              ) : (
                <span className="font-mono font-extrabold text-ustp-navy tabular-nums">
                  No enrolled students yet
                </span>
              )}
            </div>
            {urgentPopupAnnouncement.read_reach.enrolled_total > 0 && (
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-ustp-gold transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      urgentPopupAnnouncement.read_reach.percentage
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={() => dismissUrgentPopup(urgentPopupAnnouncement.id)}
              className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-slate-600 hover:text-ustp-text bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
            >
              {isStudent && !hasAcknowledged ? 'Remind Me Later' : 'Close'}
            </button>

            {isStudent && (
              <button
                type="button"
                onClick={handleAcknowledge}
                disabled={hasAcknowledged || isAckLoading}
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded text-xs font-extrabold transition-colors cursor-pointer ${
                  hasAcknowledged
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-ustp-navy text-ustp-gold hover:opacity-95'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {hasAcknowledged
                    ? 'Acknowledged'
                    : isAckLoading
                    ? 'Recording Acknowledgment...'
                    : 'I Understand & Acknowledge'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
