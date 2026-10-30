'use client';

import { useState, useEffect, ChangeEvent } from 'react';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';

export default function SettingsPage() {
  const [role, setRole] = useState<'student' | 'faculty'>('student');
  const [userId, setUserId] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  // Saved active avatar vs. temporary staged file preview
  const [activeAvatar, setActiveAvatar] = useState<string>('');
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);

  // Student Preferences
  const [studentNotifications, setStudentNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(false);

  // Faculty Preferences
  const [officeHoursActive, setOfficeHoursActive] = useState(true);
  const [autoArchive, setAutoArchive] = useState(true);
  const [broadcastEmail, setBroadcastEmail] = useState(true);

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedRole = (localStorage.getItem('user_role') as 'student' | 'faculty') || 'student';
    const activeUserId =
      localStorage.getItem('user_id') || (storedRole === 'faculty' ? 'FAC-2024-001' : '2020202020');

    // Read stored profile avatar for specific account ID
    const accountAvatarKey = `user_avatar_${activeUserId}`;
    const storedAvatar =
      localStorage.getItem(accountAvatarKey) ||
      localStorage.getItem(`user_avatar_${storedRole}`) ||
      localStorage.getItem('user_avatar') ||
      (storedRole === 'faculty'
        ? 'https://api.dicebear.com/7.x/avataaars/svg?seed=Faculty'
        : 'https://api.dicebear.com/7.x/avataaars/svg?seed=Student');

    setRole(storedRole);
    setUserId(activeUserId);
    setActiveAvatar(storedAvatar);
    setMounted(true);
  }, []);

  // Stage selected photo in temporary memory without persisting to localStorage yet
  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const targetSize = 200;
          canvas.width = targetSize;
          canvas.height = targetSize;

          if (ctx) {
            // Square crop to prevent horizontal squishing
            const minDimension = Math.min(img.width, img.height);
            const sourceX = (img.width - minDimension) / 2;
            const sourceY = (img.height - minDimension) / 2;

            ctx.drawImage(
              img,
              sourceX,
              sourceY,
              minDimension,
              minDimension,
              0,
              0,
              targetSize,
              targetSize
            );

            const croppedBase64 = canvas.toDataURL('image/jpeg', 0.85);

            // Stage in pending avatar state ONLY
            setPendingAvatar(croppedBase64);
          }
        };
      };
      reader.readAsDataURL(file);
    }
  };

  // Persist image to localStorage and trigger sidebar update ONLY on form submit
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pendingAvatar) {
      const activeRole = localStorage.getItem('user_role') || 'student';
      const activeUserId =
        localStorage.getItem('user_id') || (activeRole === 'faculty' ? 'FAC-2024-001' : '2020202020');

      // Commit changes to state and localStorage
      setActiveAvatar(pendingAvatar);
      localStorage.setItem(`user_avatar_${activeUserId}`, pendingAvatar);
      localStorage.setItem(`user_avatar_${activeRole}`, pendingAvatar);
      localStorage.setItem('user_avatar', pendingAvatar);

      // Clear pending state
      setPendingAvatar(null);

      // Dispatch storage event so RightProfileSidebar updates across open tabs
      window.dispatchEvent(new Event('storage'));
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (!mounted) return null;

  // Render pending staged image if selected, otherwise display current saved avatar
  const displayedAvatar = pendingAvatar || activeAvatar;

  return (
    <div className="flex h-screen bg-slate-900 text-slate-900 overflow-hidden font-sans">
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Header */}
        <header className="h-16 bg-[#1a1851] text-white flex items-center justify-between px-8 border-b border-indigo-950 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">
            logo
          </div>
        </header>

        {/* Content */}
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
              
              {/* Profile Photo Uploader */}
              <div className="flex items-center gap-5 border-b border-slate-100 pb-6">
                <div className="h-20 w-20 rounded-full overflow-hidden border-2 border-slate-900 bg-rose-200 shrink-0 aspect-square flex items-center justify-center">
                  <img
                    src={displayedAvatar}
                    alt="Profile Avatar"
                    className="h-full w-full object-cover object-center rounded-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-slate-800">Profile Picture</p>
                  <label className="inline-block bg-[#1a1851] hover:bg-indigo-950 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer">
                    Upload New Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </label>
                  {pendingAvatar && (
                    <span className="ml-2 text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                      Unsaved changes
                    </span>
                  )}
                  <p className="text-[11px] text-slate-400">PNG, JPG or WebP up to 5MB</p>
                </div>
              </div>

              {/* FACULTY VIEW */}
              {role === 'faculty' ? (
                <>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Faculty ID</label>
                      <input
                        type="text"
                        disabled
                        value={userId || "FAC-2024-001"}
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
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-500 font-semibold mb-1">Student ID</label>
                      <input
                        type="text"
                        disabled
                        value={userId || "2020202020"}
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

      <RightProfileSidebar />
    </div>
  );
}