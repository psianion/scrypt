import type { DocType } from "./doc-types";

export const LINEAGE_REASONS = [
  "derives-from",
  "implements",
  "supersedes",
] as const;
export type LineageReason = (typeof LINEAGE_REASONS)[number];

export function isLineageReason(v: unknown): v is LineageReason {
  return (
    typeof v === "string" &&
    (LINEAGE_REASONS as readonly string[]).includes(v)
  );
}

// Shape rules: { reason: { source_doc_types: [...], target_doc_types: [...] } }.
// Empty array means "any doc_type".
const SHAPES: Record<
  LineageReason,
  { src: DocType[]; tgt: DocType[]; sameDocType: boolean }
> = {
  "derives-from": { src: ["spec"], tgt: ["research"], sameDocType: false },
  implements: { src: ["plan"], tgt: ["spec", "architecture"], sameDocType: false },
  supersedes: { src: [], tgt: [], sameDocType: true },
};

export interface ShapeCheck {
  ok: boolean;
  reason?: string;
}

export function checkLineageShape(
  lineageReason: LineageReason,
  srcDocType: DocType | null,
  tgtDocType: DocType | null,
  srcProject: string | null,
  tgtProject: string | null,
): ShapeCheck {
  if (!srcDocType || !tgtDocType)
    return { ok: false, reason: "missing doc_type on either endpoint" };
  if (!srcProject || !tgtProject)
    return { ok: false, reason: "missing project on either endpoint" };
  if (srcProject !== tgtProject)
    return {
      ok: false,
      reason: `lineage must share project; got ${srcProject} vs ${tgtProject}`,
    };

  const shape = SHAPES[lineageReason];
  if (shape.sameDocType && srcDocType !== tgtDocType) {
    return {
      ok: false,
      reason: `${lineageReason} requires matching doc_type; got ${srcDocType} → ${tgtDocType}`,
    };
  }
  if (shape.src.length > 0 && !shape.src.includes(srcDocType)) {
    return {
      ok: false,
      reason: `${lineageReason} requires source doc_type ∈ {${shape.src.join(",")}}; got ${srcDocType}`,
    };
  }
  if (shape.tgt.length > 0 && !shape.tgt.includes(tgtDocType)) {
    return {
      ok: false,
      reason: `${lineageReason} requires target doc_type ∈ {${shape.tgt.join(",")}}; got ${tgtDocType}`,
    };
  }
  return { ok: true };
}
