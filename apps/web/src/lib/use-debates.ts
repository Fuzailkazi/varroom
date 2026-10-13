import { type Debate, ListDebatesResponse } from "@varroom/shared";
import { useEffect, useState } from "react";

export function useDebates(limit: number) {
  const [items, setItems] = useState<Debate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/debates?limit=${limit}`, { signal: controller.signal });
        if (!response.ok) throw new Error("The match feed could not load. Please try again.");
        const parsed = ListDebatesResponse.safeParse(await response.json());
        if (!parsed.success)
          throw new Error("The match feed returned incomplete data. Please try again.");
        setItems(parsed.data.items);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "The match feed could not load.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [limit]);

  return { items, loading, error };
}
