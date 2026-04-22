export const DOC_TYPE_COLOR: Record<string, string> = {
  research:     "#6366f1",
  spec:         "#10b981",
  plan:         "#f59e0b",
  architecture: "#8b5cf6",
  review:       "#ef4444",
  guide:        "#06b6d4",
  journal:      "#64748b",
  changelog:    "#94a3b8",
  other:        "#737373",
};

export function colorFor(docType: string | null): string {
  return (docType && DOC_TYPE_COLOR[docType]) || "#737373";
}

/**
 * Stable per-project color. Uses a small hand-picked palette indexed by
 * a cheap string hash so the same project always gets the same color across
 * reloads and sessions.
 */
const PROJECT_PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
  "#3b82f6", // blue
  "#a855f7", // purple
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function colorForProject(project: string): string {
  return PROJECT_PALETTE[hashString(project) % PROJECT_PALETTE.length]!;
}

export function darken(hex: string, by = 0.3): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - by)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - by)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - by)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
