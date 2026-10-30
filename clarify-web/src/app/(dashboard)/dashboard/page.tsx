'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';
import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import type { UserRole } from '@/types/api';

export default function DashboardPage() {
  const [userRole, setUserRole] = useState<UserRole>('student');
  const { items, isLoading, error } = useAnnouncements({ sort: 'latest' });

  useEffect(() => {
    const role = (localStorage.getItem('user_role') as UserRole) || 'student';
    setUserRole(role);
  }, []);

  // Display top 2 latest announcements on the main dashboard
  const latestAnnouncements = items.slice(0, 2);

  return (
    <div className="flex h-screen bg-slate-900 text-slate-900 overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 bg-[#FFFAF2] p-8 overflow-y-auto space-y-6">
          
          <div>
            <span className="inline-block bg-[#fcb315] text-slate-900 font-extrabold px-6 py-2.5 rounded-2xl text-lg shadow-sm">
              Welcome back!
            </span>
          </div>

          <div className="flex items-center justify-between pt-2">
            <h2 className="text-sm font-bold text-slate-800">Latest announcements</h2>
            <Link href="/announcements" className="text-xs font-semibold text-slate-500 hover:underline">
              See all
            </Link>
          </div>

          {/* Grid using AnnouncementCard */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isLoading ? (
              <div className="col-span-2 text-center py-12 text-xs font-semibold text-slate-400">
                Loading announcements...
              </div>
            ) : error ? (
              <div className="col-span-2 text-center py-12 text-xs font-semibold text-red-500">
                {error}
              </div>
            ) : latestAnnouncements.length > 0 ? (
              latestAnnouncements.map((announcement) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  userRole={userRole}
                />
              ))
            ) : (
              <div className="col-span-2 text-center py-12 text-xs font-semibold text-slate-400 bg-white rounded-2xl border border-slate-200">
                No announcements available.
              </div>
            )}
          </div>

          <div className="pt-4">
            <h2 className="text-sm font-bold text-slate-800">Latest Messages</h2>
          </div>
          <div className="col-span-2 text-center py-12 text-xs font-semibold text-slate-400 bg-white rounded-2xl border border-slate-200">
                No messages available.
              </div>
        </main>

      </div>

      <RightProfileSidebar />
    </div>
  );
}