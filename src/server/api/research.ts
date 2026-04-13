// src/server/api/research.ts
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import { IngestRouter, IngestError } from "../ingest/router";

export function researchRoutes(
  router: Router,
  db: Database,
  ingest: IngestRouter,
): void {
  router.post("/api/research_runs", async (req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    try {
      const result = await ingest.ingest({
        kind: "research_run",
        title: body.title,
        content: body.content,
        frontmatter: body.frontmatter,
      });
      return Response.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof IngestError) {
        const status =
          err.code === "bad_request"
            ? 400
            : err.code === "conflict"
              ? 409
              : err.code === "not_found"
                ? 404
                : 500;
        return Response.json(
          { error: err.message, field: err.field },
          { status },
        );
      }
      console.error("research_run internal error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  });

  router.get("/api/research_runs", (req) => {
    const url = new URL(req.url);
    const thread = url.searchParams.get("thread");
    const status = url.searchParams.get("status");
    const since = url.searchParams.get("since");
    const limitStr = url.searchParams.get("limit");
    const limit = Math.min(Number(limitStr) || 100, 500);

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (thread) {
      where.push("thread_slug = ?");
      params.push(thread);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (since) {
      where.push("started_at >= ?");
      params.push(since);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db
      .query(
        `SELECT id, thread_slug, note_path, status, started_at, completed_at, duration_ms, model, tokens_in, tokens_out, error
         FROM research_runs
         ${whereClause}
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit);
    return Response.json(rows);
  });
}
