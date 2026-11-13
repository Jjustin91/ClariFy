'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { AnnouncementCard } from '@/src/components/announcements/AnnouncementCard';
import {
  EmptyState,
  ErrorBanner,
  SkeletonCards,
} from '@/src/components/ui/StateViews';
import { useClarify } from '@/src/context/ClarifyContext';
import { getAnnouncementsApi } from '@/src/lib/api-client';
import {
  canPublishCampusWideAnnouncements,
  getJoinedCourseHubs,
  getTopLevelCourseHubs,
} from '@/src/lib/domain-logic';
import type { Announcement, LaravelValidationError } from '@/src/types/api';

export default function DashboardPage() {
  const router = useRouter();
  const {
    user,
    isAuthenticated,
    isAuthReady,
    channels,
    announcementVersion,
    openAnnouncementModal,
    openCourseHubModal,
  } = useClarify();

  const allCourseHubs = getTopLevelCourseHubs(channels);
  const courseHubs = getJoinedCourseHubs(channels, user);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const loadDashboardData = useCallback(async () => {
    if (!isAuthReady || !isAuthenticated || user.role === 'it_admin') {
      return;
    }
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const res = await getAnnouncementsApi({
        sort: 'latest',
        page: 1,
        per_page: 2,
      });
      setAnnouncements(res.data);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message ||
          'Unable to connect to Laravel 13 backend at http://localhost:8000/api/v1.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isAuthReady, isAuthenticated, user.role]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) {
      return;
    }
    if (user.role === 'it_admin') {
      router.replace('/admin');
      return;
    }
    loadDashboardData();
  }, [
    loadDashboardData,
    announcementVersion,
    isAuthReady,
    isAuthenticated,
    user.role,
    router,
  ]);

  if (!isAuthReady || !isAuthenticated || user.role === 'it_admin') {
    return null;
  }

  const canPublishCampusWide = canPublishCampusWideAnnouncements(user.role);

  return (
    <AppShell title="Dashboard">
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6 sm:space-y-8">
        {/* Top Banner: Rounded ustp-gold (#fcb315) pill banner displaying "Welcome back!" matching Wireframes Pages 2 & 5 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 rounded-2xl bg-ustp-gold text-white shadow-xs">
            <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight drop-shadow-xs">
              Welcome back!
            </h2>
          </div>

          {canPublishCampusWide && (
            <button
              type="button"
              onClick={() => openAnnouncementModal({ mode: 'campus_wide' })}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ustp-navy text-white text-xs font-bold rounded-lg hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-gold self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-4 h-4 text-ustp-gold" />
              <span>Create Campus-Wide Announcement</span>
            </button>
          )}
        </div>

        {/* Section 1: Latest announcements with right-aligned "See all..." link (Wireframes Pages 2 & 5) */}
        <section aria-labelledby="latest-announcements-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3
              id="latest-announcements-heading"
              className="text-base sm:text-lg font-bold text-ustp-text"
            >
              Latest announcements
            </h3>
            <Link
              href="/announcements"
              className="text-xs font-bold text-slate-600 hover:text-ustp-navy underline"
            >
              See all...
            </Link>
          </div>

          {isLoading ? (
            <SkeletonCards count={2} />
          ) : error ? (
            <ErrorBanner message={error} onRetry={loadDashboardData} />
          ) : announcements.length === 0 ? (
            <EmptyState
              title="No Campus Announcements Yet"
              description="Scoped announcements for your CITC courses and CDO Campus will appear here."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {announcements.map((item) => (
                <AnnouncementCard
                  key={item.id}
                  announcement={item}
                  variant="grid"
                  onUpdated={loadDashboardData}
                />
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Course Hubs (Course Hub Activity Summary) matching Wireframes Pages 2 & 5 */}
        <section aria-labelledby="latest-messages-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="latest-messages-heading"
              className="text-base sm:text-lg font-bold text-ustp-text"
            >
              Course Hubs
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => openCourseHubModal('browse')}
                className="text-xs font-bold text-ustp-navy hover:underline cursor-pointer"
              >
                Browse Course Hubs ({allCourseHubs.length})
              </button>
              <Link
                href={`/channels/${courseHubs[0]?.id || allCourseHubs[0]?.id || 1}`}
                className="text-xs font-bold text-slate-600 hover:text-ustp-navy underline"
              >
                Open Course Hubs &rarr;
              </Link>
            </div>
          </div>

          {courseHubs.length === 0 ? (
            <div className="bg-white border border-slate-200/90 rounded-lg p-6 text-center space-y-3">
              <p className="text-sm font-extrabold text-ustp-navy">
                You Haven&apos;t Joined Any Course Hubs Yet
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Browse existing Course Hubs to join your classes or create a new
                Course Hub with built-in Noticeboard Feed and Isolated Q&amp;A
                Threads.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openCourseHubModal('browse')}
                  className="px-4 py-2 text-xs font-extrabold bg-ustp-navy text-ustp-gold rounded hover:opacity-95 cursor-pointer"
                >
                  Browse Course Hubs ({allCourseHubs.length})
                </button>
                <button
                  type="button"
                  onClick={() => openCourseHubModal('create_hub')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Course Hub</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {courseHubs.map((ch) => {
                const titleDisplay = ch.course_code
                  ? `${ch.scope_section || 'IT3R2'}-${ch.course_code} ${ch.name.replace(
                      /^#\s*\S+\s*/,
                      ''
                    )}`
                  : ch.name;

                const openInquiries = ch.unread_count || 0;
                const totalChats = ch.chat_messages_count || 0;
                const hasActivity = openInquiries > 0 || totalChats > 0;

                let badgeCount = '0 inquiries · 0 chats';
                if (openInquiries > 0 && totalChats > 0) {
                  badgeCount = `${openInquiries} ${
                    openInquiries === 1 ? 'inquiry' : 'inquiries'
                  } · ${totalChats} ${totalChats === 1 ? 'chat' : 'chats'}`;
                } else if (openInquiries > 0) {
                  badgeCount = `${openInquiries} ${
                    openInquiries === 1 ? 'inquiry' : 'inquiries'
                  }`;
                } else if (totalChats > 0) {
                  badgeCount = `${totalChats} ${
                    totalChats === 1 ? 'chat' : 'chats'
                  }`;
                }

                return (
                  <Link
                    key={ch.id}
                    href={`/channels/${ch.id}`}
                    className="block bg-white border border-slate-200/90 hover:border-ustp-navy rounded-lg px-5 py-3.5 shadow-xs hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-ustp-text truncate">
                          {titleDisplay}
                        </p>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {ch.latest_activity_preview ||
                            `${ch.instructor_name || 'Instructor'}: Course Hub active for ${
                              ch.scope_section || 'IT3R2'
                            }`}
                        </p>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <span
                          className={`block text-xs font-bold ${
                            hasActivity ? 'text-red-600' : 'text-slate-500'
                          }`}
                        >
                          {badgeCount}
                        </span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">
                          {ch.latest_activity_at || 'No activity yet'}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
