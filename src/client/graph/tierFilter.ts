import type { SnapshotEdge } from "../../server/graph/snapshot";

export type Tier = "connected" | "mentions" | "semantically_related";
export type TierFilter = Record<Tier, boolean>;

export const DEFAULT_TIER_FILTER: TierFilter = {
  connected: true,
  mentions: false,
  semantically_related: false,
};

const STORAGE_KEY = "graph-tier-filter";

export function loadTierFilter(ls: Storage = localStorage): TierFilter {
  const raw = ls.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_TIER_FILTER;
  try {
    const parsed = JSON.parse(raw);
    return {
      connected: parsed.connected ?? true,
      mentions: parsed.mentions ?? false,
      semantically_related: parsed.semantically_related ?? false,
    };
  } catch {
    return DEFAULT_TIER_FILTER;
  }
}

export function saveTierFilter(ls: Storage, value: TierFilter): void {
  ls.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function filterEdgesByTier(
  edges: SnapshotEdge[],
  filter: TierFilter,
): SnapshotEdge[] {
  return edges.filter((e) => filter[(e.confidence ?? "connected") as Tier] ?? false);
}
