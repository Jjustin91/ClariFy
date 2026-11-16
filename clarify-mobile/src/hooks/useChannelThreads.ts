import { useCallback, useEffect, useState } from "react";

import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { fetchThreads } from "@/lib/services/thread-service";
import type { AuthUser, Thread } from "@/types/api";

export type ThreadsStatus = "loading" | "ready" | "error";

export function useChannelThreads(channelId: number, viewer: AuthUser) {
  const [items, setItems] = useState<Thread[]>([]);
  const [status, setStatus] = useState<ThreadsStatus>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const threads = await fetchThreads(channelId, {}, viewer);
        if (!cancelled) {
          setItems(threads);
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
  }, [channelId, viewer, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { items, status, error, reload };
}
