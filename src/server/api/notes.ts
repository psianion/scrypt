// src/server/api/notes.ts
import { join } from "node:path";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";

export function notesRoutes(router: Router, fm: FileManager, indexer: Indexer): void {
  router.get("/api/notes", async (req) => {
    const url = new URL(req.url);
    const tag = url.searchParams.get("tag");
    const folder = url.searchParams.get("folder") || undefined;
    const sort = url.searchParams.get("sort");

    let notes = await fm.listNotes(folder);

    if (tag) {
      const taggedPaths = new Set(
        indexer.getTags()
          .filter((t) => t.tag === tag)
          .length > 0
            ? (indexer as any).db
                .query("SELECT n.path FROM notes n JOIN tags t ON t.note_id = n.id WHERE t.tag = ?")
                .all(tag)
                .map((r: any) => r.path)
            : []
      );
      if (taggedPaths.size > 0) {
        notes = notes.filter((n) => taggedPaths.has(n.path));
      }
    }

    if (sort === "modified") {
      notes.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
    }

    return Response.json(notes);
  });

  router.get("/api/notes/*path", async (_req, params) => {
    const note = await fm.readNote(params.path);
    if (!note) return Response.json({ error: "Not found" }, { status: 404 });

    const backlinks = indexer.getBacklinks(params.path);
    return Response.json({ ...note, backlinks });
  });

  router.post("/api/notes", async (req) => {
    const body = await req.json() as { path: string; content: string; tags?: string[] };
    const existing = await fm.readNote(body.path);
    if (existing) return Response.json({ error: "Already exists" }, { status: 409 });

    const frontmatter: Record<string, unknown> = {
      title: body.path.split("/").pop()?.replace(".md", "") || "Untitled",
    };
    if (body.tags) frontmatter.tags = body.tags;

    await fm.writeNote(body.path, body.content, frontmatter);
    await indexer.reindexNote(body.path);
    return Response.json({ path: body.path }, { status: 201 });
  });

  router.put("/api/notes/*path", async (req, params) => {
    const existing = await fm.readNote(params.path);
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const body = await req.json() as { content?: string; frontmatter?: Record<string, unknown> };
    const content = body.content ?? existing.content;
    const frontmatter = { ...existing.frontmatter, ...body.frontmatter };

    await fm.writeNote(params.path, content, frontmatter);
    await indexer.reindexNote(params.path);
    return Response.json({ path: params.path });
  });

  router.delete("/api/notes/*path", async (_req, params) => {
    try {
      await fm.deleteNote(params.path);
      await indexer.removeNote(params.path);
      return Response.json({ deleted: params.path });
    } catch {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  });
}
