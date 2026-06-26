import type { Router } from "../router";
import {
  TASK_STATUSES,
  TASK_TYPES,
  type TasksRepo,
  type TaskStatus,
  type TaskType,
} from "../indexer/tasks-repo";

const VALID_STATUS = new Set<TaskStatus>(TASK_STATUSES);
const VALID_TYPE = new Set<TaskType>(TASK_TYPES);

function parseNum(v: string | null, def: number): number {
  if (v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export function taskListRoutes(router: Router, tasks: TasksRepo): void {
  router.get("/api/tasks/list", (req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const typeParam = url.searchParams.get("type");
    const notePath = url.searchParams.get("note_path") ?? undefined;
    const limit = parseNum(url.searchParams.get("limit"), 200);
    const offset = parseNum(url.searchParams.get("offset"), 0);

    if (
      typeParam !== null &&
      !VALID_TYPE.has(typeParam as TaskType)
    ) {
      return Response.json(
        { error: `invalid type: ${typeParam}` },
        { status: 400 },
      );
    }
    const type = (typeParam ?? undefined) as TaskType | undefined;

    if (statusParam === "all") {
      const all = tasks.list({
        note_path: notePath,
        type,
        limit,
        offset,
      });
      return Response.json(all);
    }

    if (
      statusParam !== null &&
      !VALID_STATUS.has(statusParam as TaskStatus)
    ) {
      return Response.json(
        { error: `invalid status: ${statusParam}` },
        { status: 400 },
      );
    }
    const status = (statusParam ?? "open") as TaskStatus;

    const result = tasks.list({
      note_path: notePath,
      type,
      status,
      limit,
      offset,
    });
    return Response.json(result);
  });

  router.post("/api/tasks", async (req) => {
    const b = (await req.json()) as {
      title?: string;
      type?: string;
      status?: string;
      due_date?: string;
      priority?: number;
      note_path?: string;
      metadata?: Record<string, unknown>;
      client_tag?: string;
    };
    if (!b.title || !b.title.trim())
      return Response.json({ error: "title required" }, { status: 400 });
    if (!b.type || !VALID_TYPE.has(b.type as TaskType))
      return Response.json(
        { error: `invalid type: ${b.type ?? "(missing)"}` },
        { status: 400 },
      );
    if (b.status !== undefined && !VALID_STATUS.has(b.status as TaskStatus))
      return Response.json(
        { error: `invalid status: ${b.status}` },
        { status: 400 },
      );
    const task = tasks.create({
      title: b.title,
      type: b.type as TaskType,
      status: (b.status as TaskStatus) ?? "open",
      due_date: b.due_date ?? null,
      priority: b.priority ?? 0,
      note_path: b.note_path ?? null,
      metadata: b.metadata ?? undefined,
      client_tag: b.client_tag ?? null,
    });
    return Response.json(task);
  });

  router.patch("/api/tasks/:id", async (req, p) => {
    const id = Number(p.id);
    if (!Number.isInteger(id))
      return Response.json({ error: "bad id" }, { status: 400 });
    const patch = (await req.json()) as {
      title?: string;
      type?: string;
      status?: string;
      due_date?: string | null;
      priority?: number;
      metadata?: Record<string, unknown> | null;
    };
    if (patch.type !== undefined && !VALID_TYPE.has(patch.type as TaskType))
      return Response.json(
        { error: `invalid type: ${patch.type}` },
        { status: 400 },
      );
    if (
      patch.status !== undefined &&
      !VALID_STATUS.has(patch.status as TaskStatus)
    )
      return Response.json(
        { error: `invalid status: ${patch.status}` },
        { status: 400 },
      );
    const updated = tasks.update(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.type !== undefined ? { type: patch.type as TaskType } : {}),
      ...(patch.status !== undefined
        ? { status: patch.status as TaskStatus }
        : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
    });
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  });
}
