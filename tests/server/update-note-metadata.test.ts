// tests/server/update-note-metadata.test.ts
//
// Exercises the ingest-v3 additions to update_note_metadata: thread/project
// denormalization + ingest-block shape gate.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, minimalIngestBlock } from "../helpers/ctx";
import { updateNoteMetadataTool } from "../../src/server/mcp/tools/update-note-metadata";
import { Idempotency } from "../../src/server/mcp/idempotency";
import { MetadataRepo } from "../../src/server/indexer/metadata-repo";
import type { ToolContext } from "../../src/server/mcp/types";
import type { TestCtx } from "../helpers/ctx";

function toolCtx(t: TestCtx): ToolContext {
  const db = t.db as unknown as Database;
  return {
    db,
    metadata: new MetadataRepo(db),
    idempotency: new Idempotency(db),
    scheduleGraphRebuild: () => {},
  } as unknown as ToolContext;
}

test("update_note_metadata accepts thread + project + ingest block", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "demo" });
    const r = await updateNoteMetadataTool.handler(
      toolCtx(ctx),
      {
        path: "projects/p/plan/demo.md",
        thread: "news-images",
        project: "p",
        ingest: minimalIngestBlock(),
        client_tag: "m1",
      } as unknown as Parameters<
        typeof updateNoteMetadataTool.handler
      >[1],
      "c",
    );
    expect(r.updated_fields).toContain("project");
    expect(r.updated_fields).toContain("thread");
    expect(r.updated_fields).toContain("ingest");

    const row = ctx.db
      .query("SELECT project, thread FROM notes WHERE path = ?")
      .get("projects/p/plan/demo.md") as {
      project: string;
      thread: string;
    };
    expect(row.thread).toBe("news-images");
    expect(row.project).toBe("p");
  } finally {
    ctx.cleanup();
  }
});

test("update_note_metadata rejects invalid ingest block", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, { project: "p", doc_type: "plan", slug: "demo" });
    await expect(
      updateNoteMetadataTool.handler(
        toolCtx(ctx),
        {
          path: "projects/p/plan/demo.md",
          ingest: { original_filename: "x" }, // missing required fields
          client_tag: "m2",
        } as unknown as Parameters<
          typeof updateNoteMetadataTool.handler
        >[1],
        "c",
      ),
    ).rejects.toThrow(/ingest block invalid/);
  } finally {
    ctx.cleanup();
  }
});

test("update_note_metadata thread: null detaches from thread", async () => {
  const ctx = buildCtx();
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "demo",
      thread: "initial",
    });
    await updateNoteMetadataTool.handler(
      toolCtx(ctx),
      {
        path: "projects/p/plan/demo.md",
        thread: null,
        client_tag: "m3",
      } as unknown as Parameters<
        typeof updateNoteMetadataTool.handler
      >[1],
      "c",
    );
    const row = ctx.db
      .query("SELECT thread FROM notes WHERE path = ?")
      .get("projects/p/plan/demo.md") as { thread: string | null };
    expect(row.thread).toBeNull();
  } finally {
    ctx.cleanup();
  }
});
