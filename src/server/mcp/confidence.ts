// src/server/mcp/confidence.ts
//
// graph-v2: tier is the first-class edge classifier. Ordering is weakest →
// strongest, so `tier_min` filters like rank(edge) >= rank(min).
import type { Tier } from "../../shared/types";

export const TIER_VALUES = [
  "semantically_related",
  "mentions",
  "connected",
] as const;

export const TIER_RANK: Record<Tier, number> = {
  semantically_related: 0,
  mentions: 1,
  connected: 2,
};

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIER_VALUES as readonly string[]).includes(v);
}
