'use client';

import type { QaThread, ThreadStatus, UserRole } from '@/types/api';
import { QaThreadCard } from './QaThreadCard';

interface QaThreadListProps {
  threads: QaThread[];
  status: ThreadStatus | undefined;
  userRole: UserRole;
  currentUserId: number;
  selectedThreadId: number | null;
  onStatusChange: (status: ThreadStatus | undefined) => void;
  onSelect: (thread: QaThread) => void;
  onEdit: (id: number, content: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const filters: { label: string; value: ThreadStatus | undefined }[] = [
  { label: 'All inquiries', value: undefined },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
];

export function QaThreadList({
  threads,
  status,
  userRole,
  currentUserId,
  selectedThreadId,
  onStatusChange,
  onSelect,
  onEdit,
  onDelete,
}: QaThreadListProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" aria-label="Filter inquiries">
        {filters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            aria-pressed={status === filter.value}
            onClick={() => onStatusChange(filter.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              status === filter.value
                ? 'bg-ustp-navy text-white'
                : 'border border-ustp-navy/20 bg-white text-ustp-navy hover:bg-ustp-cream'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {threads.map((thread) => (
          <QaThreadCard
            key={`${thread.id}-${thread.updated_at}`}
            thread={thread}
            userRole={userRole}
            currentUserId={currentUserId}
            selected={selectedThreadId === thread.id}
            onSelect={() => onSelect(thread)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
