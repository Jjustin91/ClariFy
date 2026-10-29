'use client';

import { useState, useEffect } from 'react';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';

export default function SettingsPage() {
  const [role, setRole] = useState<'student' | 'faculty'>('student');
  const [mounted, setMounted] = useState(false);

  // Student Settings State
  const [studentNotifications, setStudentNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(false);

  // Faculty Settings State
  const [officeHoursActive, setOfficeHoursActive] = useState(true);
  const [autoArchive, setAutoArchive] = useState(true);
  const [broadcastEmail, setBroadcastEmail] = useState(true);

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedRole = (localStorage.getItem('user_role') as 'student' | 'faculty') || 'student';
    setRole(storedRole);
    setMounted(true);
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-slate-900 text-slate-900 overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top App Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* Settings Body */}
        <main className="flex-1 bg-[#FFFAF2] p-8 overflow-y-auto space-y-6">
          <div className="max-w-2xl bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
            
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              {role === 'faculty' ? 'Faculty Portal Preferences' : 'Account Preferences'}
            </h2>

            {saved && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-3 rounded-lg font-semibold">
                Settings saved successfully!
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-6">
              
              {/* FACULTY VIEW */}
              {role === 'faculty' ? (
                <>
                  {/* Faculty Overview */}
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Faculty ID</label>
                      <input
                        type="text"
                        disabled
                        value="FAC-2024-001"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Department</label>
                      <input
                        type="text"
                        disabled
                        value="CITC / IT Department"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-medium"
                      />
                    </div>
                  </div>

                  {/* Faculty Toggles */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-800">Office Hours & Consultation Status</p>
                        <p className="text-[11px] text-slate-500">Show online availability status for student inquiries</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={officeHoursActive}
                        onChange={(e) => setOfficeHoursActive(e.target.checked)}
                        className="h-4 w-4 accent-[#1a1851] cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-800">Broadcast Announcements via Email</p>
                        <p className="text-[11px] text-slate-500">Automatically copy channel announcements to enrolled students' emails</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={broadcastEmail}
                        onChange={(e) => setBroadcastEmail(e.target.checked)}
                        className="h-4 w-4 accent-[#1a1851] cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-800">End-of-Term Channel Archiving</p>
                        <p className="text-[11px] text-slate-500">Auto-archive course sub-channels after final grade submission</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoArchive}
                        onChange={(e) => setAutoArchive(e.target.checked)}
                        className="h-4 w-4 accent-[#1a1851] cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* STUDENT VIEW */
                <>
                  {/* Student Overview */}
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Student ID</label>
                      <input
                        type="text"
                        disabled
                        value="2020202020"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Section</label>
                      <input
                        type="text"
                        disabled
                        value="IT3R5"
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-medium"
                      />
                    </div>
                  </div>

                  {/* Student Toggles */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-800">In-App Announcement Alerts</p>
                        <p className="text-[11px] text-slate-500">Receive desktop notifications for channel messages</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={studentNotifications}
                        onChange={(e) => setStudentNotifications(e.target.checked)}
                        className="h-4 w-4 accent-[#1a1851] cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-800">Email Digest</p>
                        <p className="text-[11px] text-slate-500">Send daily summary of missed faculty announcements</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={emailAlerts}
                        onChange={(e) => setEmailAlerts(e.target.checked)}
                        className="h-4 w-4 accent-[#1a1851] cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                className="bg-[#1a1851] hover:bg-indigo-950 text-white font-bold text-xs px-5 py-2.5 rounded-lg transition-colors cursor-pointer"
              >
                Save Changes
              </button>
            </form>

          </div>
        </main>

      </div>

      {/* Right Profile Sidebar */}
      <RightProfileSidebar />
    </div>
  );
}