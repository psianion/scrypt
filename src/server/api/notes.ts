// src/server/api/notes.ts
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { parseTier, type NoteIncomingEdge, type NoteMeta } from "../../shared/types";
import { moveNoteHandler } from "./notes-move";

interface NoteRow {
  path: string;
  title: string;
  tags: string | null;
  created: string | null;
  modified: string | null;
  project: string | null;
  doc_type: string | null;
  thread: string | null;
  domain: string | null;
  subdomain: string | null;
}

const LIST_COLUMNS =
  "SELECT path, title, tags, created, modified, project, doc_type, thread, domain, subdomain FROM notes";

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The list endpoint only needs metadata, which the indexer already holds. The
 * filesystem walk it replaces opened and frontmatter-parsed every note serially
 * — >10s on a 1k-note vault, past Bun.serve's idle timeout, so the request was
 * reset and the sidebar rendered empty.
 *
 * Returns null when the index has no rows yet (cold start, before the first
 * reindex), so the caller can fall back to the filesystem.
 */
function listNotesIndexed(db: Database | undefined, folder?: string): NoteMeta[] | null {
  if (!db) return null;
  const total = db.query("SELECT count(*) AS c FROM notes").get() as { c: number } | null;
  if (!total || total.c === 0) return null;

  const rows = (folder
    ? db.query(`${LIST_COLUMNS} WHERE path LIKE ?1 ESCAPE '\\'`)
        .all(`${folder.replace(/[\\%_]/g, "\\$&")}/%`)
    : db.query(LIST_COLUMNS).all()) as NoteRow[];

  return rows.map((r) => ({
    path: r.path,
    title: r.title,
    tags: parseTags(r.tags),
    created: r.created ?? "",
    modified: r.modified ?? "",
    aliases: [],
    domain: r.domain,
    subdomain: r.subdomain,
    identifierTags: [],
    topicTags: [],
    project: r.project,
    doc_type: r.doc_type,
    thread: r.thread,
  }));
}

export function notesRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  db?: Database,
  vaultDir?: string,
): void {
  router.get("/api/notes", async (req) => {
    const url = new URL(req.url);
    const tag = url.searchParams.get("tag");
    const folder = url.searchParams.get("folder") || undefined;
    const sort = url.searchParams.get("sort");

    let notes = listNotesIndexed(db, folder) ?? (await fm.listNotes(folder));

    if (tag) {
      notes = notes.filter((n) => n.tags.includes(tag));
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
    const incoming_edges: NoteIncomingEdge[] = indexer
      .getIncomingEdges(params.path)
      .flatMap((e) => {
        const tier = parseTier(e.tier);
        if (tier === null) return [];
        return [{
          source: e.source,
          target: e.target,
          tier,
          reason: e.reason,
        }];
      });
    return Response.json({ ...note, backlinks, incoming_edges });
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

  // ingest-v3: promote / move a note between projects. Registered only when
  // caller passes db + vaultDir (index.ts), so test harnesses can omit these.
  if (db && vaultDir) {
    router.post("/api/notes/*path/move", async (req, params) => {
      return moveNoteHandler(req, {
        db,
        vaultDir,
        oldPath: params.path,
      });
    });
  }
}
