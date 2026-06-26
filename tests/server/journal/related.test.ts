// tests/server/journal/related.test.ts
import { test, expect } from "bun:test";
import { buildRelated } from "../../../src/server/journal/related";

test("buildRelated returns nearest non-journal notes, excludes journals", async () => {
  // fake engine + embeddings: one journal entry vector matches notes/poke.md
  const engine = { model: "test", embedBatch: async (xs: string[]) => xs.map(() => new Float32Array([1, 0])) } as any;
  const embeddings = {
    scanAll: () => [
      { note_path: "notes/poke.md", chunk_id: "p", score: 0, chunk_text: "pokemon cards", start_line: 0, end_line: 1, vector: new Float32Array([1, 0]) },
      { note_path: "journal/2026-06-08.md", chunk_id: "j", score: 0, chunk_text: "yesterday", start_line: 0, end_line: 1, vector: new Float32Array([1, 0]) },
    ],
  } as any;
  const indexer = {} as any;
  const doc = { date: "2026-06-09", frontmatter: {}, entries: [
    { id: "2026-06-09T15:00:00.000Z", displayTime: "3:00 PM", body: "thought about pokemon cards" },
  ] };
  const related = await buildRelated("2026-06-09", doc as any, indexer, engine, embeddings);
  expect(related.some((r) => r.path === "notes/poke.md")).toBe(true);
  expect(related.some((r) => r.path.startsWith("journal/"))).toBe(false);
});
