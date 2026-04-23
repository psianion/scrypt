// Shared visual encoding for graph renderers (spec §5.1).
//
// Both the SVG-based `GraphView` DOM layer and the Pixi `render.ts` pull
// their edge colours and label truncation from here so the wire stays single
// source of truth.

export interface EdgeStyle {
  /** Hex stroke colour, e.g. "#3b82f6". */
  stroke: string;
  /** Stroke width in CSS pixels. */
  strokeWidth: number;
  /** SVG stroke-dasharray value, or null for solid. */
  dashArray: string | null;
  /** Whether the renderer should draw an arrowhead at the target. */
  arrow: boolean;
}

// Lineage reasons (connected tier):
//   derives-from → blue  (spec → research)
//   implements   → green (plan → spec / architecture)
//   supersedes   → amber (any → any, same doc_type; source gets greyed)
//
// Other connected (non-lineage): neutral grey, solid, arrowed.
// Mentions            : thin grey, no arrow.
// Semantically_related: dashed, no arrow.
export function edgeStyleFor(
  tier: string,
  reason: string | null,
): EdgeStyle {
  if (tier === "connected") {
    if (reason === "derives-from") {
      return { stroke: "#3b82f6", strokeWidth: 2, dashArray: null, arrow: true };
    }
    if (reason === "implements") {
      return { stroke: "#10b981", strokeWidth: 2, dashArray: null, arrow: true };
    }
    if (reason === "supersedes") {
      return { stroke: "#f59e0b", strokeWidth: 2, dashArray: null, arrow: true };
    }
    return { stroke: "#6b7280", strokeWidth: 1.5, dashArray: null, arrow: true };
  }
  if (tier === "mentions") {
    return { stroke: "#9aa0aa", strokeWidth: 1, dashArray: null, arrow: false };
  }
  // semantically_related
  return { stroke: "#7a7f88", strokeWidth: 0.8, dashArray: "4 3", arrow: false };
}

/** `supersedes` tells the UI the source is "replaced" — dim it. */
export function sourceNodeOpacityFor(
  tier: string,
  reason: string | null,
): number {
  if (tier === "connected" && reason === "supersedes") return 0.45;
  return 1;
}

/** Graph node label: title truncated to `max` chars with an ellipsis. */
export function truncateLabel(title: string, max = 40): string {
  if (title.length <= max) return title;
  return title.slice(0, max - 1) + "…";
}
