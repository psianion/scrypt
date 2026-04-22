// tests/server/db/fts5-widen.test.ts
//
// G4: notes_fts indexes (title, content, path, summary, entities, themes,
// edge_reasons). Searches now hit notes whose match lives only in metadata
// or in an edge's reason field. refreshNoteFts is called from MCP write
// tools so the index stays consistent across mutations.
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { SectionsRepo } from "../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../src/server/embeddings/progress";
import { Idempotency } from "../../../src/server/mcp/idempotency";
import { updateNoteMetadataTool } from "../../../src/server/mcp/tools/update-note-metadata";
import { addEdgeTool } from "../../../src/server/mcp/tools/add-edge";
import { removeEdgeTool } from "../../../src/server/mcp/tools/remove-edge";
import type { ToolContext } from "../../../src/server/mcp/types";
import type { EngineLike } from "../../../src/server/embeddings/service";

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
      embedNote: async () => ({
        chunks_total: 0,
        chunks_embedded: 0,
        embed_ms: 0,
      }),
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

function seedNote(db: Database, path: string, title: string, body: string): number {
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

function pathsFor(db: Database, query: string): string[] {
  return (
    db
      .query<{ path: string }, [string]>(
        `SELECT path FROM notes_fts WHERE notes_fts MATCH ? ORDER BY path`,
      )
      .all(query)
  ).map((r) => r.path);
}

describe("FTS5 widening (G4)", () => {
  test("schema exposes summary, entities, themes, edge_reasons columns", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = (
      db.query("PRAGMA table_info(notes_fts)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("title");
    expect(cols).toContain("content");
    expect(cols).toContain("path");
    expect(cols).toContain("summary");
    expect(cols).toContain("entities");
    expect(cols).toContain("themes");
    expect(cols).toContain("edge_reasons");
  });

  test("legacy 3-column notes_fts gets rebuilt on init", () => {
    const db = new Database(":memory:");
    db.run(
      `CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, path)`,
    );
    initSchema(db);
    const cols = (
      db.query("PRAGMA table_info(notes_fts)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("summary");
    expect(cols).toContain("edge_reasons");
  });
});

describe("FTS5 widening — metadata-only matches", () => {
  let ctx: ToolContext;
  let db: Database;
  beforeEach(() => {
    ({ ctx, db } = makeCtx());
  });

  test("search hits a note whose summary mentions the term but body doesn't", async () => {
    seedNote(db, "a.md", "A", "lorem ipsum dolor");
    await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "a.md",
        summary: "this note is about graphify research",
        client_tag: "u1",
      },
      "c1",
    );
    expect(pathsFor(db, "graphify")).toContain("a.md");
  });

  test("search hits a note via entities flattened to text", async () => {
    seedNote(db, "b.md", "B", "unrelated body");
    await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "b.md",
        entities: [
          { name: "Foundry VTT", kind: "tool" },
          { name: "Ironsworn", kind: "system" },
        ],
        client_tag: "u2",
      },
      "c2",
    );
    expect(pathsFor(db, "Foundry")).toContain("b.md");
    expect(pathsFor(db, "Ironsworn")).toContain("b.md");
  });

  test("search hits a note via themes joined as text", async () => {
    seedNote(db, "c.md", "C", "body");
    await updateNoteMetadataTool.handler(
      ctx,
      {
        path: "c.md",
        themes: ["combat-encounters", "downtime"],
        client_tag: "u3",
      },
      "c3",
    );
    expect(pathsFor(db, "downtime")).toContain("c.md");
  });

  test("update_note_metadata refreshes the FTS5 row when summary changes", async () => {
    seedNote(db, "d.md", "D", "body");
    await updateNoteMetadataTool.handler(
      ctx,
      { path: "d.md", summary: "first version about alpha", client_tag: "u4" },
      "c4",
    );
    expect(pathsFor(db, "alpha")).toContain("d.md");
    await updateNoteMetadataTool.handler(
      ctx,
      { path: "d.md", summary: "second version about beta", client_tag: "u5" },
      "c5",
    );
    expect(pathsFor(db, "alpha")).not.toContain("d.md");
    expect(pathsFor(db, "beta")).toContain("d.md");
  });
});

describe("FTS5 widening — edge.reason matches", () => {
  let ctx: ToolContext;
  let db: Database;
  beforeEach(() => {
    ({ ctx, db } = makeCtx());
  });

  test("add_edge with reason makes both endpoints findable by reason text", async () => {
    seedNote(db, "x.md", "X", "x body");
    seedNote(db, "y.md", "Y", "y body");
    await addEdgeTool.handler(
      ctx,
      {
        source: "x.md",
        target: "y.md",
        tier: "mentions",
        reason: "similar to graphify spec",
        client_tag: "e1",
      },
      "c6",
    );
    const hits = pathsFor(db, "graphify");
    expect(hits).toContain("x.md");
    expect(hits).toContain("y.md");
  });

  test("remove_edge clears the reason text from both endpoints' FTS index", async () => {
    seedNote(db, "p.md", "P", "p body");
    seedNote(db, "q.md", "Q", "q body");
    await addEdgeTool.handler(
      ctx,
      {
        source: "p.md",
        target: "q.md",
        tier: "mentions",
        reason: "shares the keyword zorblax",
        client_tag: "e2",
      },
      "c7",
    );
    expect(pathsFor(db, "zorblax").sort()).toEqual(["p.md", "q.md"]);
    await removeEdgeTool.handler(
      ctx,
      {
        source: "p.md",
        target: "q.md",
        tier: "mentions",
        client_tag: "e3",
      },
      "c8",
    );
    expect(pathsFor(db, "zorblax")).toEqual([]);
  });
});
