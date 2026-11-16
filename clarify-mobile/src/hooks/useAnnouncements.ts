import { useCallback, useEffect, useState } from "react";

import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import {
    acknowledgeAnnouncement,
    fetchAnnouncements,
} from "@/lib/services/announcement-service";
import type {
    Announcement,
    AnnouncementQuery,
    PaginationMeta,
    UserRole,
} from "@/types/api";

export type FeedStatus = "loading" | "ready" | "error";

export function useAnnouncements(
  query: AnnouncementQuery,
  viewerRole: UserRole,
) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  const { channel_id, search, department, tag, sort, page } = query;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const result = await fetchAnnouncements(
          { channel_id, search, department, tag, sort, page },
          viewerRole,
        );
        if (!cancelled) {
          setItems(result.data);
          setMeta(result.meta);
          setStatus("ready");
        }
      } catch (caught) {
        if (!cancelled) {
          setError(toApiError(caught));
          setStatus("error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    channel_id,
    search,
    department,
    tag,
    sort,
    page,
    viewerRole,
    reloadCount,
  ]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  const acknowledge = useCallback(async (id: number) => {
    setAcknowledgingId(id);
    setActionError(null);
    try {
      const updated = await acknowledgeAnnouncement(id);
      setItems((current) =>
        current.map((item) => (item.id === id ? updated : item)),
      );
    } catch (caught) {
      setActionError(toApiError(caught));
    } finally {
      setAcknowledgingId(null);
    }
  }, []);

  return {
    items,
    meta,
    status,
    error,
    reload,
    acknowledge,
    acknowledgingId,
    actionError,
  };
}
