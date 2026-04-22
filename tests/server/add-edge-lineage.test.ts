// tests/server/add-edge-lineage.test.ts
//
// Lineage anti-rules for add_edge (ingest-v3 Task 7): only derives-from,
// implements, supersedes are valid reasons at tier='connected'; shape rules
// (doc_type combos, same-project) must hold.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, type TestCtx } from "../helpers/ctx";
import { addEdgeTool } from "../../src/server/mcp/tools/add-edge";
import { Idempotency } from "../../src/server/mcp/idempotency";
import type { ToolContext } from "../../src/server/mcp/types";

function toolCtx(t: TestCtx): ToolContext {
  // The lineage anti-rules fire before the DB write, so the tool context
  // only needs db + idempotency + scheduleGraphRebuild for these cases.
  return {
    db: t.db as unknown as Database,
    idempotency: new Idempotency(t.db as unknown as Database),
    scheduleGraphRebuild: () => {},
  } as unknown as ToolContext;
}

test("add_edge accepts derives-from spec→research, same project", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "spec", slug: "design" });
    seedNote(ctx, { project: "p", doc_type: "research", slug: "notes" });
    const r = await addEdgeTool.handler(
      toolCtx(ctx),
      {
        source: "projects/p/spec/design.md",
        target: "projects/p/research/notes.md",
        tier: "connected",
        reason: "derives-from",
        client_tag: "e1",
      },
      "c",
    );
    expect(r.edge_id).toBeGreaterThan(0);
  } finally {
    ctx.cleanup();
  }
});

test("add_edge rejects derives-from across projects", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "a", doc_type: "spec", slug: "x" });
    seedNote(ctx, { project: "b", doc_type: "research", slug: "y" });
    await expect(
      addEdgeTool.handler(
        toolCtx(ctx),
        {
          source: "projects/a/spec/x.md",
          target: "projects/b/research/y.md",
          tier: "connected",
          reason: "derives-from",
          client_tag: "e2",
        },
        "c",
      ),
    ).rejects.toThrow(/share project/);
  } finally {
    ctx.cleanup();
  }
});

test("add_edge rejects implements plan→research (wrong target)", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "x" });
    seedNote(ctx, { project: "p", doc_type: "research", slug: "y" });
    await expect(
      addEdgeTool.handler(
        toolCtx(ctx),
        {
          source: "projects/p/plan/x.md",
          target: "projects/p/research/y.md",
          tier: "connected",
          reason: "implements",
          client_tag: "e3",
        },
        "c",
      ),
    ).rejects.toThrow(/target doc_type/);
  } finally {
    ctx.cleanup();
  }
});

test("add_edge rejects supersedes across different doc_types", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "spec", slug: "new" });
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "old" });
    await expect(
      addEdgeTool.handler(
        toolCtx(ctx),
        {
          source: "projects/p/spec/new.md",
          target: "projects/p/plan/old.md",
          tier: "connected",
          reason: "supersedes",
          client_tag: "e4",
        },
        "c",
      ),
    ).rejects.toThrow(/matching doc_type/);
  } finally {
    ctx.cleanup();
  }
});

test("add_edge still rejects plan↔plan (existing rule)", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "a" });
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "b" });
    // Seed note_metadata rows so the existing plan↔plan rule (which reads
    // doc_type from note_metadata) fires.
    const now = new Date().toISOString();
    ctx.db.run(
      `INSERT INTO note_metadata (note_path, doc_type, updated_at) VALUES (?, 'plan', ?)`,
      ["projects/p/plan/a.md", now],
    );
    ctx.db.run(
      `INSERT INTO note_metadata (note_path, doc_type, updated_at) VALUES (?, 'plan', ?)`,
      ["projects/p/plan/b.md", now],
    );
    await expect(
      addEdgeTool.handler(
        toolCtx(ctx),
        {
          source: "projects/p/plan/a.md",
          target: "projects/p/plan/b.md",
          tier: "connected",
          reason: "related",
          client_tag: "e5",
        },
        "c",
      ),
    ).rejects.toThrow(/plan/);
  } finally {
    ctx.cleanup();
  }
});
