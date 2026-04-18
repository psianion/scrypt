// tests/server/mcp/tools/write-tools.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { updateNoteMetadataTool } from "../../../../src/server/mcp/tools/update-note-metadata";
import { addSectionSummaryTool } from "../../../../src/server/mcp/tools/add-section-summary";
import { addEdgeTool } from "../../../../src/server/mcp/tools/add-edge";
import { removeEdgeTool } from "../../../../src/server/mcp/tools/remove-edge";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

describe("Wave 8 write tools", () => {
  let ctx: ToolContext;
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    const stubEngine: EngineLike = {
      model: "stub",
      batchSize: 1,
      async embedBatch() {
        return [];
      },
    };
    ctx = {
      db,
      sections: new SectionsRepo(db),
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings: new ChunkEmbeddingsRepo(db),
      embedService: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        embedNote: async () => ({ chunks_total: 0, chunks_embedded: 0, embed_ms: 0 }),
      } as unknown as ToolContext["embedService"],
      engine: stubEngine,
      bus: new ProgressBus(),
      idempotency: new Idempotency(db),
      userId: "u1",
      vaultDir: "/tmp/vault",
      scheduleGraphRebuild: () => {},
    };
    ctx.sections.replaceNoteSections("a.md", [
      {
        id: "a_md:intro",
        headingSlug: "intro",
        headingText: "Intro",
        level: 2,
        startLine: 0,
        endLine: 5,
      },
    ]);
    db.query(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
         ('a.md', 'note', 'A', 'a.md'),
         ('b.md', 'note', 'B', 'b.md')`,
    ).run();
  });

  test("update_note_metadata persists fields", async () => {
    const r = await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "a.md",
        description: "about A",
        auto_tags: ["x", "y"],
        themes: ["topic1"],
        client_tag: "m1",
      },
      "c",
    );
    expect(r.updated_fields.sort()).toEqual([
      "auto_tags",
      "description",
      "themes",
    ]);
    const m = ctx.metadata.get("a.md");
    expect(m?.description).toBe("about A");
    expect(m?.auto_tags).toEqual(["x", "y"]);
  });

  test("update_note_metadata persists doc_type and summary round-trip", async () => {
    const r = await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "a.md",
        doc_type: "plan",
        summary: "short paragraph",
        client_tag: "m-docsum",
      },
      "c",
    );
    expect(r.updated_fields.sort()).toEqual(["doc_type", "summary"]);
    const m = ctx.metadata.get("a.md");
    expect(m?.doc_type).toBe("plan");
    expect(m?.summary).toBe("short paragraph");
  });

  test("update_note_metadata rejects invalid doc_type enum", async () => {
    let caught: unknown = null;
    try {
      await updateNoteMetadataTool.handler(
        ctx,
        {
          path: "a.md",
          // @ts-expect-error — intentionally invalid
          doc_type: "bogus",
          client_tag: "m-bad-type",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("update_note_metadata rejects summary longer than 1000 chars", async () => {
    const long = "x".repeat(1001);
    let caught: unknown = null;
    try {
      await updateNoteMetadataTool.handler(
        ctx,
        { path: "a.md", summary: long, client_tag: "m-long" },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("update_note_metadata partial doc_type leaves other fields intact", async () => {
    await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "a.md",
        description: "about A",
        auto_tags: ["x"],
        themes: ["t"],
        summary: "initial",
        client_tag: "m-seed",
      },
      "c",
    );
    await updateNoteMetadataTool.handler(
      ctx,
      { path: "a.md", doc_type: "architecture", client_tag: "m-type-only" },
      "c",
    );
    const m = ctx.metadata.get("a.md");
    expect(m?.doc_type).toBe("architecture");
    expect(m?.summary).toBe("initial");
    expect(m?.description).toBe("about A");
    expect(m?.auto_tags).toEqual(["x"]);
    expect(m?.themes).toEqual(["t"]);
  });

  test("update_note_metadata errors on missing note", async () => {
    let caught: unknown = null;
    try {
      await updateNoteMetadataTool.handler(
        ctx,
        { path: "nope.md", description: "x", client_tag: "m-missing" },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("add_section_summary sets summary on an existing section", async () => {
    const r = await addSectionSummaryTool.handler(
      ctx,
      {
        note_path: "a.md",
        heading_id: "a_md:intro",
        summary: "intro one-liner",
        client_tag: "s1",
      },
      "c",
    );
    expect(r.section_id).toBe("a_md:intro");
    expect(ctx.sections.getById("a_md:intro")?.summary).toBe(
      "intro one-liner",
    );
  });

  test("add_section_summary errors on missing section", async () => {
    let caught: unknown = null;
    try {
      await addSectionSummaryTool.handler(
        ctx,
        {
          note_path: "a.md",
          heading_id: "a_md:missing",
          summary: "x",
          client_tag: "s2",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("add_edge inserts a semantic edge", async () => {
    const r = await addEdgeTool.handler(
      ctx,
      {
        source: "a.md",
        target: "b.md",
        relation: "elaborates",
        confidence: "mentions",
        reason: "because tests",
        client_tag: "e1",
      },
      "c",
    );
    expect(r.edge_id).toBeGreaterThan(0);
    const rows = ctx.db
      .query<
        { relation: string; confidence: string; reason: string },
        []
      >(`SELECT relation, confidence, reason FROM graph_edges`)
      .all();
    expect(rows[0]).toEqual({
      relation: "elaborates",
      confidence: "mentions",
      reason: "because tests",
    });
  });

  test("add_edge accepts all three new-tier confidence values", async () => {
    for (const [i, conf] of [
      "connected",
      "mentions",
      "semantically_related",
    ].entries()) {
      await addEdgeTool.handler(
        ctx,
        {
          source: "a.md",
          target: "b.md",
          relation: `rel_${i}`,
          // @ts-expect-error — test enum literal widening
          confidence: conf,
          client_tag: `tier-${conf}`,
        },
        "c",
      );
    }
    const confs = ctx.db
      .query<{ confidence: string }, []>(
        `SELECT confidence FROM graph_edges ORDER BY id`,
      )
      .all()
      .map((r) => r.confidence);
    expect(confs).toEqual(["connected", "mentions", "semantically_related"]);
  });

  test("add_edge rejects legacy confidence values (extracted/inferred/ambiguous)", async () => {
    for (const legacy of ["extracted", "inferred", "ambiguous"]) {
      let caught: unknown = null;
      try {
        await addEdgeTool.handler(
          ctx,
          {
            source: "a.md",
            target: "b.md",
            relation: "elaborates",
            // @ts-expect-error — intentional legacy value
            confidence: legacy,
            client_tag: `legacy-${legacy}`,
          },
          "c",
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
    }
  });

  test("add_edge rejects unknown confidence strings with INVALID_PARAMS", async () => {
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "a.md",
          target: "b.md",
          relation: "elaborates",
          // @ts-expect-error — intentional invalid value
          confidence: "speculative",
          client_tag: "e-bogus",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("add_edge rejects reserved structural relations", async () => {
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "a.md",
          target: "b.md",
          relation: "wikilink",
          confidence: "connected",
          client_tag: "e2",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.CONFLICT });
  });

  test("add_edge errors when endpoint missing", async () => {
    let caught: unknown = null;
    try {
      await addEdgeTool.handler(
        ctx,
        {
          source: "a.md",
          target: "nope.md",
          relation: "elaborates",
          confidence: "mentions",
          client_tag: "e3",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("remove_edge deletes matching semantic edges only", async () => {
    await addEdgeTool.handler(
      ctx,
      {
        source: "a.md",
        target: "b.md",
        relation: "elaborates",
        confidence: "mentions",
        client_tag: "r-setup",
      },
      "c",
    );
    ctx.db
      .query(
        `INSERT INTO graph_edges (source, target, relation) VALUES ('a.md', 'b.md', 'wikilink')`,
      )
      .run();

    const r = await removeEdgeTool.handler(
      ctx,
      { source: "a.md", target: "b.md", client_tag: "r1" },
      "c",
    );
    expect(r.removed).toBe(1);
    const rest = ctx.db
      .query<{ relation: string }, []>(`SELECT relation FROM graph_edges`)
      .all();
    expect(rest.map((x) => x.relation)).toEqual(["wikilink"]);
  });
});
