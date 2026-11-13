'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
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
import { getTopLevelCourseHubs } from '../../lib/domain-logic';
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

  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const logoutTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelLogoutBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmLogoutBtnRef = useRef<HTMLButtonElement | null>(null);

  const openLogoutConfirm = (triggerEl: HTMLButtonElement | null) => {
    logoutTriggerRef.current = triggerEl;
    setIsLogoutConfirmOpen(true);
  };

  const closeLogoutConfirm = () => {
    setIsLogoutConfirmOpen(false);
    const trigger = logoutTriggerRef.current;
    if (trigger && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        trigger.focus();
      });
    }
  };

  const handleConfirmLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logoutApi();
    } finally {
      setIsLoggingOut(false);
      setIsLogoutConfirmOpen(false);
      clearSession();
      showToast('Signed out of ClariFy session.', 'info');
      router.replace('/login');
    }
  };

  useEffect(() => {
    if (!isLogoutConfirmOpen) return;
    const focusTimer = window.requestAnimationFrame(() => {
      cancelLogoutBtnRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLogoutConfirm();
        return;
      }
      if (e.key === 'Tab') {
        const cancelEl = cancelLogoutBtnRef.current;
        const confirmEl = confirmLogoutBtnRef.current;
        if (!cancelEl || !confirmEl) return;
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === cancelEl || active !== confirmEl) {
            e.preventDefault();
            confirmEl.focus();
          }
        } else if (active === confirmEl || active !== cancelEl) {
          e.preventDefault();
          cancelEl.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLogoutConfirmOpen]);

  const handleNavClickOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsDrawerOpen(false);
    }
  };

  if (!isAuthReady || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ustp-navy text-white p-6">
        <div className="text-center space-y-3">
          <Image
            src="/assets/aistudio/image_07899ab9.png"
            alt="ClariFy Logo"
            width={180}
            height={56}
            unoptimized
            className="h-14 w-auto mx-auto object-contain"
          />
          <p className="text-xs font-bold tracking-wider uppercase text-ustp-gold">
            Redirecting to ClariFy Sign In...
          </p>
        </div>
      </div>
    );
  }

  const courseHubs = getTopLevelCourseHubs(channels);
  const primaryChannelId = courseHubs[0]?.id || channels[0]?.id || 1;
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
          label: 'Announcements',
          href: '/announcements',
          active: pathname.startsWith('/announcements'),
        },
        {
          label: 'View Faculty',
          href: '/instructors',
          active: pathname.startsWith('/instructors'),
        },
        {
          label: 'Course Hubs',
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

  const isChannelView = pathname.startsWith('/channels');

  return (
    <div
      className={`${
        isChannelView ? 'h-dvh overflow-hidden' : 'min-h-screen'
      } flex flex-col bg-ustp-cream text-ustp-text`}
    >
      {/* Persistent Sticky Top Header Bar (ustp-navy #1a1851) */}
      <header className="sticky top-0 h-14 bg-ustp-navy text-white px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 border-b border-slate-800 shrink-0 z-40">
        {/* Left: Official ClariFy Logo + active view/hub title in white */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href={isAdmin ? '/admin' : '/'}
            aria-label="ClariFy Home"
            className="inline-flex items-center hover:opacity-95 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-ustp-gold rounded"
          >
            <Image
              src="/assets/aistudio/image_07899ab9.png"
              alt="ClariFy"
              width={120}
              height={36}
              unoptimized
              className="h-8 sm:h-9 w-auto object-contain"
            />
          </Link>
          <span className="text-slate-400 select-none" aria-hidden="true">
            |
          </span>
          <h1 className="text-xs sm:text-base font-bold text-white truncate">
            {title}
          </h1>
        </div>

        {/* Right: USTP Letters + Direct Logout Button + Hamburger Drawer Toggle Button */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <span className="hidden xs:inline text-sm sm:text-lg font-extrabold text-ustp-gold tracking-wider select-none">
            USTP
          </span>

          <button
            type="button"
            onClick={(e) => openLogoutConfirm(e.currentTarget)}
            aria-label="Log out of ClariFy"
            title="Log out"
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900/90 text-white border border-slate-700 hover:border-red-400 font-extrabold text-xs transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-ustp-gold"
          >
            <LogOut className="w-4 h-4 text-ustp-gold shrink-0" />
            <span className="hidden sm:inline">Log out</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-label={
              isDrawerOpen
                ? 'Close navigation drawer'
                : 'Open navigation drawer'
            }
            aria-expanded={isDrawerOpen}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-lg bg-ustp-orange hover:bg-ustp-orange-dark text-ustp-navy font-extrabold text-xs transition-colors cursor-pointer lg:hidden focus-visible:outline-2 focus-visible:outline-ustp-gold"
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
      <div
        className={`flex-1 min-h-0 flex items-start relative ${
          isChannelView ? 'overflow-hidden' : 'overflow-x-clip'
        }`}
      >
        {/* Main Center Workspace */}
        <main
          className={`flex-1 min-w-0 flex flex-col w-full ${
            isChannelView ? 'h-full min-h-0 overflow-hidden' : ''
          }`}
        >
          {children}
        </main>

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
            className="fixed inset-0 top-14 bg-black/45 z-30 lg:hidden"
          />
        )}

        {/* Right-Hand Profile & Navigation Drawer (ustp-orange #ff9718):
            - Mobile/Tablet (<1024px): Fixed slide-out overlay drawer from the right
            - Desktop (lg+): Sticky docked sidebar */}
        <aside
          aria-label="User Profile and Navigation Drawer"
          className={`fixed lg:sticky right-0 top-14 z-40 lg:z-20 h-[calc(100vh-3.5rem)] supports-[height:100dvh]:h-[calc(100dvh-3.5rem)] self-start bg-ustp-orange text-ustp-text border-l border-amber-600/40 shrink-0 flex flex-col justify-between transition-all duration-200 ease-out shadow-2xl lg:shadow-none ${
            isDrawerOpen
              ? 'w-64 sm:w-72 lg:w-64 max-w-[85vw] translate-x-0 overflow-hidden'
              : 'w-0 translate-x-full overflow-hidden border-l-0 pointer-events-none lg:pointer-events-auto'
          }`}
        >
          <div className="flex-1 min-h-0 overflow-y-auto">
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
              <div className="w-20 h-20 mx-auto rounded-full bg-white border-4 border-red-600 ring-2 ring-ustp-gold flex items-center justify-center text-2xl font-extrabold text-ustp-navy select-none overflow-hidden">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  avatarInitial
                )}
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

          {/* Bottom Pinned Links: Settings & Logout with safe-area bottom padding */}
          <div className="shrink-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 border-t border-amber-700/30 bg-ustp-orange">
            <button
              type="button"
              onClick={() => {
                handleNavClickOnMobile();
                setIsSettingsModalOpen(true);
              }}
              className="w-full flex items-center justify-end gap-2 px-2 py-2 min-h-[40px] text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={(e) => openLogoutConfirm(e.currentTarget)}
              className="w-full flex items-center justify-end gap-2 px-2 py-2 min-h-[40px] text-sm font-bold text-ustp-text hover:underline cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Logout Confirmation Dialog (Item 1 & Item 9) */}
      {isLogoutConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          aria-describedby="logout-confirm-desc"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeLogoutConfirm();
            }
          }}
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="space-y-1.5">
              <h2
                id="logout-confirm-title"
                className="text-base font-extrabold text-ustp-navy tracking-tight"
              >
                Log out of ClariFy?
              </h2>
              <p
                id="logout-confirm-desc"
                className="text-xs sm:text-sm text-slate-600 leading-relaxed"
              >
                You will need to sign in again with your USTP Institutional ID
                to access your Course Hubs and announcements.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                ref={cancelLogoutBtnRef}
                type="button"
                disabled={isLoggingOut}
                onClick={closeLogoutConfirm}
                className="px-4 py-2 min-h-[40px] rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-ustp-navy"
              >
                Cancel
              </button>
              <button
                ref={confirmLogoutBtnRef}
                type="button"
                disabled={isLoggingOut}
                onClick={() => void handleConfirmLogout()}
                className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-md bg-red-600 hover:bg-red-700 text-xs font-extrabold text-white cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ustp-navy"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
