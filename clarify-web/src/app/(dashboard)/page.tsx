'use client';

import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';
import { mockAnnouncementList } from '@/mocks/announcements';

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-900 font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Dark Navy App Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 bg-[#FFFAF2] p-8 space-y-6 overflow-y-auto">
          
          {/* Welcome Banner */}
          <div className="w-fit rounded-2xl bg-amber-400 px-6 py-3 shadow-sm">
            <h2 className="text-xl font-bold text-white">Welcome back!</h2>
          </div>

          {/* Latest Announcements Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Latest announcements</h3>
            <a href="/announcements" className="text-xs text-gray-500 underline hover:text-ustp-navy">
              See all
            </a>
          </div>

          {/* 2-Column Announcement Grid (Preview) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mockAnnouncementList.slice(0, 2).map((item) => (
              <AnnouncementCard
                key={item.id}
                announcement={item}
                userRole="student"
              />
            ))}
          </div>

          {/* Latest Messages Section */}
          <div className="space-y-3 pt-4">
            <h3 className="text-sm font-bold text-gray-700">Latest Messages</h3>
            
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-white p-4 border border-gray-200 shadow-sm">
                  <div>
                    <h4 className="text-xs font-bold text-gray-800">IT3R2-IT314 Software Engineering</h4>
                    <p className="text-[11px] text-gray-400">Name Name: blah blah blah blah...</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 flex items-center gap-1 justify-end">
                      💬 chats
                    </span>
                    <span className="text-[10px] text-gray-400">{i * 15} mins</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </main>
      </div>

      {/* Right Sidebar */}
      <RightProfileSidebar />
    </div>
  );
}