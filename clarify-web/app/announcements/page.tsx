'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { canPublishCampusWideAnnouncements } from '@/src/lib/domain-logic';
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
  const router = useRouter();
  const {
    user,
    isAuthenticated,
    isAuthReady,
    announcementVersion,
    openAnnouncementModal,
  } = useClarify();

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
  const hasLoadedOnceRef = useRef(false);

  const fetchAnnouncements = useCallback(async () => {
    if (!isAuthReady || !isAuthenticated || user.role === 'it_admin') {
      return;
    }
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
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
      if (res.meta.last_page > 0 && page > res.meta.last_page) {
        setPage(res.meta.last_page);
      }
      hasLoadedOnceRef.current = true;
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message ||
          'Failed to fetch announcements from Laravel 13 API.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    search,
    selectedTag,
    sortBy,
    page,
    isAuthReady,
    isAuthenticated,
    user.role,
  ]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) {
      return;
    }
    if (user.role === 'it_admin') {
      router.replace('/admin');
      return;
    }
    fetchAnnouncements();
  }, [
    fetchAnnouncements,
    announcementVersion,
    isAuthReady,
    isAuthenticated,
    user.role,
    router,
  ]);

  if (!isAuthReady || !isAuthenticated || user.role === 'it_admin') {
    return null;
  }

  const canPublishCampusWide = canPublishCampusWideAnnouncements(user.role);

  return (
    <AppShell title="Announcements">
      <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-5 sm:space-y-6">
        {/* Top Controls Row matching Wireframes Pages 2, 5 & 6 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
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
              onChange={(e) => {
                setSortBy(
                  e.target.value as 'latest' | 'oldest' | 'read_reach'
                );
                setPage(1);
              }}
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

        {/* Department Head Quick-Create Trigger Bar for Campus-Wide Announcements */}
        {canPublishCampusWide && (
          <div className="max-w-md">
            <button
              type="button"
              onClick={() => openAnnouncementModal({ mode: 'campus_wide' })}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-xs text-left transition-colors cursor-pointer"
            >
              <span className="text-xs sm:text-sm text-slate-500 font-medium">
                Create Campus-Wide Announcement
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

        {/* Accurate Bottom Pagination driven by real meta.last_page and meta.total */}
        {(() => {
          const totalPages = Math.max(1, meta.last_page || 1);
          const currentPage = Math.min(Math.max(1, page), totalPages);

          const getPageItems = (): (number | 'ellipsis-start' | 'ellipsis-end')[] => {
            if (totalPages <= 7) {
              return Array.from({ length: totalPages }, (_, i) => i + 1);
            }
            const items: (number | 'ellipsis-start' | 'ellipsis-end')[] = [1];
            const startPage = Math.max(2, currentPage - 1);
            const endPage = Math.min(totalPages - 1, currentPage + 1);

            if (startPage > 2) {
              items.push('ellipsis-start');
            }
            for (let p = startPage; p <= endPage; p++) {
              items.push(p);
            }
            if (endPage < totalPages - 1) {
              items.push('ellipsis-end');
            }
            items.push(totalPages);
            return items;
          };

          const pageItems = getPageItems();

          return (
            <div className="mt-auto pt-6 flex flex-col items-center justify-center gap-2 w-full text-center">
              <nav
                aria-label="Announcements Pagination"
                className="flex items-center justify-center gap-2 font-mono text-xs font-bold text-ustp-text tabular-nums flex-wrap"
              >
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  &lt;&lt;
                </button>

                {pageItems.map((item) =>
                  typeof item === 'string' ? (
                    <span
                      key={item}
                      className="px-1.5 text-slate-400 select-none"
                      aria-hidden="true"
                    >
                      ...
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item)}
                      aria-current={currentPage === item ? 'page' : undefined}
                      className={`px-2.5 py-1 rounded border cursor-pointer transition-colors ${
                        currentPage === item
                          ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                          : 'bg-white text-ustp-text border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  &gt;&gt;
                </button>
              </nav>

              <p className="text-xs font-semibold text-slate-600 font-mono tabular-nums">
                Page {currentPage} of {totalPages} ({meta.total}{' '}
                {meta.total === 1 ? 'announcement' : 'announcements'})
              </p>
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}
