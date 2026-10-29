import type { InstructorDirectoryEntry } from '@/types/api';

interface InstructorCardProps {
  instructor: InstructorDirectoryEntry;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

export function InstructorCard({ instructor }: InstructorCardProps) {
  return (
    <article className="flex items-center gap-4 rounded-xl border border-ustp-navy/10 bg-white p-4 shadow-sm">
      <div
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ustp-navy text-sm font-bold text-white"
      >
        {initials(instructor.name)}
      </div>
      <div className="min-w-0">
        <h2 className="font-bold text-ustp-text">{instructor.name}</h2>
        <p className="mt-1 text-sm text-ustp-text/70">{instructor.campus}</p>
        <span className="mt-2 inline-flex rounded-full bg-ustp-blue/10 px-2.5 py-1 text-xs font-bold text-ustp-blue">
          {instructor.department}
        </span>
      </div>
    </article>
  );
}
