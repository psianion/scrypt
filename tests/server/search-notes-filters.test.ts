// tests/server/search-notes-filters.test.ts
//
// ingest-v3: project/doc_type/thread filters on search_notes + returned
// fields on each result row.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, type TestCtx } from "../helpers/ctx";
import { searchNotesTool } from "../../src/server/mcp/tools/search-notes";
import type { ToolContext } from "../../src/server/mcp/types";

function toolCtx(t: TestCtx): ToolContext {
  return { db: t.db as unknown as Database } as unknown as ToolContext;
}

test("search_notes filters by project", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "testp",
      doc_type: "plan",
      slug: "demo",
      body: "demo content",
    });
    seedNote(ctx, {
      project: "other",
      doc_type: "plan",
      slug: "demo2",
      body: "demo content",
    });
    const r = await searchNotesTool.handler(
      toolCtx(ctx),
      { query: "demo", project: "testp" },
      "c",
    );
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((row) => row.path.startsWith("projects/testp/"))).toBe(
      true,
    );
  } finally {
    ctx.cleanup();
  }
});

test("search_notes result rows include project/doc_type/thread/title", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "demo",
      body: "demo content",
    });
    const r = await searchNotesTool.handler(
      toolCtx(ctx),
      { query: "demo" },
      "c",
    );
    expect(r.results[0]).toMatchObject({
      title: expect.any(String),
      project: "p",
      doc_type: "plan",
      thread: null,
    });
  } finally {
    ctx.cleanup();
  }
});

test("search_notes filters by doc_type", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      body: "shared term",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "research",
      slug: "b",
      body: "shared term",
    });
    const r = await searchNotesTool.handler(
      toolCtx(ctx),
      { query: "shared", doc_type: "plan" },
      "c",
    );
    expect(r.results.every((row) => row.doc_type === "plan")).toBe(true);
  } finally {
    ctx.cleanup();
  }
});

test("search_notes filters by thread", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "news-images",
      body: "image pipeline",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "b",
      body: "image pipeline",
    });
    const r = await searchNotesTool.handler(
      toolCtx(ctx),
      { query: "image", thread: "news-images" },
      "c",
    );
    expect(r.results.every((row) => row.thread === "news-images")).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
  } finally {
    ctx.cleanup();
  }
});
