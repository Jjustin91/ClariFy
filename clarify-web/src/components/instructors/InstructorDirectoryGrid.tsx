'use client';

import { useCallback, useState } from 'react';
import { useInstructors } from '@/hooks/useInstructors';
import type { InstructorFilters } from '@/types/api';
import { InstructorCard } from './InstructorCard';
import { InstructorFilter } from './InstructorFilter';

const departments = ['CITC', 'CEA', 'COT', 'CSM'];

export function InstructorDirectoryGrid() {
  const [filters, setFilters] = useState<InstructorFilters>({ sort: 'name', page: 1 });
  const updateFilters = useCallback((next: InstructorFilters) => setFilters(next), []);
  const { items, meta, isLoading, error, refetch } = useInstructors(filters);

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-ustp-navy/10 bg-white p-4 shadow-sm">
        <InstructorFilter filters={filters} onChange={updateFilters} />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading instructors">
          {departments.map((department) => (
            <div key={department} className="h-24 animate-pulse rounded-xl bg-ustp-navy/10" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{error}</span>
          <button type="button" onClick={refetch} className="rounded-lg bg-red-700 px-3 py-2 font-bold text-white">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ustp-navy/20 bg-white p-10 text-center text-sm text-ustp-text/70">
          No verified instructors match your search.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((instructor) => <InstructorCard key={instructor.id} instructor={instructor} />)}
        </div>
      )}

      {meta && meta.last_page > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Instructor directory pages">
          <button
            type="button"
            disabled={meta.current_page <= 1 || isLoading}
            onClick={() => setFilters((current) => ({ ...current, page: meta.current_page - 1 }))}
            className="rounded-lg border border-ustp-navy/20 px-3 py-2 text-sm font-semibold text-ustp-navy disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-ustp-text/70">Page {meta.current_page} of {meta.last_page}</span>
          <button
            type="button"
            disabled={meta.current_page >= meta.last_page || isLoading}
            onClick={() => setFilters((current) => ({ ...current, page: meta.current_page + 1 }))}
            className="rounded-lg border border-ustp-navy/20 px-3 py-2 text-sm font-semibold text-ustp-navy disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
