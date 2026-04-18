// tests/server/mcp/tools/cluster-and-report.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { clusterGraphTool } from "../../../../src/server/mcp/tools/cluster-graph";
import { getReportTool } from "../../../../src/server/mcp/tools/get-report";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import type { ToolContext } from "../../../../src/server/mcp/types";

describe("cluster_graph + get_report", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    const db = new Database(":memory:");
    initSchema(db);
    const insertNode = db.prepare(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
    );
    for (const n of ["a1", "a2", "a3", "b1", "b2", "b3"]) {
      insertNode.run(n, n, n);
    }
    const insertEdge = db.prepare(
      `INSERT INTO graph_edges (source, target, relation) VALUES (?, ?, 'wikilink')`,
    );
    for (const [s, t] of [
      ["a1", "a2"],
      ["a2", "a3"],
      ["a3", "a1"],
      ["b1", "b2"],
      ["b2", "b3"],
      ["b3", "b1"],
    ]) {
      insertEdge.run(s, t);
    }
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
    };
  });

  test("cluster_graph reports communities", async () => {
    const r = await clusterGraphTool.handler(ctx, {}, "c");
    expect(r.communities).toBeGreaterThanOrEqual(2);
  });

  test("get_report produces markdown with hubs and communities", async () => {
    await clusterGraphTool.handler(ctx, {}, "c");
    const r = await getReportTool.handler(ctx, {}, "c");
    expect(r.markdown).toContain("# Scrypt Graph Report");
    expect(r.markdown).toMatch(/## Communities/);
    expect(r.markdown).toMatch(/## Hub Nodes/);
  });
});
