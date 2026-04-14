// tests/server/embeddings/chunker.test.ts
import { test, expect, describe } from "bun:test";
import { chunkNote } from "../../../src/server/embeddings/chunker";
import { parseStructural } from "../../../src/server/indexer/structural-parse";

const SHORT = `---
title: Short Note
---

## Alpha

Just a few words here.

## Beta

And a few more.
`;

describe("chunkNote", () => {
  test("produces one chunk per non-empty section", () => {
    const parsed = parseStructural("a.md", SHORT);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunk_id).toBe("a:alpha");
    expect(chunks[1].chunk_id).toBe("a:beta");
  });

  test("each chunk text starts with the note title", () => {
    const parsed = parseStructural("a.md", SHORT);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    for (const c of chunks) {
      expect(c.text.startsWith("Short Note\n\n")).toBe(true);
    }
  });

  test("long sections split into overlapping sub-chunks with :part_N ids", () => {
    const big = `## Huge\n\n` + "word ".repeat(2000);
    const parsed = parseStructural("b.md", big);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunk_id).toMatch(/:huge:part_0$/);
    expect(chunks[1].chunk_id).toMatch(/:huge:part_1$/);
    // Overlap: the last ~40 tokens of chunk 0 should appear in chunk 1.
    const c0Words = chunks[0].text.split(/\s+/);
    const tailSnippet = c0Words.slice(-30).join(" ");
    expect(chunks[1].text).toContain(tailSnippet.slice(0, 60));
  });

  test("empty and whitespace-only sections are skipped", () => {
    const sparse = `## Empty\n\n## HasContent\n\nhello\n`;
    const parsed = parseStructural("c.md", sparse);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunk_id).toBe("c:hascontent");
  });

  test("content_hash is stable across calls with identical input", () => {
    const parsed = parseStructural("a.md", SHORT);
    const a = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const b = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(a.map((c) => c.content_hash)).toEqual(b.map((c) => c.content_hash));
  });
});
