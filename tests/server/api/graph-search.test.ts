// tests/server/api/graph-search.test.ts
//
// G5: end-to-end smoke for GET /api/graph/search wired through Router.
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../src/server/db";
import { graphRoutes } from "../../../src/server/api/graph";
import { SnapshotScheduler } from "../../../src/server/graph/snapshot-scheduler";
import { Router } from "../../../src/server/router";

function seedNote(
  db: Database,
  path: string,
  title: string,
  body: string,
): number {
  db.query(
    `INSERT INTO notes (path, title, content_hash) VALUES (?, ?, ?)`,
  ).run(path, title, "h");
  const id = Number(
    (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
  db.query(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
  ).run(path, title, path);
  db.query(
    `INSERT INTO notes_fts (rowid, title, content, path, summary, entities, themes, edge_reasons)
     VALUES (?, ?, ?, ?, '', '', '', '')`,
  ).run(id, title, body, path);
  return id;
}

function seedEdge(db: Database, source: string, target: string) {
  db.query(
    `INSERT INTO graph_edges (source, target, tier, weight, reason)
     VALUES (?, ?, 'mentions', 1.0, NULL)`,
  ).run(source, target);
}

describe("GET /api/graph/search", () => {
  let db: Database;
  let router: Router;
  let vaultDir: string;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-graphsearch-"));
    const sched = new SnapshotScheduler(db, vaultDir, { debounceMs: 10 });
    graphRoutes(router = new Router(), db, vaultDir, sched);
  });

  test("happy path: { hits: [...] } shape with score/fts_rank fields", async () => {
    seedNote(db, "a.md", "Alpha", "alpha foo bar");
    seedNote(db, "b.md", "Beta", "beta only");
    seedEdge(db, "a.md", "b.md");
    const res = await router.handle(
      new Request("http://x/api/graph/search?q=foo"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hits: Array<{
        path: string;
        title: string;
        score: number;
        fts_rank: number | null;
        sem_rank: number | null;
        hop_distance: number | null;
      }>;
    };
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
    const top = body.hits[0]!;
    expect(top.path).toBe("a.md");
    expect(typeof top.score).toBe("number");
    expect(top.fts_rank).toBe(1);
    expect(top.sem_rank).toBe(null);
    expect(top.hop_distance).toBe(null);
  });

  test("400 on missing q", async () => {
    const res = await router.handle(
      new Request("http://x/api/graph/search"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(400);
  });

  test("focus param computes hop_distance via snapshot BFS", async () => {
    seedNote(db, "focus.md", "F", "alpha");
    seedNote(db, "near.md", "N", "alpha foo");
    seedNote(db, "far.md", "Far", "alpha foo");
    seedEdge(db, "focus.md", "near.md");
    const res = await router.handle(
      new Request("http://x/api/graph/search?q=foo&focus=focus.md"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hits: Array<{ path: string; hop_distance: number | null }>;
    };
    const near = body.hits.find((h) => h.path === "near.md");
    const far = body.hits.find((h) => h.path === "far.md");
    expect(near?.hop_distance).toBe(1);
    expect(far?.hop_distance).toBe(null);
  });
});
