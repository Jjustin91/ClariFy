'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Search } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { AnnouncementCard } from '@/src/components/announcements/AnnouncementCard';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/src/components/ui/StateViews';
import { useClarify } from '@/src/context/ClarifyContext';
import { getAnnouncementsApi } from '@/src/lib/api-client';
import { canPublishOrManageAnnouncements } from '@/src/lib/domain-logic';
import type {
  Announcement,
  LaravelValidationError,
  PaginatedMeta,
} from '@/src/types/api';

const FILTER_TAGS = [
  'ALL',
  'URGENT NOTICE',
  'OFFICIAL MEMO',
  'CDO CAMPUS',
  'CITC',
  'CEA',
  'MEMORANDUM',
];

export default function AnnouncementsPage() {
  const { user, announcementVersion, openAnnouncementModal } = useClarify();

  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('ALL');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'read_reach'>(
    'latest'
  );
  const [page, setPage] = useState(1);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({
    current_page: 1,
    last_page: 1,
    per_page: 4,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getAnnouncementsApi({
        search,
        tag: selectedTag,
        sort: sortBy,
        page,
        per_page: 4,
      });
      setAnnouncements(res.data);
      setMeta(res.meta);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message ||
          'Failed to fetch announcements from Laravel 13 API.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [search, selectedTag, sortBy, page]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements, announcementVersion]);

  const canPublish = canPublishOrManageAnnouncements(user.role);

  return (
    <AppShell title="Announcements">
      <div className="p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
        {/* Top Controls Row matching Wireframes Pages 2, 5 & 6 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Left: Rounded "Search....." input (FR-05) */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search..... (e.g., IT314, ES211a, CEA)"
              aria-label="Search announcements by course code, keyword, or department"
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy shadow-2xs"
            />
          </div>

          {/* Right: "Sort by..." dropdown with red indicator matching Wireframes */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <label
              htmlFor="announcements-sort-select"
              className="text-xs font-bold text-ustp-text underline cursor-pointer"
            >
              Sort by...
            </label>
            <select
              id="announcements-sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'latest' | 'oldest' | 'read_reach')
              }
              className="text-xs font-semibold text-ustp-text bg-white border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-ustp-navy"
            >
              <option value="latest">Latest (Urgent Pinned First)</option>
              <option value="oldest">Oldest First</option>
              <option value="read_reach">Highest Read Reach (%)</option>
            </select>
          </div>
        </div>

        {/* Tag Filter Buttons (FR-05) */}
        <div
          className="flex items-center gap-1.5 flex-wrap"
          role="group"
          aria-label="Filter announcements by tag"
        >
          {FILTER_TAGS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setSelectedTag(tag);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {tag === 'ALL' ? 'All Tags' : tag}
              </button>
            );
          })}
        </div>

        {/* Faculty Quick-Create Trigger Bar (Strictly hidden for Students — Wireframe Page 5) */}
        {canPublish && (
          <div className="max-w-md">
            <button
              type="button"
              onClick={() => openAnnouncementModal()}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-xs text-left transition-colors cursor-pointer"
            >
              <span className="text-xs sm:text-sm text-slate-500 font-medium">
                Create Announcement
              </span>
              <span className="flex items-center gap-2 text-ustp-text">
                <FileText className="w-4 h-4" />
                <ImageIcon className="w-4 h-4" />
              </span>
            </button>
          </div>
        )}

        {/* 2x2 Announcement Card Grid (Wireframes Pages 2, 5 & 6) */}
        {isLoading ? (
          <SkeletonCards count={4} />
        ) : error ? (
          <ErrorBanner message={error} onRetry={fetchAnnouncements} />
        ) : announcements.length === 0 ? (
          <EmptyState
            title="No Announcements Match Your Filter"
            description="Try clearing your search query or selecting 'All Tags' to view all campus and department notices."
            actionLabel="Reset Filters"
            onAction={() => {
              setSearch('');
              setSelectedTag('ALL');
              setPage(1);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {announcements.map((item) => (
              <AnnouncementCard
                key={item.id}
                announcement={item}
                variant="grid"
                onUpdated={fetchAnnouncements}
              />
            ))}
          </div>
        )}

        {/* Bottom Pagination matching Wireframe (<< 1 2 ... 10 >>) */}
        <nav
          aria-label="Announcements Pagination"
          className="pt-4 flex items-center justify-center gap-2 font-mono text-xs font-bold text-ustp-text tabular-nums"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
          >
            &lt;&lt;
          </button>
          {Array.from({ length: Math.max(2, meta.last_page) }).map((_, i) => {
            const p = i + 1;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={`px-2.5 py-1 rounded border cursor-pointer ${
                  page === p
                    ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                    : 'bg-white text-ustp-text border-slate-300 hover:bg-slate-100'
                }`}
              >
                {p}
              </button>
            );
          })}
          <span className="px-1 text-slate-400">...</span>
          <button
            type="button"
            onClick={() => setPage(meta.last_page)}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer"
          >
            10
          </button>
          <button
            type="button"
            disabled={page >= meta.last_page}
            onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
          >
            &gt;&gt;
          </button>
        </nav>
      </div>
    </AppShell>
  );
}
