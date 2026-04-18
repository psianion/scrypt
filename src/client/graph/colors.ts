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

export function darken(hex: string, by = 0.3): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - by)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - by)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - by)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
