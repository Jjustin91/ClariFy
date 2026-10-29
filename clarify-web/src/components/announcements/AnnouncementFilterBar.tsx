'use client';
import { useEffect, useState } from 'react';
import type { AnnouncementFilters } from '@/types/api';

export const TAG_OPTIONS = ['URGENT NOTICE', 'OFFICIAL MEMO', 'CDO CAMPUS', 'MEMORANDUM'];
export const DEPARTMENT_OPTIONS = ['CITC', 'CEA', 'COT', 'CSM'];

interface FilterBarProps {
  filters: AnnouncementFilters;
  onChange: (next: AnnouncementFilters) => void;
}

export function AnnouncementFilterBar({ filters, onChange }: FilterBarProps) {
  const [search, setSearch] = useState(filters.search ?? '');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== (filters.search ?? '')) {
        onChange({ ...filters, search: search || undefined, page: 1 });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Slim input styles (reduced padding to py-1.5 and text to text-xs)
  const field = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-ustp-text focus:outline-none focus:ring-1 focus:ring-ustp-navy';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search course code or keyword (e.g. ES211a)"
        className={`${field} min-w-48 flex-1`}
        aria-label="Search announcements"
      />
      <select
        className={field}
        aria-label="Filter by department"
        value={filters.department ?? ''}
        onChange={(e) => onChange({ ...filters, department: e.target.value || undefined, page: 1 })}
      >
        <option value="">All departments</option>
        {DEPARTMENT_OPTIONS.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select
        className={field}
        aria-label="Filter by tag"
        value={filters.tag ?? ''}
        onChange={(e) => onChange({ ...filters, tag: e.target.value || undefined, page: 1 })}
      >
        <option value="">All tags</option>
        {TAG_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select
        className={field}
        aria-label="Sort announcements"
        value={filters.sort ?? 'latest'}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as 'latest' | 'oldest', page: 1 })}
      >
        <option value="latest">Latest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </div>
  );
}