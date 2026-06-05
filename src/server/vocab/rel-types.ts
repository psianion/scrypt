// src/server/vocab/rel-types.ts
//
// Curated AI edge relationship-type vocabulary (ingestion rework C4).
// These are AI-asserted typed edges stored in graph_edges.rel_type; they
// carry a non-null client_tag and are removable via remove_edge. Distinct
// from lineage reasons (derives-from/implements/supersedes) which live on
// graph_edges.reason.
export const REL_TYPES = [
  "builds_on",
  "replaces",
  "contradicts",
  "part_of",
  "cites",
  "relates_to",
] as const;

export type RelType = (typeof REL_TYPES)[number];

export function isRelType(v: unknown): v is RelType {
  return typeof v === "string" && (REL_TYPES as readonly string[]).includes(v);
}
