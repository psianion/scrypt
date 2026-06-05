// tests/server/embeddings/chunker.test.ts
import { test, expect, describe } from "bun:test";
import { chunkNote, CHUNKER_VERSION } from "../../../src/server/embeddings/chunker";
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
    expect(chunks[0].chunk_id).toBe("a_md:alpha");
    expect(chunks[1].chunk_id).toBe("a_md:beta");
  });

  test("each chunk text starts with the note title", () => {
    const parsed = parseStructural("a.md", SHORT);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    for (const c of chunks) {
      expect(c.text.startsWith("Short Note ›")).toBe(true);
    }
  });

  const NESTED = `---
title: Combat Rules
---

## Attacks

Roll to hit.

### Critical Hits

Double the dice.
`;

  test("embedded text starts with title + heading breadcrumb", () => {
    const parsed = parseStructural("combat.md", NESTED);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const crit = chunks.find((c) => c.chunk_id === "combat_md:critical-hits")!;
    expect(crit).toBeDefined();
    expect(
      crit.text.startsWith("Combat Rules › Attacks › Critical Hits\n\n"),
    ).toBe(true);
  });

  test("top-level section breadcrumb is just the title", () => {
    const parsed = parseStructural("combat.md", NESTED);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const atk = chunks.find((c) => c.chunk_id === "combat_md:attacks")!;
    expect(atk.text.startsWith("Combat Rules › Attacks\n\n")).toBe(true);
  });

  test("intro section breadcrumb is the bare title", () => {
    const intro = `---\ntitle: Combat Rules\n---\n\nPreamble text.\n\n## Attacks\n\nRoll.\n`;
    const parsed = parseStructural("combat.md", intro);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const introChunk = chunks.find((c) => c.chunk_id === "combat_md:h-intro-0")!;
    expect(introChunk.text.startsWith("Combat Rules\n\n")).toBe(true);
  });

  const SIBLINGS = `---
title: Manual
---

## Chapter A

Intro A.

### Section B

Body B.

## Chapter C

Intro C.

### Section D

Body D.
`;

  test("breadcrumb uses the real ancestor, not a same-level sibling", () => {
    const parsed = parseStructural("manual.md", SIBLINGS);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const d = chunks.find((c) => c.chunk_id === "manual_md:section-d")!;
    expect(d).toBeDefined();
    expect(d.text.startsWith("Manual › Chapter C › Section D\n\n")).toBe(true);
  });

  test("long sections split into overlapping sub-chunks with :part_N ids", () => {
    const big = `## Huge\n\n` + "word ".repeat(2000);
    const parsed = parseStructural("b.md", big);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunk_id).toBe("b_md:huge:part_0");
    expect(chunks[1].chunk_id).toBe("b_md:huge:part_1");
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
    expect(chunks[0].chunk_id).toBe("c_md:hascontent");
  });

  test("content_hash is stable across calls with identical input", () => {
    const parsed = parseStructural("a.md", SHORT);
    const a = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const b = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(a.map((c) => c.content_hash)).toEqual(b.map((c) => c.content_hash));
  });

  test("content_hash changes when the note title changes", () => {
    const a = parseStructural("x.md", `---\ntitle: Alpha\n---\n\n## S\n\nbody text\n`);
    const b = parseStructural("x.md", `---\ntitle: Bravo\n---\n\n## S\n\nbody text\n`);
    const ha = chunkNote(a, { maxTokens: 450, overlapTokens: 50 })[0].content_hash;
    const hb = chunkNote(b, { maxTokens: 450, overlapTokens: 50 })[0].content_hash;
    expect(ha).not.toBe(hb);
  });

  test("content_hash changes when an ancestor heading changes", () => {
    const a = parseStructural("y.md", `## Attacks\n\nx\n\n### Crit\n\nbody text\n`);
    const b = parseStructural("y.md", `## Defense\n\nx\n\n### Crit\n\nbody text\n`);
    const ca = chunkNote(a, { maxTokens: 450, overlapTokens: 50 }).find((c) => c.chunk_id === "y_md:crit")!;
    const cb = chunkNote(b, { maxTokens: 450, overlapTokens: 50 }).find((c) => c.chunk_id === "y_md:crit")!;
    expect(ca.content_hash).not.toBe(cb.content_hash);
  });

  test("display_text holds the raw body without the context prefix", () => {
    const parsed = parseStructural("a.md", `---\ntitle: T\n---\n\n## Alpha\n\nbody words here\n`);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const alpha = chunks[0];
    expect(alpha.display_text).toBe("body words here");
    expect(alpha.text).toBe("T › Alpha\n\nbody words here");
    expect(alpha.text.endsWith(alpha.display_text)).toBe(true);
  });

  test("long section splits into evenly sized parts (no tiny tail)", () => {
    const big = `## Huge\n\n` + "word ".repeat(2000);
    const parsed = parseStructural("b.md", big);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const wordBudget = Math.floor(450 / 1.3); // ~346
    const partCounts = chunks.map(
      (c) => c.display_text.split(/\s+/).filter(Boolean).length,
    );
    for (const n of partCounts) {
      expect(n).toBeLessThanOrEqual(wordBudget); // max guard
    }
    // min guard: the last part is at least half the budget (no orphan tail)
    expect(partCounts[partCounts.length - 1]).toBeGreaterThanOrEqual(
      Math.floor(wordBudget / 2),
    );
  });

  test("heading-less note splits by size into intro parts", () => {
    const raw = "para ".repeat(2000); // no headings, no frontmatter
    const parsed = parseStructural("flat.md", raw);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.chunk_id.startsWith("flat_md:h-intro-0")).toBe(true);
    }
  });

  test("prose section splits on paragraph boundaries when possible", () => {
    const p1 = "alpha ".repeat(200).trim();
    const p2 = "bravo ".repeat(200).trim();
    const parsed = parseStructural("p.md", `## Sec\n\n${p1}\n\n${p2}\n`);
    const chunks = chunkNote(parsed, { maxTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].display_text.startsWith("alpha")).toBe(true);
  });

  test("multi-paragraph body rebalances a tiny final paragraph (pack path)", () => {
    const p = (w: string, n: number) => (w + " ").repeat(n).trim();
    const body = `## Sec\n\n${p("alpha", 330)}\n\n${p("bravo", 330)}\n\n${p("charlie", 40)}\n`;
    const parsed = parseStructural("multi.md", body);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    const wordBudget = Math.floor(450 / 1.3); // 346
    const counts = chunks.map((c) => c.display_text.split(/\s+/).filter(Boolean).length);
    expect(counts.length).toBeGreaterThan(1);
    for (const n of counts) expect(n).toBeLessThanOrEqual(wordBudget);      // max guard
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(Math.floor(wordBudget / 2)); // min guard (no tiny tail)
  });

  test("exposes a chunker_version on every chunk", () => {
    const parsed = parseStructural("a.md", `---\ntitle: T\n---\n\n## S\n\nbody\n`);
    const chunks = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.chunker_version).toBe(CHUNKER_VERSION);
      expect(typeof c.chunker_version).toBe("number");
    }
  });

  test("content_hash is version-tagged", () => {
    const parsed = parseStructural("a.md", `---\ntitle: T\n---\n\n## S\n\nbody\n`);
    const chunk = chunkNote(parsed, { maxTokens: 450, overlapTokens: 50 })[0];
    const { createHash } = require("crypto");
    const expected = createHash("sha256")
      .update(`v${CHUNKER_VERSION}:${chunk.text}`)
      .digest("hex");
    expect(chunk.content_hash).toBe(expected);
  });
});
