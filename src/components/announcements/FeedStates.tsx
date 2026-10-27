export function FeedSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading announcements">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-200" />
      ))}
    </div>
  );
}

export function FeedErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">
        Retry
      </button>
    </div>
  );
}

export function FeedEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-ustp-text/70">
      {message}
    </div>
  );
}