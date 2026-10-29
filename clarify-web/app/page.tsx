'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
import { canPublishOrManageAnnouncements } from '@/src/lib/domain-logic';
import type { Announcement, LaravelValidationError } from '@/src/types/api';

export default function DashboardPage() {
  const {
    user,
    channels,
    announcementVersion,
    openAnnouncementModal,
  } = useClarify();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getAnnouncementsApi({
        sort: 'latest',
        page: 1,
        per_page: 2,
      });
      setAnnouncements(res.data);
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      setError(
        apiErr.message ||
          'Unable to connect to Laravel 13 backend at http://localhost:8000/api/v1.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData, announcementVersion]);

  const canPublish = canPublishOrManageAnnouncements(user.role);

  return (
    <AppShell title="Dashboard">
      <div className="p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-8">
        {/* Top Banner: Rounded ustp-gold (#fcb315) pill banner displaying "Welcome back!" matching Wireframes Pages 2 & 5 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="inline-flex items-center px-8 py-4 rounded-2xl bg-ustp-gold text-white shadow-xs">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight drop-shadow-xs">
              Welcome back!
            </h2>
          </div>

          {canPublish && (
            <button
              type="button"
              onClick={() => openAnnouncementModal()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ustp-navy text-white text-xs font-bold rounded-lg hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ustp-gold self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-4 h-4 text-ustp-gold" />
              <span>Create Announcement</span>
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

        {/* Section 2: Latest Messages (Course Hub Activity Summary) matching Wireframes Pages 2 & 5 */}
        <section aria-labelledby="latest-messages-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3
              id="latest-messages-heading"
              className="text-base sm:text-lg font-bold text-ustp-text"
            >
              Latest Messages
            </h3>
            <Link
              href="/channels/7"
              className="text-xs font-bold text-slate-600 hover:text-ustp-navy underline"
            >
              Open Course Hubs &rarr;
            </Link>
          </div>

          <div className="space-y-3">
            {channels.map((ch) => {
              const titleDisplay = ch.course_code
                ? `${ch.scope_section || 'IT3R2'}-${ch.course_code} ${ch.name.replace(
                    /^#\s*\S+\s*/,
                    ''
                  )}`
                : ch.name;
              const badgeCount =
                ch.unread_count && ch.unread_count > 0
                  ? `${ch.unread_count} inquiries`
                  : '9+ chats';

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
                      <span className="block text-xs font-bold text-red-600">
                        {badgeCount}
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {ch.latest_activity_at || '30 mins'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
