'use client';

import { useState } from 'react';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';

interface Course {
  id: string;
  code: string;
  name: string;
  unreadCount: string;
  timeAgo: string;
}

interface Channel {
  id: string;
  name: string;
  type: 'announcement' | 'faq' | 'inquiry' | 'text';
}

const mockCourses: Course[] = [
  { id: '1', code: 'IT3R2-IT314', name: 'Software Engineering', unreadCount: '9+', timeAgo: '30 mins' },
  { id: '2', code: 'IT3R2-IT311', name: 'Information Assurance', unreadCount: '9+', timeAgo: '30 mins' },
  { id: '3', code: 'IT3R2-IT312', name: 'Networking 2', unreadCount: '9+', timeAgo: '30 mins' },
  { id: '4', code: 'IT3R2-IT313', name: 'Mobile Programming', unreadCount: '9+', timeAgo: '30 mins' },
  { id: '5', code: 'IT3R2-IT315', name: 'IT Elective 1', unreadCount: '9+', timeAgo: '30 mins' },
  { id: '6', code: 'IT3R2-ES211a', name: 'Technopreneurship', unreadCount: '9+', timeAgo: '30 mins' },
];

const mockChannels: Channel[] = [
  { id: 'c1', name: 'Assignment 6', type: 'text' },
  { id: 'c2', name: 'Assignment 7', type: 'text' },
  { id: 'c3', name: 'Assignment 8', type: 'text' },
  { id: 'c4', name: 'Midterm Defense', type: 'text' },
];

const mockChatMessages = [
  {
    id: 1,
    senderName: 'Faculty Name',
    senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Faculty1',
    content:
      'Please be strictly advised that all IT3R2 Software Engineering laboratory consultations and milestone presentations scheduled for this week will be held at CEA Lab 3. Make sure all API contracts are updated prior to your slot.',
    timestamp: '09/28/26 5:30pm',
    isFaculty: true,
  },
  {
    id: 2,
    senderName: 'Faculty Name',
    senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Faculty1',
    content:
      'Ensure that all pull requests opened against the main branch strictly follow our agreed Conventional Commit standards before requesting a code review.',
    timestamp: '5:30pm',
    isFaculty: true,
  },
];

export default function MessagesPage() {
  const [selectedCourse, setSelectedCourse] = useState<Course>(mockCourses[0]);
  const [selectedChannel, setSelectedChannel] = useState<string>('Assignment 6');
  const [courseSearch, setCourseSearch] = useState('');
  const [channelSearch, setChannelSearch] = useState('');

  const handleAddChannel = () => {
    alert('Add Channel modal opened');
  };

  const handleEditChannel = () => {
    alert('Edit Channel mode toggled');
  };

  const handleAnnouncementsClick = () => {
    setSelectedChannel('Announcements');
  };

  const handleSendInquiry = () => {
    alert('Send Inquiry modal opened');
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-900 overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Dark Navy App Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* 3-Pane Messaging Container */}
        <div className="flex-1 flex min-h-0">
          
          {/* 1. Slim Left Course Selector Sidebar (w-44) */}
          <aside className="w-44 bg-[#232067] flex flex-col p-2.5 border-r border-indigo-950 shrink-0">
            <input
              type="search"
              placeholder="Search....."
              value={courseSearch}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded bg-white px-2.5 py-1 text-[11px] focus:outline-none placeholder-gray-400 mb-2.5"
            />

            <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {mockCourses.map((course) => {
                const isSelected = selectedCourse.id === course.id;
                return (
                  <button
                    key={course.id}
                    onClick={() => setSelectedCourse(course)}
                    className={`w-full text-left p-2 rounded flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-amber-400 text-slate-900 shadow-sm'
                        : 'bg-white text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-1">
                      <p className="text-[10px] font-bold truncate leading-tight">{course.code}</p>
                      <p className="text-[9px] font-semibold text-gray-700 truncate">{course.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[9px] font-extrabold text-red-600 block">{course.unreadCount}</span>
                      <span className="text-[8px] text-gray-500 block">{course.timeAgo}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* 2. Channel Navigation Drawer */}
          <div className="w-48 bg-[#485396] flex flex-col p-3 border-r border-indigo-900 text-white shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xs">←</span>
              <input
                type="search"
                placeholder="Search..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                className="w-full rounded bg-white/20 px-2 py-1 text-[10px] text-white placeholder-gray-200 focus:outline-none"
              />
              {/* Edit Channel Button */}
              <button
                type="button"
                onClick={handleEditChannel}
                className="text-[8px] bg-slate-900/60 hover:bg-amber-400 px-1.5 py-1 rounded whitespace-nowrap font-bold transition-colors cursor-pointer"
              >
                Edit Channel
              </button>
            </div>

            {/* Add Channel Button */}
            <button
              type="button"
              onClick={handleAddChannel}
              className="w-full bg-[#1a1851] hover:bg-amber-400 active:scale-[0.98] text-white text-[11px] font-bold py-1.5 rounded mb-3 flex items-center justify-between px-3 transition-all cursor-pointer shadow-sm"
            >
              <span>Add Channel</span>
              <span className="text-sm">+</span>
            </button>

            {/* Categories & Channels */}
            <div className="space-y-3 flex-1 overflow-y-auto text-xs">
              
              {/* Announcements Button */}
              <button
                type="button"
                onClick={handleAnnouncementsClick}
                className={`w-full text-center text-xs font-extrabold px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  selectedChannel === 'Announcements'
                    ? 'bg-amber-400 text-slate-900 shadow'
                    : 'bg-[#1a1851] text-white hover:bg-amber-400 hover:text-slate-900'
                }`}
              >
                Announcements
              </button>

              <div className="flex items-center justify-between px-1 text-gray-200 font-bold">
                <span>FAQs</span>
                <span className="text-xs font-bold">?</span>
              </div>

              {/* Send an Inquiry Button */}
              <button
                type="button"
                onClick={handleSendInquiry}
                className="w-full bg-[#1a1851] hover:bg-amber-400 active:scale-[0.98] text-white text-[11px] font-bold py-1.5 rounded flex items-center justify-between px-3 transition-all cursor-pointer shadow-sm"
              >
                <span>Send an Inquiry</span>
                <span className="text-sm">+</span>
              </button>

              {/* Text Channels */}
              <div className="space-y-1.5 pt-1 pl-1">
                {mockChannels.map((chan) => (
                  <button
                    key={chan.id}
                    onClick={() => setSelectedChannel(chan.name)}
                    className={`w-full text-left text-[11px] font-medium block py-1 px-2 rounded transition-colors cursor-pointer ${
                      selectedChannel === chan.name
                        ? 'text-white font-bold bg-white/20'
                        : 'text-gray-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    # {chan.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Main Chat Room View */}
          <div className="flex-1 flex flex-col bg-slate-100 min-w-0">
            
            {/* Active Channel Sub-Header */}
            <header className="h-12 bg-slate-200 border-b border-gray-300 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-base font-bold text-slate-900 truncate">
                {selectedCourse.code} {selectedCourse.name} — <span className="text-indigo-900">{selectedChannel}</span>
              </h2>
              <button className="text-gray-700 hover:text-slate-900 p-1 cursor-pointer">
                ⚙️
              </button>
            </header>

            {/* Message Feed */}
            <main className="flex-1 overflow-y-auto p-6 space-y-6">
              {mockChatMessages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3 max-w-2xl">
                  <img
                    src={msg.senderAvatar}
                    alt={msg.senderName}
                    className="h-10 w-10 rounded-full bg-gray-300 border border-gray-400 shrink-0 object-cover"
                  />
                  <div className="space-y-1 flex-1">
                    {msg.senderName && (
                      <p className="text-xs font-semibold text-gray-700">{msg.senderName}</p>
                    )}
                    <div className="bg-[#1a1851] text-white p-4 rounded-2xl rounded-tl-none shadow-sm text-xs leading-relaxed">
                      {msg.content}
                    </div>
                    <p className="text-[10px] text-gray-400 pt-0.5">{msg.timestamp}</p>
                  </div>
                </div>
              ))}
            </main>

            {/* Read-Only Input Bar */}
            <footer className="p-4 bg-gray-200 border-t border-gray-300 shrink-0">
              <div className="w-full rounded-md bg-gray-300 py-3 text-center text-xs font-medium text-gray-600 border border-gray-400">
                You do not have permissions to send messages here
              </div>
            </footer>

          </div>

        </div>
      </div>

      {/* 4. Right Profile Sidebar */}
      <RightProfileSidebar />

    </div>
  );
}