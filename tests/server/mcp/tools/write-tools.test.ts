// tests/server/mcp/tools/write-tools.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
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
        confidence: "inferred",
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
      confidence: "inferred",
      reason: "because tests",
    });
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
          confidence: "extracted",
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
          confidence: "inferred",
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
        confidence: "inferred",
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
