// src/server/slug-resolver.ts
import type { Database } from "bun:sqlite";

interface SlugMatch {
  path: string;
  title: string | null;
}

export function resolveSlug(
  target: string,
  db: Database,
): SlugMatch | null {
  const clean = target.trim();
  if (!clean) return null;

  const exact = db
    .query("SELECT path, title FROM link_index WHERE slug = ? LIMIT 1")
    .get(clean) as SlugMatch | undefined;
  if (exact) return exact;

  const ci = db
    .query(
      "SELECT path, title FROM link_index WHERE slug = ? COLLATE NOCASE LIMIT 1",
    )
    .get(clean) as SlugMatch | undefined;
  if (ci) return ci;

  if (clean.includes("/")) {
    const suffix = `%${clean}`;
    const fuzzy = db
      .query("SELECT path, title FROM link_index WHERE slug LIKE ? LIMIT 1")
      .get(suffix) as SlugMatch | undefined;
    if (fuzzy) return fuzzy;
  }

  return null;
}
