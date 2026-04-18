// tests/server/mcp/tools/tasks-crud.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { createTaskTool } from "../../../../src/server/mcp/tools/create-task";
import { getTaskTool } from "../../../../src/server/mcp/tools/get-task";
import { listTasksTool } from "../../../../src/server/mcp/tools/list-tasks";
import { updateTaskTool } from "../../../../src/server/mcp/tools/update-task";
import { deleteTaskTool } from "../../../../src/server/mcp/tools/delete-task";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

function buildCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  const stubEngine: EngineLike = {
    model: "stub",
    batchSize: 1,
    async embedBatch() {
      return [];
    },
  };
  return {
    db,
    sections: new SectionsRepo(db),
    metadata: new MetadataRepo(db),
    tasks: new TasksRepo(db),
    embeddings: new ChunkEmbeddingsRepo(db),
    embedService: {
      embedNote: async () => ({ chunks_total: 0, chunks_embedded: 0, embed_ms: 0 }),
    } as unknown as ToolContext["embedService"],
    engine: stubEngine,
    bus: new ProgressBus(),
    idempotency: new Idempotency(db),
    userId: "u1",
    vaultDir: "/tmp/vault",
    scheduleGraphRebuild: () => {},
  };
}

describe("Wave 9 tasks CRUD tools", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = buildCtx();
  });

  test("create_task inserts and returns task_id + created_at", async () => {
    const r = await createTaskTool.handler(
      ctx,
      {
        note_path: "a.md",
        title: "Plan graph backlinks",
        type: "PLAN",
        client_tag: "ct-1",
      },
      "c",
    );
    expect(r.task_id).toBeGreaterThan(0);
    expect(r.created_at).toBeGreaterThan(0);
    const row = ctx.tasks.get(r.task_id);
    expect(row?.title).toBe("Plan graph backlinks");
    expect(row?.status).toBe("open");
    expect(row?.type).toBe("PLAN");
  });

  test("create_task rejects invalid type", async () => {
    let caught: unknown = null;
    try {
      await createTaskTool.handler(
        ctx,
        {
          note_path: "a.md",
          title: "x",
          // @ts-expect-error — intentional
          type: "not-a-type",
          client_tag: "ct-bad-type",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("create_task is idempotent on client_tag", async () => {
    const a = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "dedup", type: "PLAN", client_tag: "dup-1" },
      "c",
    );
    const b = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "dedup", type: "PLAN", client_tag: "dup-1" },
      "c",
    );
    expect(b.task_id).toBe(a.task_id);
    const { total } = ctx.tasks.list({});
    expect(total).toBe(1);
  });

  test("get_task returns the row or null", async () => {
    const created = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "gettable", type: "CUSTOM", client_tag: "g-1" },
      "c",
    );
    const hit = await getTaskTool.handler(ctx, { task_id: created.task_id }, "c");
    expect(hit.task?.title).toBe("gettable");
    const miss = await getTaskTool.handler(ctx, { task_id: 9999 }, "c");
    expect(miss.task).toBeNull();
  });

  test("list_tasks filters and orders by priority desc, due_date asc", async () => {
    await createTaskTool.handler(
      ctx,
      {
        note_path: "a.md",
        title: "low-prio",
        type: "CUSTOM",
        priority: 1,
        due_date: "2026-05-01",
        client_tag: "l-1",
      },
      "c",
    );
    await createTaskTool.handler(
      ctx,
      {
        note_path: "a.md",
        title: "high-prio-later",
        type: "PLAN",
        priority: 5,
        due_date: "2026-06-01",
        client_tag: "l-2",
      },
      "c",
    );
    await createTaskTool.handler(
      ctx,
      {
        note_path: "b.md",
        title: "high-prio-sooner",
        type: "PLAN",
        priority: 5,
        due_date: "2026-04-01",
        client_tag: "l-3",
      },
      "c",
    );

    const all = await listTasksTool.handler(ctx, {}, "c");
    expect(all.total).toBe(3);
    expect(all.tasks.map((t) => t.title)).toEqual([
      "high-prio-sooner",
      "high-prio-later",
      "low-prio",
    ]);

    const scoped = await listTasksTool.handler(ctx, { note_path: "a.md" }, "c");
    expect(scoped.total).toBe(2);
    expect(scoped.tasks.every((t) => t.note_path === "a.md")).toBe(true);

    const typed = await listTasksTool.handler(ctx, { type: "PLAN" }, "c");
    expect(typed.total).toBe(2);
  });

  test("update_task updates allowed fields", async () => {
    const { task_id } = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "to-edit", type: "PLAN", client_tag: "u-1" },
      "c",
    );
    const r = await updateTaskTool.handler(
      ctx,
      {
        task_id,
        fields: { status: "in_progress", priority: 3, title: "edited" },
        client_tag: "u-1-edit",
      },
      "c",
    );
    expect(r.task.status).toBe("in_progress");
    expect(r.task.priority).toBe(3);
    expect(r.task.title).toBe("edited");
  });

  test("update_task rejects unknown fields", async () => {
    const { task_id } = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "x", type: "PLAN", client_tag: "u-2" },
      "c",
    );
    let caught: unknown = null;
    try {
      await updateTaskTool.handler(
        ctx,
        {
          task_id,
          fields: { bogus: "y" },
          client_tag: "u-2-bad",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("update_task errors when task not found", async () => {
    let caught: unknown = null;
    try {
      await updateTaskTool.handler(
        ctx,
        {
          task_id: 9999,
          fields: { status: "closed" },
          client_tag: "u-missing",
        },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("update_task is idempotent on client_tag", async () => {
    const { task_id } = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "idemp", type: "PLAN", client_tag: "u-3" },
      "c",
    );
    const a = await updateTaskTool.handler(
      ctx,
      { task_id, fields: { status: "closed" }, client_tag: "u-3-done" },
      "c",
    );
    const b = await updateTaskTool.handler(
      ctx,
      {
        task_id,
        // Same client_tag — cached result returned regardless of new fields.
        // 'cancelled' is intentionally invalid; we'd hit a CHECK constraint
        // if it ever ran (it shouldn't).
        fields: { status: "cancelled" as never },
        client_tag: "u-3-done",
      },
      "c",
    );
    expect(a.task.status).toBe("closed");
    expect(b.task.status).toBe("closed");
  });

  test("delete_task removes and reports deleted flag", async () => {
    const { task_id } = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "del-me", type: "CUSTOM", client_tag: "d-1" },
      "c",
    );
    const first = await deleteTaskTool.handler(
      ctx,
      { task_id, client_tag: "d-1-go" },
      "c",
    );
    expect(first.deleted).toBe(true);
    const got = await getTaskTool.handler(ctx, { task_id }, "c");
    expect(got.task).toBeNull();
  });

  test("delete_task idempotent replay returns cached true even after missing", async () => {
    const { task_id } = await createTaskTool.handler(
      ctx,
      { note_path: "a.md", title: "idem-del", type: "CUSTOM", client_tag: "d-2" },
      "c",
    );
    const a = await deleteTaskTool.handler(
      ctx,
      { task_id, client_tag: "d-2-go" },
      "c",
    );
    const b = await deleteTaskTool.handler(
      ctx,
      { task_id, client_tag: "d-2-go" },
      "c",
    );
    expect(a).toEqual(b);
    expect(a.deleted).toBe(true);
  });

  test("end-to-end: create → list → get → update → delete", async () => {
    const created = await createTaskTool.handler(
      ctx,
      {
        note_path: "a.md",
        title: "lifecycle",
        type: "BUILD",
        priority: 2,
        client_tag: "e2e-1",
      },
      "c",
    );
    const listed = await listTasksTool.handler(ctx, {}, "c");
    expect(listed.tasks.map((t) => t.id)).toContain(created.task_id);

    const got = await getTaskTool.handler(
      ctx,
      { task_id: created.task_id },
      "c",
    );
    expect(got.task?.title).toBe("lifecycle");

    const upd = await updateTaskTool.handler(
      ctx,
      {
        task_id: created.task_id,
        fields: { status: "closed" },
        client_tag: "e2e-2",
      },
      "c",
    );
    expect(upd.task.status).toBe("closed");

    const del = await deleteTaskTool.handler(
      ctx,
      { task_id: created.task_id, client_tag: "e2e-3" },
      "c",
    );
    expect(del.deleted).toBe(true);

    const after = await listTasksTool.handler(ctx, {}, "c");
    expect(after.total).toBe(0);
  });
});
