export const RESERVED_PROJECTS = ["_inbox"] as const;
export type ReservedProject = (typeof RESERVED_PROJECTS)[number];

export function isReservedProject(project: string): boolean {
  return (RESERVED_PROJECTS as readonly string[]).includes(project);
}

// Project slug rules: lowercase a-z0-9-, optional leading underscore for reserved, ≤ 24 chars.
const PROJECT_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidProjectSlug(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 24 &&
    PROJECT_RE.test(v)
  );
}

export function normalizeProjectName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
