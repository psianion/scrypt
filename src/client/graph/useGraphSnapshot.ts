import { useCallback, useEffect, useState } from "react";
import type { GraphSnapshot } from "../../server/graph/snapshot";

const TTL_MS = 10_000;

interface CacheEntry {
  snap: GraphSnapshot;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<GraphSnapshot> | null = null;
let etag: string | null = null;
let lastError: Error | null = null;
let staleSince: number | null = null;

export function __resetSnapshotCache(): void {
  cache = null;
  inflight = null;
  etag = null;
  lastError = null;
  staleSince = null;
}

export function __getSnapshotState() {
  return { cache, etag, lastError, staleSince };
}

export async function fetchSnapshot(force = false): Promise<GraphSnapshot> {
  const fresh = cache && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && !force) return cache!.snap;
  if (inflight) return inflight;
  inflight = (async () => {
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    const res = await fetch("/api/graph/snapshot", { headers });
    if (res.status === 304 && cache) {
      cache = { snap: cache.snap, fetchedAt: Date.now() };
      lastError = null;
      staleSince = null;
      return cache.snap;
    }
    if (!res.ok) throw new Error(`snapshot fetch ${res.status}`);
    const snap = (await res.json()) as GraphSnapshot;
    const newEtag = res.headers.get("ETag");
    if (newEtag) etag = newEtag;
    cache = { snap, fetchedAt: Date.now() };
    lastError = null;
    staleSince = null;
    return snap;
  })()
    .catch((err) => {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (cache && staleSince === null) staleSince = Date.now();
      console.warn("[graph] snapshot fetch failed:", lastError.message);
      throw lastError;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export interface UseGraphSnapshotResult {
  snap: GraphSnapshot | null;
  error: Error | null;
  lastError: Error | null;
  staleSince: number | null;
  refetch: () => void;
}

export function useGraphSnapshot(): UseGraphSnapshotResult {
  const [snap, setSnap] = useState<GraphSnapshot | null>(cache?.snap ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [lastErrorState, setLastErrorState] = useState<Error | null>(lastError);
  const [staleSinceState, setStaleSinceState] = useState<number | null>(staleSince);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot(tick > 0).then(
      (s) => {
        if (cancelled) return;
        setSnap(s);
        setError(null);
        setLastErrorState(null);
        setStaleSinceState(null);
      },
      (e) => {
        if (cancelled) return;
        setError(e);
        setLastErrorState(lastError);
        setStaleSinceState(staleSince);
        if (cache) setSnap(cache.snap);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { snap, error, lastError: lastErrorState, staleSince: staleSinceState, refetch };
}
