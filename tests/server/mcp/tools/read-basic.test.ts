// tests/server/mcp/tools/read-basic.test.ts
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { getNoteTool } from "../../../../src/server/mcp/tools/get-note";
import { searchNotesTool } from "../../../../src/server/mcp/tools/search-notes";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

function makeStubEngine(): EngineLike {
  return {
    model: "stub",
    batchSize: 1,
    async embedBatch() {
      return [];
    },
  };
}

describe("get_note + search_notes", () => {
  let ctx: ToolContext;
  let vaultDir: string;
  let db: Database;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-getnote-"));
    db = new Database(":memory:");
    initSchema(db);
    ctx = {
      db,
      sections: new SectionsRepo(db),
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings: new ChunkEmbeddingsRepo(db),
      embedService: {} as unknown as ToolContext["embedService"],
      engine: makeStubEngine(),
      bus: new ProgressBus(),
      idempotency: new Idempotency(db),
      userId: null,
      vaultDir,
    };

    const content = `---
title: Hello
---

## Alpha

alpha body
`;
    mkdirSync(join(vaultDir, "notes"), { recursive: true });
    writeFileSync(join(vaultDir, "notes/hi.md"), content, "utf8");
    db.query(
      `INSERT INTO notes (path, title, content_hash) VALUES ('notes/hi.md', 'Hello', 'h')`,
    ).run();
    const noteId = db
      .query<{ id: number }, []>(`SELECT id FROM notes WHERE path = 'notes/hi.md'`)
      .get()!.id;
    db.query(
      `INSERT INTO notes_fts (rowid, title, content, path) VALUES (?, 'Hello', 'alpha body body', 'notes/hi.md')`,
    ).run(noteId);
    db.query(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('notes/hi.md', 'note', 'Hello', 'notes/hi.md')`,
    ).run();
    ctx.sections.replaceNoteSections("notes/hi.md", [
      {
        id: "notes_hi_md:alpha",
        headingSlug: "alpha",
        headingText: "Alpha",
        level: 2,
        startLine: 4,
        endLine: 6,
      },
    ]);
    ctx.metadata.upsert("notes/hi.md", { description: "greeting" });
    db.query(
      `INSERT INTO graph_edges (source, target, relation) VALUES ('notes/hi.md', 'other.md', 'wikilink')`,
    ).run();
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  test("get_note returns content, frontmatter, sections, metadata", async () => {
    const r = await getNoteTool.handler(ctx, { path: "notes/hi.md" }, "c");
    expect(r.path).toBe("notes/hi.md");
    expect((r.frontmatter as { title: string }).title).toBe("Hello");
    expect(r.body).toContain("alpha body");
    expect(r.sections.length).toBe(1);
    expect(r.metadata?.description).toBe("greeting");
    expect(r.outgoing_edges.length).toBe(1);
    expect(r.outgoing_edges[0].target).toBe("other.md");
  });

  test("get_note 404 for missing note", async () => {
    let caught: unknown = null;
    try {
      await getNoteTool.handler(ctx, { path: "missing.md" }, "c");
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("get_note rejects ../ path traversal outside the vault", async () => {
    const secretDir = mkdtempSync(join(tmpdir(), "scrypt-secret-"));
    writeFileSync(join(secretDir, "leak.md"), "TOP SECRET", "utf8");
    try {
      const escaped = join("..", "..", "..", secretDir, "leak.md");
      let caught: unknown = null;
      try {
        await getNoteTool.handler(ctx, { path: escaped }, "c");
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });

  test("search_notes returns FTS5 hits", async () => {
    const r = await searchNotesTool.handler(
      ctx,
      { query: "alpha" },
      "c",
    );
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].path).toBe("notes/hi.md");
    expect(r.results[0].snippet).toContain("alpha");
  });
});
