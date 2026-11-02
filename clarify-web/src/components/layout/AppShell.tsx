'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Settings,
  X,
} from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import { logoutApi } from '../../lib/api-client';
import { AnnouncementFormModal } from '../modals/AnnouncementFormModal';
import { ProfileSettingsModal } from '../modals/ProfileSettingsModal';
import { ChannelRosterModal } from '../modals/ChannelRosterModal';
import { UrgentAnnouncementModal } from '../modals/UrgentAnnouncementModal';

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
    isAuthenticated,
    isAuthReady,
    clearSession,
    channels,
    isDrawerOpen,
    setIsDrawerOpen,
    setIsSettingsModalOpen,
    toasts,
    dismissToast,
    showToast,
  } = useClarify();

  const handleLogout = async () => {
    await logoutApi();
    clearSession();
    showToast('Signed out of ClariFy session.', 'info');
    router.replace('/login');
  };

  const handleNavClickOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsDrawerOpen(false);
    }
  };

  if (!isAuthReady || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ustp-navy text-white p-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-ustp-navy text-ustp-gold font-extrabold text-lg border-2 border-ustp-gold">
            USTP
          </div>
          <p className="text-xs font-bold tracking-wider uppercase text-ustp-gold">
            Redirecting to ClariFy Sign In...
          </p>
        </div>
      </div>
    );
  }

  const primaryChannelId = channels[0]?.id || 1;
  const isAdmin = user.role === 'it_admin';

  const navItems = isAdmin
    ? [
        {
          label: 'Admin Console',
          href: '/admin',
          active: pathname.startsWith('/admin'),
        },
      ]
    : [
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
          href: `/channels/${primaryChannelId}`,
          active: pathname.startsWith('/channels'),
        },
      ];

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
      : user.role === 'it_admin'
      ? 'ICTO System Administration'
      : `${user.academic_profile?.department || 'CITC'} Dept`;

  return (
    <div className="min-h-screen flex flex-col bg-ustp-cream text-ustp-text">
      {/* Persistent Sticky Top Header Bar (ustp-navy #1a1851) */}
      <header className="sticky top-0 h-14 bg-ustp-navy text-white px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 border-b border-slate-800 shrink-0 z-40">
        {/* Left: ClariFy in bold ustp-gold + active view/hub title in white */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href={isAdmin ? '/admin' : '/'}
            className="text-lg sm:text-xl font-extrabold tracking-tight text-ustp-gold hover:opacity-95 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-ustp-gold rounded"
          >
            ClariFy
          </Link>
          <span className="text-slate-400 select-none" aria-hidden="true">
            |
          </span>
          <h1 className="text-xs sm:text-base font-bold text-white truncate">
            {title}
          </h1>
        </div>

        {/* Right: USTP Logo Badge + Hamburger Drawer Toggle Button */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/login"
            title="Universal Login Screen"
            className="hidden sm:flex items-center justify-center px-2.5 py-1 bg-white text-ustp-navy font-extrabold text-xs rounded border border-ustp-gold tracking-tight whitespace-nowrap shrink-0 hover:bg-ustp-cream"
          >
            USTP
          </Link>

          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-label={
              isDrawerOpen
                ? 'Close navigation drawer'
                : 'Open navigation drawer'
            }
            aria-expanded={isDrawerOpen}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-lg bg-ustp-orange hover:bg-ustp-orange-dark text-ustp-navy font-extrabold text-xs transition-colors cursor-pointer lg:hidden"
          >
            {isDrawerOpen ? (
              <X className="w-5 h-5 stroke-[2.4]" />
            ) : (
              <Menu className="w-5 h-5 stroke-[2.4]" />
            )}
            <span className="hidden xs:inline">Menu</span>
          </button>
        </div>
      </header>

      {/* Main Content + Right-Hand Responsive Profile & Navigation Drawer */}
      <div className="flex-1 flex items-start relative overflow-x-clip">
        {/* Main Center Workspace */}
        <main className="flex-1 min-w-0 flex flex-col w-full">{children}</main>

        {/* Desktop Collapsed Drawer Re-Open Tab when Drawer is closed */}
        {!isDrawerOpen && (
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Expand profile and navigation drawer"
            className="hidden lg:flex fixed right-0 top-16 z-30 bg-ustp-orange hover:bg-ustp-orange-dark text-ustp-navy font-bold p-2.5 rounded-l-lg border-l border-y border-amber-700/40 shadow-md items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-xs font-extrabold">Menu</span>
          </button>
        )}

        {/* Mobile/Tablet Backdrop Overlay when Drawer is open */}
        {isDrawerOpen && (
          <div
            onClick={() => setIsDrawerOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 top-14 bg-black/45 backdrop-blur-[1px] z-30 lg:hidden"
          />
        )}

        {/* Right-Hand Profile & Navigation Drawer (ustp-orange #ff9718):
            - Mobile/Tablet (<1024px): Fixed slide-out overlay drawer from the right
            - Desktop (lg+): Sticky docked sidebar */}
        <aside
          aria-label="User Profile and Navigation Drawer"
          className={`fixed lg:sticky right-0 top-14 z-40 lg:z-20 h-[calc(100vh-3.5rem)] self-start bg-ustp-orange text-ustp-text border-l border-amber-600/40 shrink-0 flex flex-col justify-between transition-all duration-200 ease-out shadow-2xl lg:shadow-none ${
            isDrawerOpen
              ? 'w-64 sm:w-72 lg:w-64 translate-x-0 overflow-y-auto'
              : 'w-0 translate-x-full overflow-hidden border-l-0 pointer-events-none lg:pointer-events-auto'
          }`}
        >
          <div>
            {/* Top-left Chevron Toggle Button */}
            <div className="p-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Collapse profile drawer"
                className="p-1.5 rounded hover:bg-ustp-orange-dark/40 text-ustp-navy focus-visible:outline-2 focus-visible:outline-ustp-navy cursor-pointer"
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

            {/* Vertical Navigation Stack */}
            <nav aria-label="Primary Navigation" className="divide-y divide-amber-700/30 border-b border-amber-700/30">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClickOnMobile}
                  className={`block w-full px-5 py-3.5 text-right text-sm font-bold transition-colors ${
                    item.active
                      ? 'bg-ustp-orange-dark text-ustp-text font-extrabold'
                      : 'hover:bg-ustp-orange-dark/50 text-ustp-text'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Bottom Pinned Links: Settings & Logout */}
          <div className="p-4 space-y-2 border-t border-amber-700/30">
            <button
              type="button"
              onClick={() => {
                handleNavClickOnMobile();
                setIsSettingsModalOpen(true);
              }}
              className="w-full flex items-center justify-end gap-2 px-2 py-2 text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-end gap-2 px-2 py-2 text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Global Modals */}
      {!isAdmin && <AnnouncementFormModal />}
      <ProfileSettingsModal />
      {!isAdmin && <ChannelRosterModal />}
      {!isAdmin && <UrgentAnnouncementModal />}

      {/* Toast Notification Stack */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 max-w-sm w-auto sm:w-full pointer-events-none"
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
