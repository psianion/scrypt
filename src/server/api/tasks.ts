import type { Router } from "../router";
import type { TasksRepo, TaskStatus, TaskType } from "../indexer/tasks-repo";

export function taskListRoutes(router: Router, tasks: TasksRepo): void {
  router.get("/api/tasks/list", (req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const typeParam = url.searchParams.get("type") ?? undefined;
    const notePath = url.searchParams.get("note_path") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const offset = Number(url.searchParams.get("offset") ?? 0);

    if (statusParam === "all") {
      const all = tasks.list({
        note_path: notePath,
        type: typeParam as TaskType | undefined,
        limit,
        offset,
      });
      return Response.json(all);
    }

    const status = (statusParam ?? "open") as TaskStatus;
    const result = tasks.list({
      note_path: notePath,
      type: typeParam as TaskType | undefined,
      status,
      limit,
      offset,
    });
    return Response.json(result);
  });
}
