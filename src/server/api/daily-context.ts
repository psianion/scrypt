// src/server/api/daily-context.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { parseFrontmatter } from "../parsers";

export function dailyContextRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  vaultPath: string,
): void {
  router.get("/api/daily_context", async () => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const date = `${y}-${m}-${d}`;
    const journalRel = `journal/${date}.md`;
    const journalAbs = join(vaultPath, journalRel);

    const journal = existsSync(journalAbs)
      ? {
          path: journalRel,
          content: await Bun.file(journalAbs).text(),
          exists: true,
        }
      : { path: journalRel, content: "", exists: false };

    const notes = await fm.listNotes();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const recent_notes: any[] = [];
    const open_threads: any[] = [];
    const active_memories: any[] = [];

    for (const n of notes) {
      const raw = await fm.readRaw(n.path);
      if (!raw) continue;
      const { frontmatter, body } = parseFrontmatter(raw);

      // YAML parser returns Date for timestamp values; coerce to ISO string
      // so lexical comparisons against `cutoff` don't fall through to NaN.
      const rawModified = frontmatter.modified ?? n.modified ?? null;
      const modified =
        rawModified instanceof Date
          ? rawModified.toISOString()
          : typeof rawModified === "string" && rawModified
            ? new Date(rawModified).toISOString()
            : new Date(0).toISOString();

      if (n.path.startsWith("notes/threads/") && frontmatter.kind === "thread") {
        const status = (frontmatter.status as string) ?? "open";
        if (["open", "in-progress", "blocked"].includes(status)) {
          open_threads.push({
            slug: n.path
              .replace(/^notes\/threads\//, "")
              .replace(/\.md$/, ""),
            title: frontmatter.title,
            status,
            priority: (frontmatter.priority as number) ?? 1,
            last_run: frontmatter.last_run ?? null,
            prompt: frontmatter.prompt ?? null,
            path: n.path,
          });
        }
      } else if (
        n.path.startsWith("memory/") &&
        frontmatter.kind === "memory"
      ) {
        const active = frontmatter.active !== false;
        if (active) {
          active_memories.push({
            slug: n.path.replace(/^memory\//, "").replace(/\.md$/, ""),
            title: frontmatter.title,
            category: frontmatter.category ?? "interest",
            priority: (frontmatter.priority as number) ?? 1,
            content: body,
          });
        }
      } else if (modified >= cutoff && !n.path.startsWith("journal/")) {
        const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
        recent_notes.push({
          path: n.path,
          title: frontmatter.title ?? n.title,
          modified,
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
          snippet,
        });
      }
    }

    recent_notes.sort((a, b) => b.modified.localeCompare(a.modified));
    open_threads.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a.last_run ?? "").localeCompare(b.last_run ?? "");
    });
    active_memories.sort((a, b) => b.priority - a.priority);

    const tag_cloud = indexer.getTags().slice(0, 20);

    return Response.json({
      generated_at: now.toISOString(),
      today: { date, journal },
      recent_notes: recent_notes.slice(0, 20),
      open_threads,
      active_memories,
      tag_cloud,
    });
  });
}
