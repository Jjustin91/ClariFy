'use client';

import { useEffect, useState } from 'react';
import { listInstructors } from '@/lib/instructor-service';
import type { InstructorDirectoryEntry, InstructorFilters, PaginationMeta } from '@/types/api';

export function useInstructors(filters: InstructorFilters) {
  const [items, setItems] = useState<InstructorDirectoryEntry[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const filterKey = JSON.stringify(filters);
  const requestKey = `${filterKey}:${retryToken}`;
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    listInstructors(filters)
      .then((result) => {
        if (active) {
          setItems(result.data);
          setMeta(result.meta);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setRequestError({
            key: requestKey,
            message: cause instanceof Error ? cause.message : 'Could not load the instructor directory.',
          });
        }
      })
      .finally(() => {
        if (active) setCompletedKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [filterKey, filters, requestKey, retryToken]);

  return {
    items,
    meta,
    isLoading: completedKey !== requestKey,
    error: requestError?.key === requestKey ? requestError.message : null,
    refetch: () => setRetryToken((token) => token + 1),
  };
}
