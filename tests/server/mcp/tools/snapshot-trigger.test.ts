// tests/server/mcp/tools/snapshot-trigger.test.ts
//
// Behavioural guarantee: every MCP write tool fires the snapshot rebuild
// hook (ctx.scheduleGraphRebuild → SnapshotScheduler.schedule). Without
// this trigger the live graph silently goes stale after every write,
// which is the load-bearing claim of the snapshot architecture.
//
// The test wires a real SnapshotScheduler with an injected writer that
// only counts invocations, exposes scheduleGraphRebuild as a spy that
// also bumps a counter, and runs each write tool with the smallest
// realistic input that still lets it succeed. The negative test
// confirms read-only tools never call the spy.
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { SnapshotScheduler } from "../../../../src/server/graph/snapshot-scheduler";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";

import { createNoteTool } from "../../../../src/server/mcp/tools/create-note";
import { addEdgeTool } from "../../../../src/server/mcp/tools/add-edge";
import { removeEdgeTool } from "../../../../src/server/mcp/tools/remove-edge";
import { updateNoteMetadataTool } from "../../../../src/server/mcp/tools/update-note-metadata";
import { rescanSimilarityTool } from "../../../../src/server/mcp/tools/rescan-similarity";
import { clusterGraphTool } from "../../../../src/server/mcp/tools/cluster-graph";
import { batchIngestTool } from "../../../../src/server/mcp/tools/batch-ingest";
import { getNoteTool } from "../../../../src/server/mcp/tools/get-note";
import { searchNotesTool } from "../../../../src/server/mcp/tools/search-notes";
import { walkGraphTool } from "../../../../src/server/mcp/tools/walk-graph";

interface SpyScheduler {
  scheduler: SnapshotScheduler;
  scheduleCalls: { tag: string }[];
  writerCalls: number;
  reset(): void;
}

function makeSpyScheduler(db: Database, vaultDir: string): SpyScheduler {
  let writerCalls = 0;
  const scheduler = new SnapshotScheduler(db, vaultDir, {
    // Tiny debounce keeps the schedule->writer leg fast inside flushNow().
    debounceMs: 1,
    writer: async () => {
      writerCalls += 1;
    },
  });
  const scheduleCalls: { tag: string }[] = [];
  // Wrap schedule() so we can record every invocation regardless of
  // debouncing. The underlying scheduler still runs normally.
  const realSchedule = scheduler.schedule.bind(scheduler);
  scheduler.schedule = () => {
    scheduleCalls.push({ tag: new Error().stack?.split("\n")[2] ?? "" });
    realSchedule();
  };
  return {
    scheduler,
    scheduleCalls,
    get writerCalls() {
      return writerCalls;
    },
    reset() {
      scheduleCalls.length = 0;
      writerCalls = 0;
    },
  } as SpyScheduler;
}

class StubEngine implements EngineLike {
  model = "stub";
  batchSize = 1;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

interface Harness {
  ctx: ToolContext;
  spy: SpyScheduler;
  vaultDir: string;
  db: Database;
}

function buildHarness(): Harness {
  const vaultDir = mkdtempSync(join(tmpdir(), "scrypt-snap-trigger-"));
  const db = new Database(":memory:");
  initSchema(db);
  const spy = makeSpyScheduler(db, vaultDir);
  const ctx: ToolContext = {
    db,
    sections: new SectionsRepo(db),
    metadata: new MetadataRepo(db),
    tasks: new TasksRepo(db),
    embeddings: new ChunkEmbeddingsRepo(db),
    embedService: {
      embedNote: async () => ({
        chunks_total: 0,
        chunks_embedded: 0,
        embed_ms: 0,
      }),
    } as unknown as ToolContext["embedService"],
    engine: new StubEngine(),
    bus: new ProgressBus(),
    idempotency: new Idempotency(db),
    userId: "u1",
    vaultDir,
    scheduleGraphRebuild: () => spy.scheduler.schedule(),
  };
  return { ctx, spy, vaultDir, db };
}

describe("MCP write tools trigger snapshot rebuild", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    rmSync(h.vaultDir, { recursive: true, force: true });
  });

  test("create_note schedules a rebuild", async () => {
    h.spy.reset();
    await createNoteTool.handler(
      h.ctx,
      {
        path: "n1.md",
        content: "# N1\n\nbody\n",
        client_tag: "create-1",
      },
      "corr-create",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("add_edge schedules a rebuild", async () => {
    // Seed two endpoints so the handler reaches the schedule call.
    h.db
      .query(
        `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
           ('a.md', 'note', 'A', 'a.md'),
           ('b.md', 'note', 'B', 'b.md')`,
      )
      .run();
    h.spy.reset();
    await addEdgeTool.handler(
      h.ctx,
      {
        source: "a.md",
        target: "b.md",
        relation: "elaborates",
        confidence: "mentions",
        client_tag: "edge-1",
      },
      "corr-edge",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("remove_edge schedules a rebuild", async () => {
    h.db
      .query(
        `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
           ('a.md', 'note', 'A', 'a.md'),
           ('b.md', 'note', 'B', 'b.md')`,
      )
      .run();
    await addEdgeTool.handler(
      h.ctx,
      {
        source: "a.md",
        target: "b.md",
        relation: "elaborates",
        confidence: "mentions",
        client_tag: "edge-setup",
      },
      "corr-setup",
    );
    h.spy.reset();
    await removeEdgeTool.handler(
      h.ctx,
      { source: "a.md", target: "b.md", client_tag: "rm-1" },
      "corr-rm",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("update_note_metadata schedules a rebuild", async () => {
    h.db
      .query(
        `INSERT INTO graph_nodes (id, kind, label, note_path)
         VALUES ('a.md', 'note', 'A', 'a.md')`,
      )
      .run();
    h.spy.reset();
    await updateNoteMetadataTool.handler(
      h.ctx,
      {
        path: "a.md",
        description: "hello",
        client_tag: "meta-1",
      },
      "corr-meta",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("rescan_similarity schedules a rebuild", async () => {
    // The schedule() call lives after an early-return for fewer than 2
    // embedded notes — so we must seed two real embeddings via the repo
    // (it owns the BLOB packing for `vector`).
    const model = "test-model";
    process.env.SCRYPT_EMBED_MODEL = model;
    const insertNode = h.db.prepare(
      `INSERT INTO graph_nodes (id, kind, label, note_path)
       VALUES (?, 'note', ?, ?)`,
    );
    insertNode.run("a.md", "A", "a.md");
    insertNode.run("b.md", "B", "b.md");
    const v = new Float32Array([1, 0, 0]);
    h.ctx.embeddings.upsert({
      note_path: "a.md",
      chunk_id: "a:0",
      chunk_text: "x",
      start_line: 0,
      end_line: 1,
      model,
      dims: 3,
      vector: v,
      content_hash: "ha",
    });
    h.ctx.embeddings.upsert({
      note_path: "b.md",
      chunk_id: "b:0",
      chunk_text: "x",
      start_line: 0,
      end_line: 1,
      model,
      dims: 3,
      vector: v,
      content_hash: "hb",
    });
    h.spy.reset();
    await rescanSimilarityTool.handler(
      h.ctx,
      { min_similarity: 0.5, model },
      "corr-rescan",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("cluster_graph schedules a rebuild", async () => {
    const insertNode = h.db.prepare(
      `INSERT INTO graph_nodes (id, kind, label, note_path)
       VALUES (?, 'note', ?, ?)`,
    );
    const insertEdge = h.db.prepare(
      `INSERT INTO graph_edges (source, target, relation)
       VALUES (?, ?, 'wikilink')`,
    );
    for (const n of ["a", "b", "c"]) insertNode.run(n, n, n);
    insertEdge.run("a", "b");
    insertEdge.run("b", "c");
    h.spy.reset();
    await clusterGraphTool.handler(h.ctx, {}, "corr-cluster");
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("batch_ingest schedules a rebuild", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "scrypt-snap-src-"));
    try {
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(
        join(sourceDir, "one.md"),
        "# One\n\nfirst body\n",
        "utf8",
      );
      writeFileSync(
        join(sourceDir, "two.md"),
        "# Two\n\nsecond body\n",
        "utf8",
      );
      h.spy.reset();
      await batchIngestTool.handler(
        h.ctx,
        { source_dir: sourceDir, domain: "test", target_prefix: "research" },
        "corr-batch",
      );
      expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test("scheduled rebuilds reach the writer when flushed", async () => {
    // End-to-end: prove the spy isn't merely intercepting — the real
    // SnapshotScheduler underneath does fire its writer when flushed.
    h.spy.reset();
    await createNoteTool.handler(
      h.ctx,
      { path: "flush.md", content: "# F\n", client_tag: "flush-1" },
      "corr-flush",
    );
    expect(h.spy.scheduleCalls.length).toBeGreaterThanOrEqual(1);
    await h.spy.scheduler.flushNow();
    expect(h.spy.writerCalls).toBeGreaterThanOrEqual(1);
  });

  test("read tools (get_note, search_notes, walk_graph) do NOT schedule rebuilds", async () => {
    // Seed a real on-disk note so get_note succeeds.
    const noteRel = "r.md";
    const noteAbs = join(h.vaultDir, noteRel);
    writeFileSync(noteAbs, "# R\n\nbody\n", "utf8");
    h.db
      .query(
        `INSERT INTO graph_nodes (id, kind, label, note_path)
         VALUES ('r.md', 'note', 'R', 'r.md')`,
      )
      .run();
    // Seed FTS rows so search_notes returns something (it would otherwise
    // run a query but still must not schedule).
    h.db
      .query(
        `INSERT INTO notes (path, title, content_hash) VALUES ('r.md', 'R', 'h')`,
      )
      .run();
    h.db
      .query(
        `INSERT INTO notes_fts (rowid, title, content, path)
         VALUES ((SELECT id FROM notes WHERE path='r.md'), 'R', 'body', 'r.md')`,
      )
      .run();

    h.spy.reset();
    await getNoteTool.handler(h.ctx, { path: noteRel }, "corr-read-1");
    await searchNotesTool.handler(
      h.ctx,
      { query: "body" },
      "corr-read-2",
    );
    await walkGraphTool.handler(h.ctx, { from: "r.md" }, "corr-read-3");
    expect(h.spy.scheduleCalls.length).toBe(0);
  });
});
