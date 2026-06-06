// tests/server/embeddings/chunker-cache.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import { chunkNote } from "../../../src/server/embeddings/chunker";
import { parseStructural } from "../../../src/server/indexer/structural-parse";

describe("chunker cache parity", () => {
  let db: Database;
  let repo: ChunkEmbeddingsRepo;
  const MODEL = "Xenova/bge-small-en-v1.5";

  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    repo = new ChunkEmbeddingsRepo(db);
  });

  function seed(raw: string) {
    const parsed = parseStructural("n.md", raw);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    for (const c of chunks) {
      repo.upsert({
        note_path: c.note_path,
        chunk_id: c.chunk_id,
        chunk_text: c.display_text,
        start_line: c.start_line,
        end_line: c.end_line,
        model: MODEL,
        dims: 1,
        vector: new Float32Array([0]),
        content_hash: c.content_hash,
      });
    }
    return chunks;
  }

  test("unchanged content stays fresh", () => {
    const raw = `---\ntitle: T\n---\n\n## S\n\nbody text\n`;
    seed(raw);
    const again = chunkNote(parseStructural("n.md", raw), { maxTokens: 450, overlapTokens: 50 });
    expect(again.length).toBeGreaterThan(0);
    for (const c of again) {
      expect(repo.hasFreshChunk(c.note_path, c.chunk_id, MODEL, c.content_hash)).toBe(true);
    }
  });

  test("title change invalidates the cached chunk", () => {
    seed(`---\ntitle: Old\n---\n\n## S\n\nbody text\n`);
    const changed = chunkNote(parseStructural("n.md", `---\ntitle: New\n---\n\n## S\n\nbody text\n`), { maxTokens: 450, overlapTokens: 50 });
    expect(repo.hasFreshChunk(changed[0].note_path, changed[0].chunk_id, MODEL, changed[0].content_hash)).toBe(false);
  });
});
