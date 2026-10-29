'use client';

import { useEffect, useState } from 'react';
import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { AnnouncementFilterBar } from '@/components/announcements/AnnouncementFilterBar';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { acknowledgeAnnouncement, deleteAnnouncement } from '@/lib/announcement-service';
import type { Announcement, AnnouncementFilters, UserRole } from '@/types/api';

export default function AnnouncementsPage() {
  const [role, setRole] = useState<UserRole>('student');
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [filters, setFilters] = useState<AnnouncementFilters>({
    search: '',
    department: '',
    tag: '',
    sort: 'latest',
  });

  const { items: announcements, meta, isLoading, error, refetch } = useAnnouncements(
    { ...filters, page },
    reloadToken
  );

  useEffect(() => {
    // Determine authenticated role from session storage / localStorage
    const storedRole = (localStorage.getItem('user_role') as UserRole) || 'student';
    setRole(storedRole);
  }, []);

  const handleAcknowledge = async (id: number) => {
    await acknowledgeAnnouncement(id);
    refetch();
  };

  const handleEdit = (announcement: Announcement) => {
    alert(`Edit modal triggered for: "${announcement.title}"`);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this announcement?')) {
      await deleteAnnouncement(id);
      setReloadToken((prev) => prev + 1);
    }
  };

  const handleCreateAnnouncement = () => {
    alert('Create Announcement modal triggered!');
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-900 font-sans overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* ONLY Render "Add Announcement" when user is authenticated as Faculty */}
            {role === 'faculty' && (
              <button
                onClick={handleCreateAnnouncement}
                className="bg-[#fcb315] hover:bg-amber-400 text-slate-950 font-extrabold text-xs px-3.5 py-2 rounded-lg shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span className="text-sm leading-none">+</span> Add Announcement
              </button>
            )}

            <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
              logo
            </div>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main className="flex-1 bg-[#FFFAF2] p-8 space-y-6 overflow-y-auto">
          
          {/* Filters */}
          <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
            <AnnouncementFilterBar
              filters={filters}
              onChange={(newFilters) => {
                setFilters(newFilters);
                setPage(1);
              }}
            />
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm border border-gray-200">
              Loading announcements...
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 p-4 text-center text-sm text-red-600 border border-red-200">
              {error}
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && announcements.length === 0 && (
            <div className="rounded-xl bg-white p-12 text-center text-gray-500 shadow-sm border border-gray-200">
              No announcements match your search or filter criteria.
            </div>
          )}

          {/* Grid */}
          {!isLoading && !error && announcements.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {announcements.map((item) => (
                <AnnouncementCard
                  key={item.id}
                  announcement={item}
                  userRole={role}
                  onAcknowledge={handleAcknowledge}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {meta && meta.total > 0 && (
            <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Showing{' '}
                <span className="text-slate-900 font-bold">
                  {(meta.current_page - 1) * meta.per_page + 1}
                </span>{' '}
                to{' '}
                <span className="text-slate-900 font-bold">
                  {Math.min(meta.current_page * meta.per_page, meta.total)}
                </span>{' '}
                of <span className="text-slate-900 font-bold">{meta.total}</span> announcements
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Previous
                </button>

                {Array.from({ length: meta.last_page }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                      page === p
                        ? 'bg-[#1a1851] text-[#fcb315]'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}

                <button
                  onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                  disabled={page === meta.last_page}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}

        </main>
      </div>

      <RightProfileSidebar />
    </div>
  );
}