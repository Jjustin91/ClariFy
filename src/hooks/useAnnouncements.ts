'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { USE_MOCKS } from '@/lib/announcement-service';
import { mockAnnouncementList } from '@/mocks/announcements';
import type { Announcement, AnnouncementFilters, PaginationMeta, Paginated } from '@/types/api';

function filterMocks(f: AnnouncementFilters): Paginated<Announcement> {
  let list = [...mockAnnouncementList];
  if (f.channel_id) list = list.filter((a) => a.channel_id === f.channel_id);
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter((a) => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q));
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
  return { data: list, meta: { current_page: 1, last_page: 1, per_page: 10, total: list.length } };
}

export function useAnnouncements(filters: AnnouncementFilters, reloadToken = 0) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(filters) + reloadToken;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        let res: Paginated<Announcement>;
        if (USE_MOCKS) {
          await new Promise((r) => setTimeout(r, 400));
          res = filterMocks(filters);
        } else {
          res = (await apiClient.get('/announcements', { params: filters })) as Paginated<Announcement>;
        }
        setItems(res.data);
        setMeta(res.meta);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

useEffect(() => {
  queueMicrotask(() => {
    load();
  });
}, [load]);

  return { items, meta, isLoading, error, refetch: () => load(true) };
}