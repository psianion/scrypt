// tests/server/migrations-wave8.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../src/server/migrations/wave8";

describe("wave8 migration", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
  });

  test("creates all Wave 8 tables", () => {
    applyWave8Migration(db);

    const tables = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("note_metadata");
    expect(tables).toContain("note_sections");
    expect(tables).toContain("note_chunk_embeddings");
    expect(tables).toContain("mcp_dedup");
  });

  test("note_sections has UNIQUE(note_path, heading_slug)", () => {
    applyWave8Migration(db);

    db.run(
      `INSERT INTO note_sections
         (id, note_path, heading_slug, heading_text, level, start_line, end_line)
       VALUES ('a:h-1', 'a.md', 'h-1', 'Intro', 2, 1, 5)`,
    );

    expect(() =>
      db.run(
        `INSERT INTO note_sections
           (id, note_path, heading_slug, heading_text, level, start_line, end_line)
         VALUES ('a:h-1-dup', 'a.md', 'h-1', 'Intro Again', 2, 6, 10)`,
      ),
    ).toThrow();
  });

  test("note_chunk_embeddings composite PK blocks duplicate (note_path, chunk_id)", () => {
    applyWave8Migration(db);

    const vec = new Uint8Array(4);
    const insert = db.prepare(
      `INSERT INTO note_chunk_embeddings
         (note_path, chunk_id, chunk_text, start_line, end_line,
          model, dims, vector, content_hash, created_at)
       VALUES (?, 'h-intro-0', ?, 1, 5, 'bge-small-en-v1.5', 384, ?, 'abc', 0)`,
    );
    insert.run("a.md", "hello", vec);
    expect(() => insert.run("a.md", "hello again", vec)).toThrow();
  });

  test("mcp_dedup blocks duplicate client_tag", () => {
    applyWave8Migration(db);

    db.run(
      `INSERT INTO mcp_dedup (client_tag, tool, response, created_at)
       VALUES ('uuid-1', 'create_note', '{}', 0)`,
    );
    expect(() =>
      db.run(
        `INSERT INTO mcp_dedup (client_tag, tool, response, created_at)
         VALUES ('uuid-1', 'create_note', '{}', 0)`,
      ),
    ).toThrow();
  });

  test("migration is idempotent (second call does not throw)", () => {
    applyWave8Migration(db);
    expect(() => applyWave8Migration(db)).not.toThrow();
  });
});
