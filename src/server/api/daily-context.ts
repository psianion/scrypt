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

    const related = await buildRelatedBundle({
      fm,
      journalRel,
      now,
    });

    return Response.json({
      generated_at: now.toISOString(),
      today: { date, journal },
      recent_notes: recent_notes.slice(0, 20),
      open_threads,
      active_memories,
      tag_cloud,
      related,
    });
  });
}

interface RelatedBundle {
  notes: Array<{ path: string; title: string; modified: string }>;
  memories: Array<{ path: string; title: string }>;
  draft_prompts: Array<{ path: string; title: string; created: string | null }>;
}

async function buildRelatedBundle(args: {
  fm: FileManager;
  journalRel: string;
  now: Date;
}): Promise<RelatedBundle> {
  const { fm, journalRel, now } = args;

  let todayDomain: string | null = null;
  const todayTags = new Set<string>();
  const todayRaw = await fm.readRaw(journalRel);
  if (todayRaw) {
    const { meta } = parseFrontmatter(todayRaw);
    todayDomain = meta.domain;
    for (const t of meta.topicTags) todayTags.add(t);
    for (const t of meta.identifierTags) todayTags.add(`${t.namespace}:${t.value}`);
  }

  const weekAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const allNotes = await fm.listNotes();

  const notes: RelatedBundle["notes"] = [];
  const memories: RelatedBundle["memories"] = [];
  const draftCandidates: Array<{
    path: string;
    title: string;
    created: string | null;
  }> = [];

  for (const n of allNotes) {
    const raw = await fm.readRaw(n.path);
    if (!raw) continue;
    const { frontmatter, meta } = parseFrontmatter(raw);
    const fmTags = new Set<string>([
      ...meta.topicTags,
      ...meta.identifierTags.map((t) => `${t.namespace}:${t.value}`),
    ]);
    const domain = meta.domain;

    // related.notes: last 7 days, domain match OR tag overlap, non-journal/memory
    if (
      notes.length < 5 &&
      !n.path.startsWith("journal/") &&
      !n.path.startsWith("memory/") &&
      n.modified &&
      n.modified >= weekAgoIso
    ) {
      const domainMatch = todayDomain !== null && domain === todayDomain;
      const tagOverlap = [...fmTags].some((t) => todayTags.has(t));
      if (domainMatch || tagOverlap) {
        notes.push({
          path: n.path,
          title: n.title ?? n.path,
          modified: n.modified,
        });
      }
    }

    // related.memories: active memory notes whose tags overlap today's
    if (
      memories.length < 3 &&
      n.path.startsWith("memory/") &&
      frontmatter.active !== false
    ) {
      const overlaps = [...fmTags].some((t) => todayTags.has(t));
      if (overlaps) {
        memories.push({ path: n.path, title: n.title ?? n.path });
      }
    }

    // related.draft_prompts: stage:draft in active domain
    if (fmTags.has("stage:draft")) {
      if (!todayDomain || domain === todayDomain) {
        const created =
          typeof frontmatter.created === "string"
            ? frontmatter.created
            : frontmatter.created instanceof Date
              ? frontmatter.created.toISOString()
              : null;
        draftCandidates.push({
          path: n.path,
          title: n.title ?? n.path,
          created,
        });
      }
    }
  }

  draftCandidates.sort((a, b) =>
    String(a.created ?? "").localeCompare(String(b.created ?? "")),
  );
  const draft_prompts = draftCandidates.slice(0, 3);

  return { notes, memories, draft_prompts };
}
