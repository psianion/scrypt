// tests/server/mcp/tools/walk-graph.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { walkGraphTool } from "../../../../src/server/mcp/tools/walk-graph";
import type { ToolContext } from "../../../../src/server/mcp/types";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";

describe("walk_graph", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    const db = new Database(":memory:");
    initSchema(db);
    const insertNode = db.prepare(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
    );
    for (const n of ["a.md", "b.md", "c.md", "d.md"]) {
      insertNode.run(n, n, n);
    }
    db.query(
      `INSERT INTO graph_edges (source, target, relation, confidence) VALUES
        ('a.md', 'b.md', 'elaborates', 'connected'),
        ('b.md', 'c.md', 'elaborates', 'mentions'),
        ('c.md', 'd.md', 'elaborates', 'semantically_related')`,
    ).run();
    ctx = {
      db,
      sections: new SectionsRepo(db),
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings: new ChunkEmbeddingsRepo(db),
      embedService: {} as unknown as ToolContext["embedService"],
      engine: { model: "x", batchSize: 1, async embedBatch() { return []; } },
      bus: new ProgressBus(),
      idempotency: new Idempotency(db),
      userId: null,
      vaultDir: "/tmp",
      scheduleGraphRebuild: () => {},
    };
  });

  test("BFS returns neighbors up to depth", async () => {
    const r = await walkGraphTool.handler(ctx, { from: "a.md", depth: 2 }, "c");
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["a.md", "b.md", "c.md"]);
  });

  test("depth 1 returns only direct neighbors", async () => {
    const r = await walkGraphTool.handler(ctx, { from: "a.md", depth: 1 }, "c");
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md"]);
  });

  test("confidence_min filters low-confidence edges", async () => {
    const r = await walkGraphTool.handler(
      ctx,
      { from: "a.md", depth: 3, confidence_min: "mentions" },
      "c",
    );
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toContain("c.md");
    expect(ids).not.toContain("d.md");
  });

  test("relation_filter restricts traversal", async () => {
    const r = await walkGraphTool.handler(
      ctx,
      { from: "a.md", depth: 3, relation_filter: ["cites"] },
      "c",
    );
    expect(r.nodes.map((n) => n.id)).toEqual(["a.md"]);
  });

  test("edges are deduped when traversal revisits them", async () => {
    const r = await walkGraphTool.handler(ctx, { from: "a.md", depth: 3 }, "c");
    const seen = new Set(
      r.edges.map((e) => `${e.source}|${e.target}|${e.relation}`),
    );
    expect(seen.size).toBe(r.edges.length);
    expect(r.edges.length).toBe(3);
  });
});
