'use client';

import { useState } from 'react';
import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { AnnouncementFilterBar } from '@/components/announcements/AnnouncementFilterBar';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { acknowledgeAnnouncement, deleteAnnouncement } from '@/lib/announcement-service';
import type { Announcement, AnnouncementFilters, UserRole } from '@/types/api';

export default function StudentAnnouncementsPage() {
  const [role, setRole] = useState<UserRole>('student');
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  // Full Filters State (Search, Department, Tag, Sort, Page)
  const [filters, setFilters] = useState<AnnouncementFilters>({
    search: '',
    department: '',
    tag: '',
    sort: 'latest',
  });

  // Fetch announcements (using filters + current page)
  const { items: announcements, meta, isLoading, error, refetch } = useAnnouncements(
    { ...filters, page },
    reloadToken
  );

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

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-900 font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Dark Navy App Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
            
            {/* Demo Role Switcher Pill */}
            <div className="flex items-center gap-1 rounded-md bg-white/10 p-1 text-xs">
              <button
                type="button"
                onClick={() => setRole('student')}
                className={`rounded px-2.5 py-1 font-bold transition-colors ${
                  role === 'student' ? 'bg-amber-400 text-slate-900' : 'text-gray-300 hover:text-white'
                }`}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => setRole('faculty')}
                className={`rounded px-2.5 py-1 font-bold transition-colors ${
                  role === 'faculty' ? 'bg-amber-400 text-slate-900' : 'text-gray-300 hover:text-white'
                }`}
              >
                Faculty
              </button>
            </div>
          </div>

          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 bg-[#FFFAF2] p-8 space-y-6 overflow-y-auto">
          
          {/* Full Filter Bar (Search, Department, Tag, Sort) */}
          <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
            <AnnouncementFilterBar
              filters={filters}
              onChange={(newFilters) => {
                setFilters(newFilters);
                setPage(1); // Reset to page 1 on filter change
              }}
            />
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm border border-gray-200">
              Loading announcements...
            </div>
          )}

          {/* Error State */}
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

          {/* 6-Card Announcement Grid (2 Columns x 3 Rows on Desktop) */}
          {!isLoading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {announcements.slice(0, 6).map((item) => (
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

          {/* Dynamic Pagination Controls */}
          {meta && meta.last_page > 1 && (
            <div className="pt-4 flex justify-center items-center gap-2 text-xs font-bold text-gray-500">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="hover:text-ustp-navy disabled:opacity-30"
              >
                {'<<'}
              </button>
              
              {Array.from({ length: meta.last_page }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-2 py-1 rounded ${
                    page === p ? 'bg-ustp-navy text-white font-bold' : 'hover:text-ustp-navy'
                  }`}
                >
                  {p}
                </button>
              ))}

              <button
                onClick={() => setPage(meta.last_page)}
                disabled={page === meta.last_page}
                className="hover:text-ustp-navy disabled:opacity-30"
              >
                {'>>'}
              </button>
            </div>
          )}

        </main>
      </div>

      {/* Right Sidebar */}
      <RightProfileSidebar />
    </div>
  );
}