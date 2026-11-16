import { useCallback, useEffect, useState } from "react";

import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { fetchCourseHubs } from "@/lib/services/channel-service";
import type { Channel } from "@/types/api";

export type CourseHubsStatus = "loading" | "ready" | "error";

export function useCourseHubs() {
  const [items, setItems] = useState<Channel[]>([]);
  const [status, setStatus] = useState<CourseHubsStatus>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const hubs = await fetchCourseHubs();
        if (!cancelled) {
          setItems(hubs);
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
  }, [reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { items, status, error, reload };
}
