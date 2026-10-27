'use client';
import Link from 'next/link';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { FeedEmptyState, FeedErrorBanner, FeedSkeleton } from './FeedStates';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(iso));

export function DashboardHomeView({ userName }: { userName: string }) {
  const { items, isLoading, error, refetch } = useAnnouncements({ sort: 'latest', page: 1 });
  const latest = items.slice(0, 3);

  return (
    <main className="min-h-screen bg-ustp-cream p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="rounded-lg bg-ustp-navy p-6 text-white">
          <h1 className="text-2xl font-bold">Welcome back, {userName}!</h1>
          <p className="mt-1 text-sm text-white/80">Here&rsquo;s what&rsquo;s new on your noticeboard.</p>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-ustp-navy">Latest Announcements</h2>
            <Link href="/announcements" className="text-sm font-semibold text-ustp-blue underline">
              View all
            </Link>
          </div>

          {isLoading ? (
            <FeedSkeleton />
          ) : error ? (
            <FeedErrorBanner message={error} onRetry={refetch} />
          ) : latest.length === 0 ? (
            <FeedEmptyState message="No announcements yet." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {latest.map((a) => (
                <Link
                  key={a.id}
                  href="/announcements"
                  className={`block rounded-lg border bg-white p-4 shadow-sm ${
                    a.is_urgent ? 'border-ustp-orange' : 'border-gray-200'
                  }`}
                >
                  {a.is_urgent && <span className="text-xs font-bold text-ustp-orange">URGENT NOTICE</span>}
                  <h3 className="mt-1 line-clamp-2 font-bold text-ustp-navy">{a.title}</h3>
                  <p className="mt-1 text-xs text-ustp-text/70">
                    {a.publisher.department} · {formatDate(a.published_at)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold text-ustp-navy">Latest Messages</h2>
          {/* Placeholder until we know where this data comes from (see note below) */}
          <FeedEmptyState message="Latest Q&A messages will show here once the threads feed is connected." />
        </section>
      </div>
    </main>
  );
}