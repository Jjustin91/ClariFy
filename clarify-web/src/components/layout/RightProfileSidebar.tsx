'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface UserProfile {
  name: string;
  role: string;
  id: string;
  section: string;
  avatar: string;
}

export function RightProfileSidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  const [user, setUser] = useState<UserProfile>({
    name: '',
    role: 'student',
    id: '',
    section: '',
    avatar: '',
  });

  useEffect(() => {
    const loadProfile = () => {
      const storedRole = localStorage.getItem('user_role') || 'student';
      const storedName = localStorage.getItem('user_name') || (storedRole === 'faculty' ? 'Dr. Faculty Name' : 'Student User');
      
      // Dynamic fallback defaults based on role
      const storedId = localStorage.getItem('user_id') || (storedRole === 'faculty' ? 'FAC-2024-001' : '2020202020');
      const storedSection = localStorage.getItem('user_section') || (storedRole === 'faculty' ? 'CITC' : 'IT3R5');
      const storedAvatar = localStorage.getItem('user_avatar') || (storedRole === 'faculty' 
        ? 'https://api.dicebear.com/7.x/avataaars/svg?seed=Faculty' 
        : 'https://api.dicebear.com/7.x/avataaars/svg?seed=Student');

      setUser({
        name: storedName,
        role: storedRole,
        id: storedId,
        section: storedSection,
        avatar: storedAvatar,
      });
      setMounted(true);
    };

    loadProfile();

    // Re-check profile if localStorage changes or page updates
    window.addEventListener('storage', loadProfile);
    return () => window.removeEventListener('storage', loadProfile);
  }, []);

  const handleLogout = () => {
    document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0;';
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  return (
    <aside className="w-72 bg-[#fcb315] text-slate-900 flex flex-col items-center py-6 px-5 border-l border-amber-500 shrink-0 select-none h-full overflow-y-auto">
      
      {/* Dynamic Profile Avatar & Info */}
      <div className="flex flex-col items-center mb-6 min-h-[140px] justify-center">
        {mounted ? (
          <>
            <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-slate-900 shadow-md bg-rose-200 mb-2.5">
              <img
                src={user.avatar}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            </div>
            <h3 className="text-sm font-bold text-slate-900 leading-tight text-center">{user.name}</h3>
            <p className="text-[11px] font-semibold text-slate-800">{user.id}</p>
            <p className="text-[10px] font-bold text-slate-700 uppercase">{user.section}</p>
          </>
        ) : (
          <div className="flex flex-col items-center animate-pulse space-y-2">
            <div className="h-24 w-24 rounded-full bg-slate-900/10" />
            <div className="h-4 w-28 bg-slate-900/10 rounded" />
            <div className="h-3 w-20 bg-slate-900/10 rounded" />
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="w-full space-y-1 text-center font-bold text-xs text-slate-900">
        <button
          onClick={() => (window.location.href = '/dashboard')}
          className={`w-full py-2 rounded-lg transition-colors cursor-pointer ${
            pathname === '/dashboard' || pathname === '/'
              ? 'bg-amber-500/50 text-slate-950 font-extrabold shadow-sm'
              : 'hover:bg-black/5'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => (window.location.href = '/announcements')}
          className={`w-full py-2 rounded-lg transition-colors cursor-pointer ${
            pathname?.startsWith('/announcements')
              ? 'bg-amber-500/50 text-slate-950 font-extrabold shadow-sm'
              : 'hover:bg-black/5'
          }`}
        >
          All Announcements
        </button>
        <button
          onClick={() => (window.location.href = '/faculty')}
          className={`w-full py-2 rounded-lg transition-colors cursor-pointer ${
            pathname?.startsWith('/faculty')
              ? 'bg-amber-500/50 text-slate-950 font-extrabold shadow-sm'
              : 'hover:bg-black/5'
          }`}
        >
          View Faculty
        </button>
        <button
          onClick={() => (window.location.href = '/messages')}
          className={`w-full py-2 rounded-lg transition-colors cursor-pointer ${
            pathname?.startsWith('/messages')
              ? 'bg-amber-500/50 text-slate-950 font-extrabold shadow-sm'
              : 'hover:bg-black/5'
          }`}
        >
          View Messages
        </button>
      </nav>

      {/* Settings & Logout Actions */}
      <div className="mt-auto w-full space-y-1 pt-4 text-center text-xs font-bold">
        <button
          onClick={() => (window.location.href = '/settings')}
          className={`w-full py-1.5 text-slate-900 hover:underline cursor-pointer ${
            pathname === '/settings' ? 'underline font-extrabold' : ''
          }`}
        >
          Settings
        </button>
        <button
          onClick={handleLogout}
          className="w-full py-1.5 text-red-700 hover:text-red-900 hover:underline cursor-pointer"
        >
          Logout
        </button>
      </div>

    </aside>
  );
}