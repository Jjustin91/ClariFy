'use client';

import { useEffect, useState } from 'react';
import { listThreads } from '@/lib/thread-service';
import type { QaThread, ThreadStatus } from '@/types/api';

export function useThreads(
  channelId: number,
  status: ThreadStatus | undefined,
  viewerRole: 'student' | 'faculty',
  viewerId: number,
  reloadToken = 0
) {
  const [items, setItems] = useState<QaThread[]>([]);
  const [retryToken, setRetryToken] = useState(0);
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null);
  const requestKey = JSON.stringify([channelId, status, viewerRole, viewerId, reloadToken, retryToken]);

  useEffect(() => {
    let active = true;
    listThreads(channelId, status, viewerRole, viewerId)
      .then((threads) => {
        if (active) setItems(threads);
      })
      .catch((cause: unknown) => {
        if (active) {
          setRequestError({
            key: requestKey,
            message: cause instanceof Error ? cause.message : 'Could not load inquiries.',
          });
        }
      })
      .finally(() => {
        if (active) setCompletedKey(requestKey);
      });

    return () => {
      active = false;
    };
  }, [channelId, status, viewerRole, viewerId, reloadToken, retryToken, requestKey]);

  return {
    items,
    isLoading: completedKey !== requestKey,
    error: requestError?.key === requestKey ? requestError.message : null,
    refetch: () => setRetryToken((token) => token + 1),
  };
}
