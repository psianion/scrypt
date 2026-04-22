// tests/server/mcp/tools/add-edge-reject.test.ts
//
// G3: add_edge enforces anti-connection rules at the API boundary so the DB
// only ever holds edges that will render. Each test seeds graph_nodes +
// note_metadata, then asserts the call rejects with INVALID_PARAMS and that
// no row landed in graph_edges.
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { addEdgeTool } from "../../../../src/server/mcp/tools/add-edge";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

function makeCtx(): { ctx: ToolContext; db: Database } {
  const db = new Database(":memory:");
  initSchema(db);
  const stubEngine: EngineLike = {
    model: "stub",
    batchSize: 1,
    async embedBatch() {
      return [];
    },
  };
  const ctx: ToolContext = {
    db,
    sections: new SectionsRepo(db),
    metadata: new MetadataRepo(db),
    tasks: new TasksRepo(db),
    embeddings: new ChunkEmbeddingsRepo(db),
    embedService: {
      embedNote: async () => ({ chunks_total: 0, chunks_embedded: 0, embed_ms: 0 }),
    } as unknown as ToolContext["embedService"],
    engine: stubEngine,
    bus: new ProgressBus(),
    idempotency: new Idempotency(db),
    userId: "u1",
    vaultDir: "/tmp/vault",
    scheduleGraphRebuild: () => {},
  };
  return { ctx, db };
}

function seedNote(
  db: Database,
  path: string,
  docType: string | null,
): void {
  db.query(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
  ).run(path, path, path);
  if (docType) {
    db.query(
      `INSERT INTO note_metadata (note_path, doc_type, updated_at) VALUES (?, ?, 0)`,
    ).run(path, docType);
  }
}

describe("add_edge anti-connection rules (G3)", () => {
  let ctx: ToolContext;
  let db: Database;
  beforeEach(() => {
    ({ ctx, db } = makeCtx());
  });

  test("rejects plan↔plan with tier='connected'", async () => {
    seedNote(db, "research/p/a.md", "plan");
    seedNote(db, "research/p/b.md", "plan");
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "research/p/a.md",
          target: "research/p/b.md",
          tier: "connected",
          client_tag: "pp1",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
    expect((caught as Error).message).toContain("plan");
    expect(
      db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_edges`).get()
        ?.n,
    ).toBe(0);
  });

  test("rejects plan↔plan even with tier='mentions' (rule applies regardless of tier)", async () => {
    seedNote(db, "research/p/a.md", "plan");
    seedNote(db, "research/p/b.md", "plan");
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "research/p/a.md",
          target: "research/p/b.md",
          tier: "mentions",
          client_tag: "pp2",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("rejects journal↔regular with tier='connected' (cap message)", async () => {
    seedNote(db, "research/p/j.md", "journal");
    seedNote(db, "research/p/r.md", "research");
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "research/p/j.md",
          target: "research/p/r.md",
          tier: "connected",
          client_tag: "j1",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
    expect((caught as Error).message).toContain("cap");
    expect((caught as Error).message).toContain("mentions");
  });

  test("allows journal↔regular when tier='mentions' (no cap fired)", async () => {
    seedNote(db, "research/p/j.md", "journal");
    seedNote(db, "research/p/r.md", "research");
    const r = await addEdgeTool.handler(
      ctx,
      {
        source: "research/p/j.md",
        target: "research/p/r.md",
        tier: "mentions",
        client_tag: "j2",
      },
      "c",
    );
    expect(r.edge_id).toBeGreaterThan(0);
  });

  test("rejects changelog→regular with tier='connected'", async () => {
    seedNote(db, "research/p/c.md", "changelog");
    seedNote(db, "research/p/r.md", "research");
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "research/p/c.md",
          target: "research/p/r.md",
          tier: "connected",
          client_tag: "c1",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("rejects cross-project semantically_related", async () => {
    seedNote(db, "research/x/a.md", "research");
    seedNote(db, "research/y/b.md", "research");
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "research/x/a.md",
          target: "research/y/b.md",
          tier: "semantically_related",
          client_tag: "s1",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
    expect((caught as Error).message).toContain("same project");
  });

  test("allows same-project semantically_related", async () => {
    seedNote(db, "research/x/a.md", "research");
    seedNote(db, "research/x/b.md", "research");
    const r = await addEdgeTool.handler(
      ctx,
      {
        source: "research/x/a.md",
        target: "research/x/b.md",
        tier: "semantically_related",
        client_tag: "s2",
      },
      "c",
    );
    expect(r.edge_id).toBeGreaterThan(0);
  });

  test("end-to-end: post-add_edge snapshot only contains rule-compliant edges", async () => {
    const { buildGraphSnapshot } = await import(
      "../../../../src/server/graph/snapshot"
    );
    seedNote(db, "research/p/a.md", "research");
    seedNote(db, "research/p/b.md", "research");
    seedNote(db, "research/p/j.md", "journal");
    seedNote(db, "research/p/r.md", "research");

    await addEdgeTool.handler(
      ctx,
      {
        source: "research/p/a.md",
        target: "research/p/b.md",
        tier: "connected",
        client_tag: "ee1",
      },
      "c",
    );
    await addEdgeTool.handler(
      ctx,
      {
        source: "research/p/j.md",
        target: "research/p/r.md",
        tier: "mentions",
        client_tag: "ee2",
      },
      "c",
    );

    const snap = buildGraphSnapshot(db);
    const summary = snap.edges
      .map((e) => `${e.source}->${e.target}:${e.tier}`)
      .sort();
    expect(summary).toEqual([
      "research/p/a.md->research/p/b.md:connected",
      "research/p/j.md->research/p/r.md:mentions",
    ]);
  });
});
