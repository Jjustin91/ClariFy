'use client';

import React from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

/**
 * Semantic Tag Badge matching Section 1 of the USTP Design System & Wireframes:
 * - URGENT NOTICE / MEMORANDUM: Red/Rose pill (`bg-red-100 text-red-700 border-red-300`)
 * - OFFICIAL MEMO / CDO CAMPUS: Gold/Amber pill (`bg-amber-100 text-amber-800 border-amber-300`)
 * - CITC / CEA / COT / CSM: Sky/Blue pill (`bg-sky-100 text-sky-800 border-sky-300`)
 * - Faculty: Green pill (`bg-emerald-100 text-emerald-800 border-emerald-300`)
 */
export function TagBadge({
  tag,
  size = 'sm',
}: {
  tag: string;
  size?: 'xs' | 'sm';
}) {
  const upper = tag.toUpperCase();
  let colorClass = 'bg-slate-100 text-slate-700 border-slate-300';

  if (upper.includes('URGENT') || upper.includes('MEMORANDUM')) {
    colorClass = 'bg-red-100 text-red-700 border-red-300';
  } else if (
    upper.includes('OFFICIAL MEMO') ||
    upper.includes('CDO CAMPUS') ||
    upper.includes('CAMPUS')
  ) {
    colorClass = 'bg-amber-100 text-amber-800 border-amber-300';
  } else if (
    upper === 'CITC' ||
    upper === 'CEA' ||
    upper === 'COT' ||
    upper === 'CSM' ||
    upper.includes('IT3') ||
    upper.includes('ES211')
  ) {
    colorClass = 'bg-sky-100 text-sky-800 border-sky-300';
  } else if (upper.includes('FACULTY') || upper.includes('RESOLVED')) {
    colorClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
  }

  const sizeClass =
    size === 'xs'
      ? 'px-2 py-0.5 text-[11px] font-semibold'
      : 'px-2.5 py-0.5 text-xs font-semibold';

  return (
    <span
      className={`inline-flex items-center rounded border whitespace-nowrap shrink-0 tracking-tight ${sizeClass} ${colorClass}`}
    >
      {tag}
    </span>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-4"
      aria-busy="true"
      aria-label="Loading content"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 animate-pulse"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 bg-slate-200 rounded w-2/3" />
            <div className="h-4 bg-slate-100 rounded w-16" />
          </div>
          <div className="flex gap-2">
            <div className="h-5 bg-amber-100 rounded w-20" />
            <div className="h-5 bg-sky-100 rounded w-14" />
            <div className="h-5 bg-red-100 rounded w-24" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="h-24 bg-slate-100 rounded col-span-1" />
            <div className="space-y-2 col-span-2">
              <div className="h-3.5 bg-slate-200 rounded w-full" />
              <div className="h-3.5 bg-slate-200 rounded w-11/12" />
              <div className="h-3.5 bg-slate-200 rounded w-3/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-300 text-red-900 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-900">
            Unable to complete Laravel 13 API request
          </p>
          <p className="text-xs text-red-800 mt-0.5">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-ustp-navy text-white rounded hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-gold whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry Request
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center max-w-xl mx-auto my-4">
      <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 text-ustp-navy flex items-center justify-center mx-auto mb-3">
        <Inbox className="w-5 h-5" />
      </div>
      <h3 className="text-base font-bold text-ustp-text">{title}</h3>
      <p className="text-sm text-slate-600 mt-1 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-gold cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
