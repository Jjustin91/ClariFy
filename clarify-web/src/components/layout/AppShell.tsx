'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  LogOut,
  Settings,
  X,
} from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { logoutApi } from '../../lib/api-client';
import { AnnouncementFormModal } from '../modals/AnnouncementFormModal';
import { ProfileSettingsModal } from '../modals/ProfileSettingsModal';
import { ChannelRosterModal } from '../modals/ChannelRosterModal';

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    switchRole,
    useMock,
    toggleApiMode,
    isDrawerOpen,
    setIsDrawerOpen,
    setIsSettingsModalOpen,
    setIsChannelModalOpen,
    toasts,
    dismissToast,
    showToast,
  } = useClarify();

  const handleLogout = async () => {
    await logoutApi();
    showToast('Signed out of ClariFy session.', 'info');
    router.push('/login');
  };

  const navItems = [
    { label: 'Dashboard', href: '/', active: pathname === '/' },
    {
      label: 'All Announcements',
      href: '/announcements',
      active: pathname.startsWith('/announcements'),
    },
    {
      label: 'View Faculty',
      href: '/instructors',
      active: pathname.startsWith('/instructors'),
    },
    {
      label: 'View Messages',
      href: '/channels/7',
      active: pathname.startsWith('/channels'),
    },
  ];

  const isRoleStudent = user.role === 'student';
  const isRoleFaculty = user.role === 'faculty' || user.role === 'dept_head';
  const isRoleAdmin = user.role === 'it_admin';

  const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
  const idDisplay =
    user.role === 'faculty'
      ? `Faculty ID: ${user.institutional_id}`
      : user.role === 'it_admin'
      ? `ICTO Admin: ${user.institutional_id}`
      : user.institutional_id;

  const scopeSubtext =
    user.role === 'student'
      ? `${user.academic_profile?.section || 'IT3R2'} • ${
          user.academic_profile?.department || 'CITC'
        } 3rd Year`
      : `${user.academic_profile?.department || 'CITC'} Dept`;

  return (
    <div className="min-h-screen flex flex-col bg-ustp-cream text-ustp-text">
      {/* Persistent Top Header Bar (ustp-navy #1a1851) matching MVP Screenshots & Wireframes */}
      <header className="h-14 bg-ustp-navy text-white px-4 lg:px-6 flex items-center justify-between gap-4 border-b border-slate-800 shrink-0 z-30">
        {/* Left: ClariFy in bold ustp-gold + active view/hub title in white */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="text-xl font-extrabold tracking-tight text-ustp-gold hover:opacity-95 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-ustp-gold rounded"
          >
            ClariFy
          </Link>
          <span className="text-slate-400 select-none" aria-hidden="true">
            |
          </span>
          <h1 className="text-sm sm:text-base font-bold text-white truncate">
            {title}
          </h1>
        </div>

        {/* Right: Live API Mode Switcher + Role Switcher Pills (Student View (Kobeni), Faculty View (Aki), IT Admin View) + USTP Logo Badge */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* API Mode Toggle (Mock Seed vs Live Laravel 13 API) */}
          <button
            type="button"
            onClick={() => toggleApiMode()}
            aria-label="Toggle between Pre-Seeded Mock Data and Live Laravel 13 API"
            className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              useMock
                ? 'bg-white/10 text-amber-200 border-white/20 hover:bg-white/15'
                : 'bg-emerald-900/80 text-emerald-200 border-emerald-500/50'
            }`}
          >
            <Database className="w-3 h-3" />
            <span>{useMock ? 'API: Mock Seed' : 'API: Laravel :8000'}</span>
          </button>

          {/* Role Switcher Pills matching Oct 22 MVP screenshot */}
          <div
            className="flex items-center bg-white/10 p-0.5 rounded border border-white/15"
            role="group"
            aria-label="Demo Role Switcher"
          >
            <button
              type="button"
              onClick={() => switchRole('student')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRoleStudent
                  ? 'bg-ustp-gold text-ustp-navy'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Student View (Kobeni)
            </button>
            <button
              type="button"
              onClick={() => switchRole('faculty')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRoleFaculty
                  ? 'bg-ustp-gold text-ustp-navy'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              Faculty View (Aki)
            </button>
            <button
              type="button"
              onClick={() => switchRole('it_admin')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRoleAdmin
                  ? 'bg-ustp-gold text-ustp-navy'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              IT Admin View
            </button>
          </div>

          {/* USTP Logo Badge matching Wireframes top-right "logo" box */}
          <Link
            href="/login"
            title="Universal Login Screen"
            className="hidden sm:flex items-center justify-center px-2.5 py-1 bg-white text-ustp-navy font-extrabold text-xs rounded border border-ustp-gold tracking-tight whitespace-nowrap shrink-0 hover:bg-ustp-cream"
          >
            USTP
          </Link>
        </div>
      </header>

      {/* Main Content + Right-Hand Collapsible Orange Profile & Navigation Drawer */}
      <div className="flex-1 flex relative overflow-x-hidden">
        {/* Main Center Workspace */}
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>

        {/* Collapsed Drawer Re-Open Tab when Drawer is closed */}
        {!isDrawerOpen && (
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Expand profile and navigation drawer"
            className="fixed right-0 top-16 z-30 bg-ustp-orange hover:bg-ustp-orange-dark text-ustp-navy font-bold p-2.5 rounded-l-lg border-l border-y border-amber-700/40 shadow-md flex items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-xs font-extrabold hidden sm:inline">Menu</span>
          </button>
        )}

        {/* Right-Hand Collapsible Profile & Navigation Drawer (ustp-orange #ff9718 — Wireframes pp. 2–9) */}
        <aside
          aria-label="User Profile and Navigation Drawer"
          className={`bg-ustp-orange text-ustp-text border-l border-amber-600/40 shrink-0 flex flex-col justify-between transition-transform duration-200 ease-out ${
            isDrawerOpen
              ? 'w-60 sm:w-64 translate-x-0'
              : 'w-0 translate-x-full overflow-hidden border-l-0'
          }`}
        >
          <div>
            {/* Top-left Chevron Toggle Button matching Wireframes pp. 3–8 */}
            <div className="p-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Collapse profile drawer"
                className="p-1 rounded hover:bg-ustp-orange-dark/40 text-ustp-navy focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
              >
                <ChevronRight className="w-5 h-5 stroke-[2.5]" />
              </button>
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-ustp-navy/80 pr-1">
                {user.role.replace('_', ' ')}
              </span>
            </div>

            {/* Top Profile Header: Circular Avatar with gold/red ring, Name, Institutional ID, Scope */}
            <div className="px-4 pb-5 pt-1 text-center border-b border-amber-700/30">
              <div className="w-20 h-20 mx-auto rounded-full bg-white border-4 border-red-600 ring-2 ring-ustp-gold flex items-center justify-center text-2xl font-extrabold text-ustp-navy select-none">
                {avatarInitial}
              </div>
              <h2 className="mt-2.5 text-base font-extrabold text-ustp-text leading-snug">
                {user.name}
              </h2>
              <p className="text-xs font-mono font-bold tabular-nums text-ustp-text/90 mt-0.5">
                {idDisplay}
              </p>
              <p className="text-xs font-semibold text-ustp-navy mt-0.5">
                {scopeSubtext}
              </p>
            </div>

            {/* Vertical Navigation Stack (Full-width bordered rows, active item in deeper orange #ff6418) */}
            <nav aria-label="Primary Navigation" className="divide-y divide-amber-700/30 border-b border-amber-700/30">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block w-full px-5 py-3 text-right text-sm font-bold transition-colors ${
                    item.active
                      ? 'bg-ustp-orange-dark text-ustp-text font-extrabold'
                      : 'hover:bg-ustp-orange-dark/50 text-ustp-text'
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {/* Replaces first wireframe "idk +" placeholder -> Channel Management (Workflow 5) */}
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(true)}
                className="w-full px-5 py-3 text-right text-sm font-bold hover:bg-ustp-orange-dark/50 text-ustp-text transition-colors cursor-pointer"
              >
                Channel Management +
              </button>

              {/* Replaces second wireframe "idk +" placeholder -> Admin Console (visible when role === 'it_admin') */}
              {user.role === 'it_admin' && (
                <Link
                  href="/admin"
                  className={`block w-full px-5 py-3 text-right text-sm font-bold transition-colors ${
                    pathname.startsWith('/admin')
                      ? 'bg-ustp-orange-dark text-ustp-text font-extrabold'
                      : 'hover:bg-ustp-orange-dark/50 text-ustp-text'
                  }`}
                >
                  Admin Console +
                </Link>
              )}
            </nav>
          </div>

          {/* Bottom Pinned Links: Settings (FR-06) & Logout */}
          <div className="p-4 space-y-2 border-t border-amber-700/30">
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(true)}
              className="w-full flex items-center justify-end gap-2 px-2 py-1.5 text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-end gap-2 px-2 py-1.5 text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Global Modals */}
      <AnnouncementFormModal />
      <ProfileSettingsModal />
      <ChannelRosterModal />

      {/* Toast Notification Stack */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-lg border shadow-lg text-xs font-semibold ${
                t.variant === 'error'
                  ? 'bg-red-900 text-white border-red-700'
                  : t.variant === 'success'
                  ? 'bg-ustp-navy text-ustp-gold border-ustp-gold'
                  : 'bg-ustp-navy text-white border-slate-700'
              }`}
            >
              <span>{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
                className="p-0.5 hover:opacity-80 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
