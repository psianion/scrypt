import { useEffect, useState } from "react";
import type { GraphSnapshot } from "../../server/graph/snapshot";

const TTL_MS = 10_000;

let cache: { snap: GraphSnapshot; fetchedAt: number } | null = null;
let inflight: Promise<GraphSnapshot> | null = null;

export async function fetchSnapshot(force = false): Promise<GraphSnapshot> {
  const fresh = cache && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && !force) return cache!.snap;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch("/api/graph/snapshot");
    if (!res.ok) throw new Error(`snapshot fetch ${res.status}`);
    const snap = (await res.json()) as GraphSnapshot;
    cache = { snap, fetchedAt: Date.now() };
    return snap;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function useGraphSnapshot(): { snap: GraphSnapshot | null; error: Error | null } {
  const [snap, setSnap] = useState<GraphSnapshot | null>(cache?.snap ?? null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSnapshot().then(
      (s) => {
        if (!cancelled) setSnap(s);
      },
      (e) => {
        if (!cancelled) setError(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return { snap, error };
}
