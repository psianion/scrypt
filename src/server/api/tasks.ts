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
}
