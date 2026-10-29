'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { USE_MOCKS } from '@/lib/announcement-service';
import { mockAnnouncementList } from '@/mocks/announcements';
import type { Announcement, AnnouncementFilters, PaginationMeta, Paginated } from '@/types/api';

function filterMocks(f: AnnouncementFilters): Paginated<Announcement> {
  let list = [...mockAnnouncementList];

  if (f.channel_id) {
    list = list.filter((a) => a.channel_id === f.channel_id);
  }

  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(
      (a) => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    );
  }

  if (f.department) {
    const d = f.department;
    list = list.filter((a) => a.publisher.department === d || a.tags.includes(d));
  }

  if (f.tag) {
    const t = f.tag;
    list = list.filter((a) => a.tags.includes(t));
  }

  list.sort((a, b) => {
    const diff = new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
    return f.sort === 'oldest' ? -diff : diff;
  });

  return {
    data: list,
    meta: {
      current_page: 1,
      last_page: 1,
      per_page: 10,
      total: list.length,
    },
  };
}

export function useAnnouncements(filters: AnnouncementFilters, reloadToken = 0) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filters) + reloadToken;

  const loadData = useCallback(
    async (silent = false, isMounted = { current: true }) => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        let res: Paginated<Announcement>;
        if (USE_MOCKS) {
          await new Promise((r) => setTimeout(r, 400));
          res = filterMocks(filters);
        } else {
          res = (await apiClient.get('/announcements', {
            params: filters,
          })) as Paginated<Announcement>;
        }

        if (isMounted.current) {
          setItems(res.data);
          setMeta(res.meta);
        }
      } catch (e) {
        if (isMounted.current) {
          setError(e instanceof Error ? e.message : 'Something went wrong fetching announcements.');
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey]
  );

  useEffect(() => {
    const isMounted = { current: true };
    loadData(false, isMounted);

    return () => {
      isMounted.current = false;
    };
  }, [loadData]);

  return {
    items,
    meta,
    isLoading,
    error,
    refetch: () => loadData(true),
  };
}