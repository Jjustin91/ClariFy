import { Suspense } from 'react';
import Link from 'next/link';
import { RightProfileSidebar } from '@/components/layout/RightProfileSidebar';
import { ChannelThreadWorkspace } from '@/components/threads/ChannelThreadWorkspace';

interface ChannelHubPageProps {
  params: Promise<{ channelId: string }>;
}

async function ChannelHubPageContent({ params }: ChannelHubPageProps) {
  const { channelId: channelIdParam } = await params;
  const channelId = Number(channelIdParam);

  return (
    <div className="flex min-h-screen bg-ustp-cream text-ustp-text">
      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-ustp-navy px-5 py-4 text-white sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Course Hub</p>
            <h1 className="text-xl font-bold">Channel {channelId}</h1>
          </div>
          <Link href="/announcements" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
            Noticeboard Feed
          </Link>
        </header>
        <div className="p-4 sm:p-8">
          {Number.isInteger(channelId) && channelId > 0 ? (
            <ChannelThreadWorkspace channelId={channelId} />
          ) : (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              This course hub could not be found.
            </p>
          )}
        </div>
      </main>
      <RightProfileSidebar />
    </div>
  );
}

export default function ChannelHubPage({ params }: ChannelHubPageProps) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-ustp-cream p-8 text-ustp-navy">
          Loading course hub…
        </main>
      }
    >
      <ChannelHubPageContent params={params} />
    </Suspense>
  );
}
