import type { SnapshotEdge } from "../../server/graph/snapshot";
import type { Tier } from "../../shared/types";

export type { Tier };
export type TierFilter = Record<Tier, boolean>;

export const DEFAULT_TIER_FILTER: TierFilter = {
  connected: true,
  mentions: false,
  semantically_related: false,
};

const STORAGE_KEY = "graph-tier-filter";
const SCHEMA_VERSION = 1;

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function loadTierFilter(ls: Storage = localStorage): TierFilter {
  const raw = ls.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_TIER_FILTER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TIER_FILTER;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== SCHEMA_VERSION
  ) {
    return DEFAULT_TIER_FILTER;
  }
  const p = parsed as Record<string, unknown>;
  return {
    connected: pickBool(p.connected, DEFAULT_TIER_FILTER.connected),
    mentions: pickBool(p.mentions, DEFAULT_TIER_FILTER.mentions),
    semantically_related: pickBool(
      p.semantically_related,
      DEFAULT_TIER_FILTER.semantically_related,
    ),
  };
}

export function saveTierFilter(ls: Storage, value: TierFilter): void {
  ls.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...value }));
}

export function filterEdgesByTier(
  edges: SnapshotEdge[],
  filter: TierFilter,
): SnapshotEdge[] {
  return edges.filter((e) => filter[e.tier] ?? false);
}
