// src/server/api/threads.ts
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import { parseFrontmatter } from "../parsers";
import { ActivityLog } from "../activity";

const ALLOWED_PATCH_FIELDS = new Set([
  "status",
  "priority",
  "prompt",
  "last_run",
  "run_count",
]);

const ALLOWED_STATUSES = new Set([
  "open",
  "in-progress",
  "resolved",
  "failed",
  "blocked",
  "paused",
  "archived",
]);

export function threadRoutes(
  router: Router,
  fm: FileManager,
  _vaultPath: string,
  activity: ActivityLog,
): void {
  async function listThreads(filters: {
    statuses?: string[];
    priority?: number;
    tag?: string;
    limit?: number;
  }) {
    const notes = await fm.listNotes();
    const threads = [];
    for (const note of notes) {
      if (!note.path.startsWith("notes/threads/")) continue;
      const raw = await fm.readRaw(note.path);
      if (!raw) continue;
      const { frontmatter } = parseFrontmatter(raw);
      if (frontmatter.kind !== "thread") continue;
      const status = (frontmatter.status as string) ?? "open";
      const priority =
        typeof frontmatter.priority === "number" ? frontmatter.priority : 1;
      if (filters.statuses && !filters.statuses.includes(status)) continue;
      if (filters.priority !== undefined && priority < filters.priority) continue;
      if (
        filters.tag &&
        !(Array.isArray(frontmatter.tags) && frontmatter.tags.includes(filters.tag))
      )
        continue;
      threads.push({
        slug: note.path
          .replace(/^notes\/threads\//, "")
          .replace(/\.md$/, ""),
        title: (frontmatter.title as string) ?? note.title,
        status,
        priority,
        prompt: frontmatter.prompt ?? null,
        last_run: frontmatter.last_run ?? null,
        run_count: (frontmatter.run_count as number | undefined) ?? 0,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        path: note.path,
        modified: frontmatter.modified ?? note.modified,
      });
    }
    threads.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (!a.last_run && b.last_run) return -1;
      if (a.last_run && !b.last_run) return 1;
      return (a.last_run ?? "").localeCompare(b.last_run ?? "");
    });
    if (filters.limit) return threads.slice(0, filters.limit);
    return threads;
  }

  router.get("/api/threads", async (req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam ? statusParam.split(",") : undefined;
    if (statuses) {
      for (const s of statuses) {
        if (!ALLOWED_STATUSES.has(s)) {
          return Response.json(
            { error: `invalid status: ${s}`, field: "status" },
            { status: 400 },
          );
        }
      }
    }
    const priority = url.searchParams.get("priority");
    const tag = url.searchParams.get("tag") || undefined;
    const limit = url.searchParams.get("limit");
    const data = await listThreads({
      statuses,
      priority: priority ? Number(priority) : undefined,
      tag,
      limit: limit ? Number(limit) : undefined,
    });
    return Response.json(data);
  });

  router.get("/api/threads/:slug", async (_req, params) => {
    const path = `notes/threads/${params.slug}.md`;
    const raw = await fm.readRaw(path);
    if (raw === null) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    return Response.json({
      slug: params.slug,
      path,
      title: frontmatter.title,
      status: frontmatter.status ?? "open",
      priority: frontmatter.priority ?? 1,
      prompt: frontmatter.prompt ?? null,
      last_run: frontmatter.last_run ?? null,
      run_count: frontmatter.run_count ?? 0,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      created: frontmatter.created,
      modified: frontmatter.modified,
      content: body,
    });
  });

  router.patch("/api/threads/:slug", async (req, params) => {
    const path = `notes/threads/${params.slug}.md`;
    const raw = await fm.readRaw(path);
    if (raw === null) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    for (const k of Object.keys(body)) {
      if (!ALLOWED_PATCH_FIELDS.has(k)) {
        return Response.json(
          { error: `unknown field: ${k}`, field: k },
          { status: 400 },
        );
      }
    }
    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return Response.json(
        { error: `invalid status: ${body.status}`, field: "status" },
        { status: 400 },
      );
    }

    const { frontmatter, body: bodyText } = parseFrontmatter(raw);
    const newFm: Record<string, unknown> = {
      ...frontmatter,
      ...body,
    };
    // FileManager.writeNote + mergeServerTimestamps owns the `modified` bump.
    await fm.writeNote(path, bodyText, newFm);

    activity.record({
      action: "update",
      kind: "thread",
      path,
      actor: "claude",
      meta: { fields: Object.keys(body) },
    });
    return Response.json({ slug: params.slug, updated: Object.keys(body) });
  });
}
