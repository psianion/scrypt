// src/server/mcp/confidence.ts
//
// Wave 9 tiered edge confidence. Replaces the Wave 8 trio
// (extracted/inferred/ambiguous) — no back-compat, pre-beta.
//
// Ordering is weakest → strongest, so `confidence_min` filters like
//   rank(edge) >= rank(min).
export const CONFIDENCE_VALUES = [
  "semantically_related",
  "mentions",
  "connected",
] as const;

export type Confidence = (typeof CONFIDENCE_VALUES)[number];

export const CONFIDENCE_RANK: Record<Confidence, number> = {
  semantically_related: 0,
  mentions: 1,
  connected: 2,
};

export function isConfidence(v: unknown): v is Confidence {
  return typeof v === "string" && (CONFIDENCE_VALUES as readonly string[]).includes(v);
}
