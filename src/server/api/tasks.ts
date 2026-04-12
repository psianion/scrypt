// src/server/api/tasks.ts
import type { Router } from "../router";
import type { Indexer } from "../indexer";
import type { FileManager } from "../file-manager";

export function taskRoutes(
  router: Router,
  indexer: Indexer,
  _fm: FileManager,
  _vaultPath: string,
): void {
  router.get("/api/tasks", (req) => {
    const url = new URL(req.url);
    const board = url.searchParams.get("board") || undefined;
    const doneParam = url.searchParams.get("done");
    const tag = url.searchParams.get("tag") || undefined;
    const done = doneParam === null ? undefined : doneParam === "true";

    const tasks = indexer.getTasks({ board, done, tag });
    return Response.json(tasks);
  });

  router.put("/api/tasks/:id", async (req, params) => {
    const id = parseInt(params.id, 10);
    const body = (await req.json()) as {
      done?: boolean;
      board?: string;
      priority?: number;
    };
    indexer.updateTask(id, body);
    return Response.json({ updated: id });
  });
}
