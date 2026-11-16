import { useCallback, useEffect, useState } from "react";

import type { ApiError } from "@/lib/api-client";
import { toApiError } from "@/lib/api-client";
import { fetchInstructors } from "@/lib/services/instructor-service";
import type { Instructor, InstructorQuery, PaginationMeta } from "@/types/api";

export type InstructorsStatus = "loading" | "ready" | "error";

export function useInstructors(query: InstructorQuery) {
  const [items, setItems] = useState<Instructor[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [status, setStatus] = useState<InstructorsStatus>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const { search, department, sort, page } = query;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const result = await fetchInstructors({
          search,
          department,
          sort,
          page,
        });
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
  }, [search, department, sort, page, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { items, meta, status, error, reload };
}
