export const DOC_TYPES = [
  "research",
  "spec",
  "plan",
  "architecture",
  "review",
  "guide",
  "journal",
  "sessionlog",
  "other",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}
