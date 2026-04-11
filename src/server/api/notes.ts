// src/server/api/notes.ts
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";

export function notesRoutes(router: Router, fm: FileManager, indexer: Indexer): void {
  router.get("/api/notes", async () => {
    return Response.json([]);
  });
}
