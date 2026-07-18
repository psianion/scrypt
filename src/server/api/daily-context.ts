// src/server/api/daily-context.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { parseFrontmatter } from "../parsers";
import { todayKey, nowIso } from "../../shared/date";

export function dailyContextRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  vaultPath: string,
  db: Database,
): void {
  const handler = async () => {
    const date = todayKey();
    const journalRel = `journal/${date}.md`;
    const journalAbs = join(vaultPath, journalRel);

    const journal = existsSync(journalAbs)
      ? {
          path: journalRel,
          content: await Bun.file(journalAbs).text(),
          exists: true,
        }
      : { path: journalRel, content: "", exists: false };

    // Candidate list comes from the index DB, NOT fm.listNotes(): listNotes reads
    // and parses EVERY vault file, which made this route O(vault) disk I/O per
    // request (10s+ for ~1000 notes on a Docker Desktop bind mount — probes saw
    // scrypt as permanently down). The indexer keeps `notes` current via the
    // file watcher, so the DB view is as fresh as search already trusts.
    const notes = db
      .query("SELECT path, title, modified FROM notes")
      .all() as { path: string; title: string | null; modified: string | null }[];
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const recent_notes: any[] = [];
    const open_threads: any[] = [];
    const active_memories: any[] = [];

    for (const n of notes) {
      // Only three categories can contribute to the response: thread notes,
      // memory notes, and notes modified in the last 24h — filter BEFORE the
      // file read so only survivors cost disk I/O.
      const canContribute =
        n.path.startsWith("notes/threads/") ||
        n.path.startsWith("memory/") ||
        (!n.path.startsWith("journal/") && (n.modified ?? "") >= cutoff);
      if (!canContribute) continue;

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

    // "Related notes" moved to the journal *day bundle* (semantic, embedding-
    // based) in Task 5.3. The old tag/domain disk-walk bundle is retired.

    return Response.json({
      generated_at: nowIso(),
      today: { date, journal },
      recent_notes: recent_notes.slice(0, 20),
      open_threads,
      active_memories,
      tag_cloud,
    });
  };

  // Canonical path (hyphen). The underscore spelling is kept as an alias:
  // uxie's deployed health probe still hits /api/daily_context.
  router.get("/api/daily-context", handler);
  router.get("/api/daily_context", handler);
}

