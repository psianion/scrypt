// src/server/api/journal.ts
import type { Database } from "bun:sqlite";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import type { TasksRepo } from "../indexer/tasks-repo";
import type { EngineLike } from "../embeddings/service";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import { parseFrontmatter } from "../parsers";
import {
  isValidDayKey,
  nowIso,
  todayKey,
  formatEntryDateTime,
} from "../../shared/date";
import {
  parseJournalDoc,
  serializeJournalDoc,
  appendEntry,
  editEntry,
  deleteEntry,
  type JournalDoc,
} from "../journal/doc";
import { buildRelated } from "../journal/related";

// Frontmatter stamped onto every journal file. `doc_type: "journal"` lets
// semantic_search filter journal hits even though journal files live outside
// the projects/<project>/<doc_type>/ layout.
const FM = {
  title: "",
  kind: "journal",
  doc_type: "journal",
  tags: ["journal", "daily"],
};

export function journalRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  tasks: TasksRepo,
  db: Database,
  engine?: EngineLike,
  embeddings?: ChunkEmbeddingsRepo,
): void {
  const relPath = (date: string) => `journal/${date}.md`;

  async function loadDoc(date: string): Promise<JournalDoc> {
    const raw = await fm.readRaw(relPath(date));
    if (raw === null) {
      return {
        date,
        frontmatter: { ...FM, title: date },
        entries: [],
      };
    }
    return parseJournalDoc(date, raw);
  }

  async function persist(doc: JournalDoc) {
    const { frontmatter, body } = splitDoc(serializeJournalDoc(doc));
    const rel = relPath(doc.date);
    await fm.writeNote(rel, body, frontmatter);
    await indexer.reindexNote(rel);
    // C6: reindexNote does not derive doc_type for top-level journal/ files;
    // stamp it here so semantic_search can filter on doc_type:journal.
    db.run("UPDATE notes SET doc_type = 'journal' WHERE path = ?", [rel]);
  }

  async function dayBundle(date: string) {
    const doc = await loadDoc(date);
    const due = tasks
      .list({ status: "open" })
      .tasks.filter((t) => t.due_date === date);
    const related =
      engine && embeddings
        ? await buildRelated(date, doc, indexer, engine, embeddings)
        : [];
    return { date, entries: doc.entries, tasks_due: due, related };
  }

  router.get("/api/journal/today", async () => {
    return Response.json(await dayBundle(todayKey()));
  });

  // Register the literal calendar route BEFORE `/api/journal/:date` so that
  // `:date` (a single segment) does not capture "calendar".
  router.get("/api/journal/calendar", async (req) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const metas = await fm.listNotes("journal");
    const dates = metas
      .map((m) => m.path.replace(/^journal\//, "").replace(/\.md$/, ""))
      .filter((d) => isValidDayKey(d))
      .filter((d) => (!from || d >= from) && (!to || d <= to));
    const out = await Promise.all(
      dates.map(async (date) => {
        const raw = await fm.readRaw(relPath(date));
        const count = raw ? parseJournalDoc(date, raw).entries.length : 0;
        return { date, count };
      }),
    );
    return Response.json(out);
  });

  router.get("/api/journal/:date", async (_req, p) => {
    if (!isValidDayKey(p.date)) return badDate();
    return Response.json(await dayBundle(p.date));
  });

  router.post("/api/journal/:date/entries", async (req, p) => {
    if (!isValidDayKey(p.date)) return badDate();
    const { body } = (await req.json()) as { body?: string };
    if (!body || !body.trim())
      return Response.json({ error: "body required" }, { status: 400 });
    const doc = appendEntry(await loadDoc(p.date), nowIso(), body);
    await persist(doc);
    return Response.json(await dayBundle(p.date));
  });

  router.patch("/api/journal/:date/entries/:id", async (req, p) => {
    if (!isValidDayKey(p.date)) return badDate();
    const { body } = (await req.json()) as { body?: string };
    if (!body || !body.trim())
      return Response.json({ error: "body required" }, { status: 400 });
    const doc = editEntry(await loadDoc(p.date), p.id, body);
    await persist(doc);
    return Response.json(await dayBundle(p.date));
  });

  router.delete("/api/journal/:date/entries/:id", async (_req, p) => {
    if (!isValidDayKey(p.date)) return badDate();
    const doc = deleteEntry(await loadDoc(p.date), p.id);
    await persist(doc);
    return Response.json(await dayBundle(p.date));
  });
}

function badDate() {
  return Response.json({ error: "invalid date" }, { status: 400 });
}

// Re-split a serialized doc back into (frontmatter, body) for writeNote,
// which takes them separately.
function splitDoc(serialized: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const { frontmatter, body } = parseFrontmatter(serialized);
  return { frontmatter, body };
}

export { formatEntryDateTime };
