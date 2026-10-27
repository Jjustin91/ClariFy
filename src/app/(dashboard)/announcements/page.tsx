'use client';
import { useState } from 'react';
import { AnnouncementFilterBar } from '@/components/announcements/AnnouncementFilterBar';
import { AnnouncementFormModal } from '@/components/announcements/AnnouncementFormModal';
import { NoticeboardFeed } from '@/components/announcements/NoticeboardFeed';
import type { Announcement, AnnouncementFilters, UserRole } from '@/types/api';



// TODO: replace both with real data from FE-1 (useAuthSession and GET /channels)
const userRole: UserRole = 'faculty'; // try 'student' to check the read-only view
const CHANNEL_OPTIONS = [
  { id: 7, name: '#IT314 SoftEng' },
  { id: 8, name: '#ES211a' },
];

export default function AnnouncementsPage() {
  const [filters, setFilters] = useState<AnnouncementFilters>({ sort: 'latest', page: 1 });
  const [reloadToken, setReloadToken] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);

  const canPublish = userRole !== 'student'; // students never see create/edit/delete (FR-04_REV)

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  return (
    <main className="min-h-screen bg-ustp-cream p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-ustp-navy">Noticeboard</h1>
          {canPublish && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded bg-ustp-navy px-4 py-2 text-sm font-semibold text-white"
            >
              + New Announcement
            </button>
          )}
        </div>

        <AnnouncementFilterBar filters={filters} onChange={setFilters} />

        <NoticeboardFeed
          filters={filters}
          userRole={userRole}
          reloadToken={reloadToken}
          onEdit={(a) => {
            setEditing(a);
            setModalOpen(true);
          }}
          onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
        />
      </div>

      {modalOpen && (
        <AnnouncementFormModal
          key={editing?.id ?? 'new'}
          announcement={editing}
          channels={CHANNEL_OPTIONS}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            setReloadToken((t) => t + 1);
          }}
        />
      )}
    </main>
  );
}