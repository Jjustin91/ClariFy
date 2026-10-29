'use client';

import { useEffect, useState } from 'react';
import type { InstructorFilters } from '@/types/api';

interface InstructorFilterProps {
  filters: InstructorFilters;
  onChange: (filters: InstructorFilters) => void;
}

const departments = ['CITC', 'CEA', 'COT', 'CSM'];

export function InstructorFilter({ filters, onChange }: InstructorFilterProps) {
  const [search, setSearch] = useState(filters.search ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== (filters.search ?? '')) {
        onChange({ ...filters, search: search || undefined, page: 1 });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, onChange, search]);

  const fieldClass =
    'rounded-lg border border-ustp-navy/20 bg-white px-3 py-2 text-sm text-ustp-text focus:outline-none focus:ring-2 focus:ring-ustp-gold';

  return (
    <div className="flex flex-wrap gap-3">
      <label className="sr-only" htmlFor="instructor-search">Search instructors</label>
      <input
        id="instructor-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name or campus"
        className={`${fieldClass} min-w-56 flex-1`}
      />
      <label className="sr-only" htmlFor="instructor-department">Filter by department</label>
      <select
        id="instructor-department"
        value={filters.department ?? ''}
        onChange={(event) => onChange({ ...filters, department: event.target.value || undefined, page: 1 })}
        className={fieldClass}
      >
        <option value="">All departments</option>
        {departments.map((department) => (
          <option key={department} value={department}>{department}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="instructor-sort">Sort instructors</label>
      <select
        id="instructor-sort"
        value={filters.sort ?? 'name'}
        onChange={() => onChange({ ...filters, sort: 'name', page: 1 })}
        className={fieldClass}
      >
        <option value="name">Name A–Z</option>
      </select>
    </div>
  );
}
