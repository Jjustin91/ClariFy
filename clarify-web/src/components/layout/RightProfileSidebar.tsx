'use client';

export function RightProfileSidebar() {
  return (
    <aside className="w-64 bg-amber-400 text-slate-900 flex flex-col items-center py-6 px-4 shrink-0 min-h-screen">
      {/* Avatar Container */}
      <div className="h-28 w-28 rounded-full overflow-hidden border-4 border-slate-900 bg-white mb-3 shadow-md">
        <img
          src="https://api.dicebear.com/7.x/bottts/svg?seed=Kobeni"
          alt="Kobeni Higashiyama"
          className="h-full w-full object-cover"
        />
      </div>

      {/* User Information */}
      <h2 className="font-extrabold text-base text-center leading-tight">Kobeni Higashiyama</h2>
      <p className="text-xs font-semibold text-center mt-0.5">2020202020</p>
      <p className="text-[11px] font-bold text-center text-slate-800 uppercase tracking-wider mt-0.5 mb-6">
        IT3R5
      </p>

      {/* Navigation Links */}
      <nav className="w-full space-y-1.5 flex flex-col font-bold text-xs">
        <a href="/dashboard" className="w-full py-2 hover:bg-amber-500 text-center rounded">
          Dashboard
        </a>
        <a href="/announcements" className="w-full py-2 hover:bg-amber-500 text-center rounded">
          All Announcements
        </a>
        <a href="/instructors" className="w-full py-2 hover:bg-amber-500 text-center rounded">
          View Faculty
        </a>
        <a href="/messages" className="w-full py-2 hover:bg-amber-500 text-center rounded">
          View Messages
        </a>

        {/* Spacer */}
        <div className="pt-12" />

        <a href="/settings" className="w-full py-2 text-right pr-4 hover:bg-amber-500/50 rounded">
          Settings
        </a>
        <button className="w-full py-2 text-right pr-4 text-red-900 hover:bg-amber-500/50 rounded">
          Logout
        </button>
      </nav>
    </aside>
  );
}