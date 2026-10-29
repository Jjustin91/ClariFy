'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import {
  EmptyState,
  ErrorBanner,
  TagBadge,
} from '@/src/components/ui/StateViews';
import { useClarify } from '@/src/context/ClarifyContext';
import { getInstructorsApi } from '@/src/lib/api-client';
import type {
  Instructor,
  LaravelValidationError,
  PaginatedMeta,
} from '@/src/types/api';

const DEPARTMENTS = ['ALL', 'CITC', 'CEA', 'COT', 'CSM'] as const;

export default function InstructorsPage() {
  const { announcementVersion, showToast } = useClarify();

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'department'>('name');
  const [page, setPage] = useState(1);

  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta>({
    current_page: 1,
    last_page: 1,
    per_page: 12,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInstructor, setSelectedInstructor] =
    useState<Instructor | null>(null);

  const loadInstructors = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getInstructorsApi({
        search,
        department,
        sort: sortBy,
        page,
        per_page: 12,
      });
      setInstructors(res.data);
      setMeta(res.meta);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message || 'Unable to load Verified Faculty Directory.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [search, department, sortBy, page]);

  useEffect(() => {
    loadInstructors();
  }, [loadInstructors, announcementVersion]);

  return (
    <AppShell title="View Instructors">
      <div className="p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
        {/* Top Bar matching Wireframes Pages 3 & 6 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search....."
              aria-label="Search verified instructors by name, course, or specialization"
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl text-ustp-text placeholder:text-slate-400 focus:outline-none focus:border-ustp-navy"
            />
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <label
              htmlFor="instructor-sort-select"
              className="text-xs font-bold text-ustp-text underline"
            >
              Sort by...
            </label>
            <select
              id="instructor-sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'name' | 'department')
              }
              className="text-xs font-semibold text-ustp-text bg-white border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-ustp-navy"
            >
              <option value="name">Name (A–Z)</option>
              <option value="department">Department (CITC / CEA / COT / CSM)</option>
            </select>
          </div>
        </div>

        {/* Department Filter Pills */}
        <div
          className="flex items-center gap-1.5 flex-wrap"
          role="group"
          aria-label="Filter instructors by department"
        >
          {DEPARTMENTS.map((dept) => {
            const active = department === dept;
            return (
              <button
                key={dept}
                type="button"
                onClick={() => {
                  setDepartment(dept);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-ustp-navy text-ustp-gold border-ustp-navy'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {dept === 'ALL' ? 'All Colleges / Depts' : dept}
              </button>
            );
          })}
        </div>

        {/* Selected Instructor Consultation Details Bar */}
        {selectedInstructor && (
          <div className="bg-white border-2 border-ustp-navy rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-ustp-navy">
                  {selectedInstructor.name}
                </h3>
                <TagBadge tag={selectedInstructor.campus} size="xs" />
                <TagBadge tag={selectedInstructor.department} size="xs" />
              </div>
              <p className="text-xs text-slate-600 mt-1">
                {selectedInstructor.specialization} • Office:{' '}
                <span className="font-semibold text-ustp-text">
                  {selectedInstructor.office_location}
                </span>{' '}
                • Consultation:{' '}
                <span className="font-mono font-semibold text-ustp-navy">
                  {selectedInstructor.consultation_hours}
                </span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Courses Handled: {selectedInstructor.courses_handled.join(', ')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  showToast(
                    `Copied ${selectedInstructor.email} to clipboard.`,
                    'info'
                  );
                }}
                className="px-3 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded cursor-pointer"
              >
                {selectedInstructor.email}
              </button>
              <button
                type="button"
                onClick={() => setSelectedInstructor(null)}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-ustp-text cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* 6-Column Responsive Grid of Verified Faculty Cards matching Wireframes Pages 3 & 6 */}
        {isLoading ? (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
            aria-busy="true"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="bg-white border border-slate-200 rounded-xl p-4 h-44 animate-pulse flex flex-col items-center justify-between"
              >
                <div className="w-20 h-20 rounded-full bg-slate-200" />
                <div className="w-full space-y-1.5">
                  <div className="h-3 bg-slate-200 rounded w-3/4" />
                  <div className="flex gap-1">
                    <div className="h-3.5 bg-amber-100 rounded w-12" />
                    <div className="h-3.5 bg-sky-100 rounded w-10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadInstructors} />
        ) : instructors.length === 0 ? (
          <EmptyState
            title="No Verified Instructors Found"
            description="No faculty directory entries match your current search or department filter."
            actionLabel="Show All Instructors"
            onAction={() => {
              setSearch('');
              setDepartment('ALL');
            }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {instructors.map((inst) => {
              const initials = inst.name
                .replace(/^(ENGR\.|PROF\.|DR\.)\s*/i, '')
                .split(' ')
                .slice(0, 2)
                .map((n) => n.charAt(0))
                .join('');

              return (
                <button
                  key={inst.id}
                  type="button"
                  onClick={() => setSelectedInstructor(inst)}
                  className="bg-white border border-slate-200/90 hover:border-ustp-navy rounded-xl p-3.5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  {/* Centered Circular Instructor Avatar */}
                  <div className="w-20 h-20 mx-auto my-2 rounded-full bg-ustp-navy text-ustp-gold border-2 border-ustp-gold flex items-center justify-center text-lg font-extrabold tracking-tight group-hover:scale-105 transition-transform">
                    {initials}
                  </div>

                  {/* Bottom-Left Uppercase NAME + Two Pill Badges underneath (Gold CDO Campus + Dept Badge) */}
                  <div className="mt-2 w-full">
                    <p className="text-[11px] font-extrabold text-ustp-text uppercase truncate">
                      {inst.name}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate mb-1.5">
                      {inst.consultation_hours}
                    </p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-ustp-gold text-ustp-navy whitespace-nowrap">
                        {inst.campus}
                      </span>
                      <TagBadge tag={inst.department} size="xs" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Bottom Pagination matching Wireframes (<< 1 2 ... 10 >>) */}
        <nav
          aria-label="Instructor Directory Pagination"
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
          <button
            type="button"
            onClick={() => setPage(1)}
            className="px-2.5 py-1 rounded border bg-ustp-navy text-ustp-gold border-ustp-navy cursor-pointer"
          >
            1
          </button>
          <button
            type="button"
            onClick={() => setPage(1)}
            className="px-2.5 py-1 rounded border bg-white text-ustp-text border-slate-300 hover:bg-slate-100 cursor-pointer"
          >
            2
          </button>
          <span className="px-1 text-slate-400">...</span>
          <button
            type="button"
            onClick={() => setPage(1)}
            className="px-2.5 py-1 rounded border bg-white text-ustp-text border-slate-300 hover:bg-slate-100 cursor-pointer"
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
