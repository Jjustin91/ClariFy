'use client';
import { useState } from 'react';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { acknowledgeAnnouncement, deleteAnnouncement } from '@/lib/announcement-service';
import { AnnouncementCard } from './AnnouncementCard';
import { FeedEmptyState, FeedErrorBanner, FeedSkeleton } from './FeedStates';
import { Pagination } from './Pagination';
import type { Announcement, AnnouncementFilters, UserRole } from '@/types/api';

interface NoticeboardFeedProps {
  filters: AnnouncementFilters;
  userRole: UserRole;
  reloadToken?: number;
  onEdit: (announcement: Announcement) => void;
  onPageChange: (page: number) => void;
}

export function NoticeboardFeed({ filters, userRole, reloadToken = 0, onEdit, onPageChange }: NoticeboardFeedProps) {
  const { items, meta, isLoading, error, refetch } = useAnnouncements(filters, reloadToken);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) return <FeedSkeleton />;
  if (error) return <FeedErrorBanner message={error} onRetry={refetch} />;
  if (items.length === 0) {
    return <FeedEmptyState message="No announcements match your filter tags" />;
  }

  // Pinned/urgent first. Array.sort is stable, so the server's chronological order is kept inside each group.
  const sorted = [...items].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned));

  const handleAcknowledge = async (id: number) => {
    await acknowledgeAnnouncement(id); // the card shows the error if this throws
    await refetch();
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this announcement?')) return;
    setActionError(null);
    try {
      await deleteAnnouncement(id);
      await refetch();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setActionError(
        status === 403
          ? 'Access Denied: Only authorized faculty assigned to this Course Hub can delete announcements.'
          : e instanceof Error
          ? e.message
          : 'Could not delete the announcement.'
      );
    }
  };

  return (
    <section className="space-y-4">
      {actionError && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {sorted.map((a) => (
        <AnnouncementCard
          key={a.id}
          announcement={a}
          userRole={userRole}
          onAcknowledge={handleAcknowledge}
          onEdit={onEdit}
          onDelete={handleDelete}
        />
      ))}
      {meta && <Pagination currentPage={meta.current_page} lastPage={meta.last_page} onPageChange={onPageChange} />}
    </section>
  );
}