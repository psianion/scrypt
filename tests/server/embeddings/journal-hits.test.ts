// tests/server/embeddings/journal-hits.test.ts
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { groupByNote } from "../../../src/server/embeddings/search";
import { buildCtx } from "../../helpers/ctx";
import { semanticSearchTool } from "../../../src/server/mcp/tools/semantic-search";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import type { ToolContext } from "../../../src/server/mcp/types";
import type { EngineLike } from "../../../src/server/embeddings/service";

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

const hit = (
  note_path: string,
  chunk_id: string,
  score: number,
  start_line: number,
) =>
  ({
    note_path,
    chunk_id,
    score,
    chunk_text: chunk_id,
    start_line,
    end_line: start_line + 1,
  }) as any;

test("journal chunks are NOT collapsed; other notes are", () => {
  const hits = [
    hit("journal/2026-05-12.md", "j:1500", 0.9, 4),
    hit("journal/2026-05-12.md", "j:1730", 0.8, 8),
    hit("notes/a.md", "a:1", 0.7, 0),
    hit("notes/a.md", "a:2", 0.6, 5),
  ];
  const out = groupByNote(hits, 10);
  const journalRows = out.filter((g) => g.note_path.startsWith("journal/"));
  const noteRows = out.filter((g) => g.note_path === "notes/a.md");
  expect(journalRows.length).toBe(2); // both entries kept
  expect(noteRows.length).toBe(1); // collapsed to best chunk
});

test("limit still applies across journal + non-journal rows, by score", () => {
  const hits = [
    hit("journal/2026-05-12.md", "j:1500", 0.9, 4),
    hit("journal/2026-05-12.md", "j:1730", 0.8, 8),
    hit("notes/a.md", "a:1", 0.7, 0),
  ];
  const out = groupByNote(hits, 2);
  expect(out.length).toBe(2);
  expect(out.map((g) => g.score)).toEqual([0.9, 0.8]);
});

test("semantic_search attaches entry_time/entry_display for journal hits (from note_sections heading)", async () => {
  const ctx = buildCtx();
  try {
    const db = ctx.db as unknown as Database;
    const embeddings = new ChunkEmbeddingsRepo(db);
    const path = "journal/2026-05-12.md";
    const iso = "2026-05-12T15:00:00.000Z";

    // notes row (so the metadata join finds the journal note + doc_type)
    db.run(
      `INSERT INTO notes (path, title, project, doc_type, thread) VALUES (?, ?, NULL, 'journal', NULL)`,
      [path, "2026-05-12"],
    );
    // note_sections row whose id is the chunk's section id and whose
    // heading_text is the entry's exact UTC ISO timestamp.
    db.run(
      `INSERT INTO note_sections
         (id, note_path, heading_slug, heading_text, level, summary, start_line, end_line)
       VALUES (?, ?, ?, ?, 2, '', 2, 4)`,
      [`${path}#sec`, path, "2026-05-12t15-00-00-000z", iso],
    );

    // chunk embedding whose chunk_id == section id (no :part_ suffix)
    const vec = new Float32Array(4);
    vec[0] = 1;
    embeddings.upsert({
      note_path: path,
      chunk_id: `${path}#sec`,
      chunk_text: "thought about the necromancer",
      start_line: 2,
      end_line: 4,
      content_hash: "h-journal",
      model: "fake",
      dims: 4,
      vector: vec,
    });

    const toolCtx = {
      db,
      embeddings,
      engine: new FakeEngine(),
    } as unknown as ToolContext;

    const r = await semanticSearchTool.handler(
      toolCtx,
      { query: "necromancer", min_score: -1 },
      "c",
    );
    const row = r.results.find((x) => x.path === path)!;
    expect(row).toBeTruthy();
    expect(row.entry_time).toBe(iso);
    expect(row.entry_display).toBe("2026-05-12 · 3:00 PM");
    expect(row.doc_type).toBe("journal");
  } finally {
    ctx.cleanup();
  }
});

test("semantic_search does NOT attach entry_time for non-journal hits", async () => {
  const ctx = buildCtx();
  try {
    const db = ctx.db as unknown as Database;
    const embeddings = new ChunkEmbeddingsRepo(db);
    const path = "notes/plain.md";
    db.run(
      `INSERT INTO notes (path, title, project, doc_type, thread) VALUES (?, ?, NULL, 'note', NULL)`,
      [path, "Plain"],
    );
    const vec = new Float32Array(4);
    vec[0] = 1;
    embeddings.upsert({
      note_path: path,
      chunk_id: `${path}#sec`,
      chunk_text: "plain body",
      start_line: 0,
      end_line: 1,
      content_hash: "h-plain",
      model: "fake",
      dims: 4,
      vector: vec,
    });
    const toolCtx = {
      db,
      embeddings,
      engine: new FakeEngine(),
    } as unknown as ToolContext;
    const r = await semanticSearchTool.handler(
      toolCtx,
      { query: "plain", min_score: -1 },
      "c",
    );
    const row = r.results.find((x) => x.path === path)!;
    expect(row).toBeTruthy();
    expect(row.entry_time).toBeUndefined();
    expect(row.entry_display).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});
