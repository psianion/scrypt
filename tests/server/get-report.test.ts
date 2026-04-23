// tests/server/get-report.test.ts
//
// ingest-v3: get_report now returns projects[] + threads[] rollups.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, type TestCtx } from "../helpers/ctx";
import { getReportTool } from "../../src/server/mcp/tools/get-report";
import type { ToolContext } from "../../src/server/mcp/types";

function toolCtx(t: TestCtx): ToolContext {
  return { db: t.db as unknown as Database } as unknown as ToolContext;
}

test("get_report includes projects[] with doc_type counts", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "testp", doc_type: "plan", slug: "p1" });
    seedNote(ctx, { project: "testp", doc_type: "research", slug: "r1" });
    seedNote(ctx, { project: "other", doc_type: "plan", slug: "p2" });
    const r = await getReportTool.handler(toolCtx(ctx), {}, "c");
    expect(r.projects).toBeDefined();
    const testp = r.projects.find((p) => p.name === "testp");
    expect(testp).toBeDefined();
    expect(testp!.doc_type_counts.plan).toBe(1);
    expect(testp!.doc_type_counts.research).toBe(1);
    expect(testp!.total).toBe(2);
    const other = r.projects.find((p) => p.name === "other");
    expect(other!.total).toBe(1);
  } finally {
    ctx.cleanup();
  }
});

test("get_report includes threads[] with member counts", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "testp",
      doc_type: "research",
      slug: "r",
      thread: "news-images",
    });
    seedNote(ctx, {
      project: "testp",
      doc_type: "spec",
      slug: "s",
      thread: "news-images",
    });
    const r = await getReportTool.handler(toolCtx(ctx), {}, "c");
    const t = r.threads.find((x) => x.thread === "news-images");
    expect(t).toBeDefined();
    expect(t!.project).toBe("testp");
    expect(t!.count).toBe(2);
    expect(t!.doc_types.sort()).toEqual(["research", "spec"]);
  } finally {
    ctx.cleanup();
  }
});

test("get_report markdown surfaces Projects + Threads sections", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "a", thread: "t1" });
    const r = await getReportTool.handler(toolCtx(ctx), {}, "c");
    expect(r.markdown).toContain("## Projects");
    expect(r.markdown).toContain("## Threads");
    expect(r.markdown).toContain("**p**");
    expect(r.markdown).toContain("**t1**");
  } finally {
    ctx.cleanup();
  }
});
