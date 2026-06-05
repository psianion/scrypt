// src/server/indexer.ts
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join, dirname, posix } from "node:path";
import type { FileManager } from "./file-manager";
import {
  parseFrontmatter,
  extractTags,
} from "./parsers";
import { parseStructural } from "./indexer/structural-parse";
import { extractReferenceTargets } from "./indexer/reference-links";
import { computeContentHash } from "./sync/content-hash";
import type { SectionsRepo } from "./indexer/sections-repo";
import type { EmbedderLike } from "./embeddings/service";
import type {
  SearchResult,
  Backlink,
  LocalGraphNode,
  LocalGraphEdge,
  Task,
} from "../shared/types";

interface Wave8Pipeline {
  sections: SectionsRepo;
  embedService: EmbedderLike;
}

export interface IndexScheduleHook {
  schedule(project: string): void;
}

export class Indexer {
  private scheduler?: IndexScheduleHook;

  constructor(
    private db: Database,
    private fm: FileManager,
    private wave8?: Wave8Pipeline,
  ) {}

  setIndexScheduler(hook: IndexScheduleHook): void {
    this.scheduler = hook;
  }

  private slugifyTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private writeLinkIndexRows(path: string, title: string): void {
    this.db.query("DELETE FROM link_index WHERE path = ?").run(path);

    const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
    const pathSlug = path.replace(/\.md$/, "");
    const titleSlug = title ? this.slugifyTitle(title) : "";

    const insert = this.db.query(
      "INSERT OR IGNORE INTO link_index (slug, path, title) VALUES (?, ?, ?)",
    );
    insert.run(basename, path, title);
    if (pathSlug !== basename) insert.run(pathSlug, path, title);
    if (titleSlug && titleSlug !== basename) insert.run(titleSlug, path, title);
  }

  async fullReindex(): Promise<void> {
    const notes = await this.fm.listNotes();
    const indexedPaths = new Set(notes.map((n) => n.path));

    // Remove stale
    const existing = this.db
      .query("SELECT path FROM notes")
      .all() as { path: string }[];
    for (const row of existing) {
      if (!indexedPaths.has(row.path)) {
        await this.removeNote(row.path);
      }
    }

    // Pass 1: index all notes to ensure all records exist in DB.
    // Skip embedding — recovery handles bulk embed on startup.
    for (const note of notes) {
      await this.reindexNote(note.path, { skipEmbed: true });
    }

    // Pass 2: re-resolve cross-references now that all notes are indexed.
    this.db.query("UPDATE notes SET content_hash = ''").run();
    for (const note of notes) {
      await this.reindexNote(note.path, { skipEmbed: true });
    }
  }

  async reindexNote(path: string, opts?: { skipEmbed?: boolean }): Promise<void> {
    const note = await this.fm.readNote(path);
    if (!note) return;

    const contentHash = computeContentHash(note.frontmatter, note.content);

    const existing = this.db
      .query("SELECT id, content_hash FROM notes WHERE path = ?")
      .get(path) as { id: number; content_hash: string } | null;

    // Wave 8 / F3: mirror the note into graph_nodes so the TEXT-keyed graph
    // layer (walked by /api/graph, Louvain, semantic edges) and the sync
    // hub manifest always have a row carrying the engine's computeContentHash.
    // This runs BEFORE the unchanged-content early-return below so a re-create
    // of byte-identical content can never leave graph_nodes.content_hash stale
    // (e.g. a wrong sha256 written by an upstream create_note upsert).
    this.db
      .query(
        `INSERT INTO graph_nodes (id, kind, note_path, label, content_hash)
         VALUES (?, 'note', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           content_hash = excluded.content_hash`,
      )
      .run(path, path, note.title ?? "", contentHash);

    if (existing && existing.content_hash === contentHash) return;

    const tagsJson = JSON.stringify(note.tags ?? []);
    let noteId: number;
    if (existing) {
      this.db
        .query(
          "UPDATE notes SET title = ?, content_hash = ?, created = ?, modified = ?, domain = ?, subdomain = ?, tags = ? WHERE id = ?"
        )
        .run(
          note.title,
          contentHash,
          note.created,
          note.modified,
          note.domain,
          note.subdomain,
          tagsJson,
          existing.id,
        );
      noteId = existing.id;
      this.clearNoteRelations(noteId, path);
    } else {
      this.db
        .query(
          "INSERT INTO notes (path, title, content_hash, created, modified, domain, subdomain, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          path,
          note.title,
          contentHash,
          note.created,
          note.modified,
          note.domain,
          note.subdomain,
          tagsJson,
        );
      noteId = Number(
        (this.db.query("SELECT last_insert_rowid() as id").get() as any).id
      );
    }

    // FTS5 — body is the legacy indexer's responsibility. Metadata + edge
    // reasons get filled in by refreshNoteFts (called from MCP write tools).
    // We pull whatever metadata/edges already exist so a body reindex never
    // wipes a previously-indexed metadata blob.
    const metaRow = this.db
      .query<
        {
          description: string | null;
          summary: string | null;
          entities: string | null;
          themes: string | null;
        },
        [string]
      >(
        `SELECT description, summary, entities, themes
           FROM note_metadata WHERE note_path = ?`,
      )
      .get(path);
    const edgeRows = this.db
      .query<{ reason: string | null }, [string, string]>(
        `SELECT reason FROM graph_edges WHERE source = ? OR target = ?`,
      )
      .all(path, path);
    const summaryText = metaRow
      ? [metaRow.description, metaRow.summary]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .join(" ")
      : "";
    let entitiesText = "";
    if (metaRow?.entities) {
      try {
        const parsed = JSON.parse(metaRow.entities) as Array<{ name?: unknown }>;
        if (Array.isArray(parsed)) {
          entitiesText = parsed
            .map((e) => (e && typeof e.name === "string" ? e.name : ""))
            .filter(Boolean)
            .join(" ");
        }
      } catch {
        entitiesText = "";
      }
    }
    let themesText = "";
    if (metaRow?.themes) {
      try {
        const parsed = JSON.parse(metaRow.themes) as unknown;
        if (Array.isArray(parsed)) {
          themesText = parsed
            .filter((t): t is string => typeof t === "string")
            .join(" ");
        }
      } catch {
        themesText = "";
      }
    }
    const edgeReasonsText = edgeRows
      .map((r) => r.reason)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ");
    this.db
      .query(
        `INSERT OR REPLACE INTO notes_fts
           (rowid, title, content, path, summary, entities, themes, edge_reasons)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        noteId,
        note.title,
        note.content,
        path,
        summaryText,
        entitiesText,
        themesText,
        edgeReasonsText,
      );

    // Aliases
    if (note.aliases.length > 0) {
      const stmt = this.db.query("INSERT OR IGNORE INTO aliases (note_id, alias) VALUES (?, ?)");
      for (const alias of note.aliases) {
        stmt.run(noteId, alias);
      }
    }

    // Tags
    const tags = extractTags(note.content, note.frontmatter);
    const tagStmt = this.db.query("INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)");
    for (const tag of tags) {
      tagStmt.run(noteId, tag);
    }

    // Structural reference edges (spec C2): the body IS scanned for explicit
    // references — markdown links, [[wikilinks]], see-also, and citations —
    // which become graph_edges (tier 'mentions', client_tag NULL) via
    // linkReferenceEdges below. (Cosine similarity edges are produced
    // separately; curated typed edges come from the add_edge MCP tool.)

    // Wave 9: legacy checkbox-based task extraction is dead. Tasks now come
    // from MCP create_task (LLM-decided during ingest, or ad-hoc) against the
    // new tasks schema (id/note_path/title/type/status/...). The old shape
    // (note_id/text/done/line) was dropped in wave9 migration.

    this.writeLinkIndexRows(note.path, note.title ?? "");

    // Spec C2: deterministic reference edges. Extract explicit references
    // (md links, wikilinks, see-also, citations) from the body and write
    // them as structural graph_edges (client_tag NULL). clearNoteRelations
    // already deleted this note's prior NULL-client_tag edges above, so this
    // regenerates them on every content-changed reindex (fullReindex zeroes
    // hashes so both passes run); UNIQUE(source,target,tier) + INSERT OR
    // IGNORE keep it idempotent.
    this.linkReferenceEdges(note.path, note.content);

    // Phase 9: a sync pull / file-watch / create_note reindex of a note
    // under projects/<project>/ refreshes that project's _index.md (C6).
    // Derived inline from the path (projects/<project>/<doc_type>/<slug>.md);
    // there is no shared vault-path helper to reuse. Loose notes schedule
    // nothing. Debounced + single-flight per project inside IndexNoteScheduler.
    this.scheduleProjectIndex(note.path);

    if (this.wave8) {
      const raw = await this.fm.readRaw(path);
      if (raw !== null) {
        const parsed = parseStructural(path, raw);
        this.wave8.sections.replaceNoteSections(
          path,
          parsed.sections.map((s) => ({
            id: s.id,
            headingSlug: s.headingSlug,
            headingText: s.headingText,
            level: s.level,
            startLine: s.startLine,
            endLine: s.endLine,
          })),
        );
        if (!opts?.skipEmbed && process.env.SCRYPT_EMBED_DISABLE !== "1") {
          try {
            await this.wave8.embedService.embedNote(parsed, randomUUID());
          } catch (err) {
            console.error(`[scrypt] embed failed for ${path}:`, err);
          }
        }
      }
    }
  }

  async removeNote(path: string): Promise<void> {
    const row = this.db
      .query("SELECT id FROM notes WHERE path = ?")
      .get(path) as { id: number } | null;
    if (!row) return;

    this.clearNoteRelations(row.id, path);
    this.db.query("DELETE FROM notes_fts WHERE rowid = ?").run(row.id);
    this.db.query("DELETE FROM notes WHERE id = ?").run(row.id);
    this.db.query("DELETE FROM link_index WHERE path = ?").run(path);
    // Remove the note from the TEXT graph along with any edges touching it
    // (including semantic edges — the note is gone, so edges pointing at
    // it are stale).
    this.db
      .query("DELETE FROM graph_edges WHERE source = ? OR target = ?")
      .run(path, path);
    this.db.query("DELETE FROM graph_nodes WHERE id = ?").run(path);
  }

  search(query: string): SearchResult[] {
    const rows = this.db
      .query(
        `SELECT n.path, n.title, snippet(notes_fts, 1, '<b>', '</b>', '...', 32) as snippet
         FROM notes_fts
         JOIN notes n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY notes_fts.rank
         LIMIT 50`
      )
      .all(query) as { path: string; title: string; snippet: string }[];

    return rows.map((r) => ({
      path: r.path,
      title: r.title || r.path,
      snippet: r.snippet,
    }));
  }

  getBacklinks(path: string): Backlink[] {
    return this.db
      .query(
        `SELECT n.path as sourcePath, n.title as sourceTitle, b.context
         FROM backlinks b
         JOIN notes n ON n.id = b.source_id
         WHERE b.target_id = (SELECT id FROM notes WHERE path = ?)`
      )
      .all(path) as Backlink[];
  }

  getIncomingEdges(path: string): Array<{
    source: string;
    target: string;
    tier: string;
    reason: string | null;
  }> {
    return this.db
      .query(
        `SELECT source, target, tier, reason
         FROM graph_edges WHERE target = ?`,
      )
      .all(path) as Array<{
        source: string;
        target: string;
        tier: string;
        reason: string | null;
      }>;
  }

  getGraph(): { nodes: LocalGraphNode[]; edges: LocalGraphEdge[] } {
    const nodes = this.db
      .query(
        `SELECT n.path as id, n.path, n.title,
                (SELECT count(*) FROM graph_edges
                 WHERE source = n.path OR target = n.path) as connections
         FROM notes n`,
      )
      .all() as LocalGraphNode[];

    for (const node of nodes) {
      const tags = this.db
        .query(
          "SELECT t.tag FROM tags t JOIN notes n ON n.id = t.note_id WHERE n.path = ?",
        )
        .all(node.id) as { tag: string }[];
      node.tags = tags.map((t) => t.tag);
    }

    const edges = this.db
      .query(
        "SELECT source, target, tier as type FROM graph_edges",
      )
      .all() as LocalGraphEdge[];

    return { nodes, edges };
  }

  getLocalGraph(
    path: string,
    depth: number = 2,
  ): { nodes: LocalGraphNode[]; edges: LocalGraphEdge[] } {
    const startNote = this.db
      .query("SELECT path FROM notes WHERE path = ?")
      .get(path) as { path: string } | null;
    if (!startNote) return { nodes: [], edges: [] };

    const visited = new Set<string>([startNote.path]);
    const queue: { id: string; d: number }[] = [
      { id: startNote.path, d: 0 },
    ];

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;

      const neighbors = this.db
        .query(
          `SELECT DISTINCT CASE WHEN source = ? THEN target ELSE source END as neighbor
           FROM graph_edges WHERE source = ? OR target = ?`,
        )
        .all(id, id, id) as { neighbor: string }[];

      for (const n of neighbors) {
        if (!visited.has(n.neighbor)) {
          visited.add(n.neighbor);
          queue.push({ id: n.neighbor, d: d + 1 });
        }
      }
    }

    const ids = Array.from(visited);
    if (ids.length === 0) return { nodes: [], edges: [] };
    const placeholders = ids.map(() => "?").join(",");

    const nodes = this.db
      .query(
        `SELECT n.path as id, n.path, n.title,
                (SELECT count(*) FROM graph_edges
                 WHERE source = n.path OR target = n.path) as connections
         FROM notes n WHERE n.path IN (${placeholders})`,
      )
      .all(...ids) as LocalGraphNode[];

    for (const node of nodes) {
      const tags = this.db
        .query(
          "SELECT t.tag FROM tags t JOIN notes n ON n.id = t.note_id WHERE n.path = ?",
        )
        .all(node.id) as { tag: string }[];
      node.tags = tags.map((t) => t.tag);
    }

    const edges = this.db
      .query(
        `SELECT source, target, tier as type
         FROM graph_edges
         WHERE source IN (${placeholders}) AND target IN (${placeholders})`,
      )
      .all(...ids, ...ids) as LocalGraphEdge[];

    return { nodes, edges };
  }

  getTags(): { tag: string; count: number }[] {
    return this.db
      .query("SELECT tag, count(*) as count FROM tags GROUP BY tag ORDER BY count DESC")
      .all() as { tag: string; count: number }[];
  }

  // Wave 9: legacy getTasks/updateTask removed. Tasks now live in the new
  // tasks schema (id/note_path/title/type/status/...) and are accessed via
  // the MCP create_task / get_task / list_tasks / update_task / delete_task
  // tools (src/server/mcp/tools/*-task.ts) and the TasksRepo
  // (src/server/indexer/tasks-repo.ts).

  private clearNoteRelations(noteId: number, notePath: string): void {
    this.db.query("DELETE FROM backlinks WHERE source_id = ?").run(noteId);
    this.db.query("DELETE FROM tags WHERE note_id = ?").run(noteId);
    // Only clear structural edges (client_tag IS NULL). Semantic edges
    // added by Wave 8 MCP tools are keyed by client_tag and must survive
    // a reindex of the source note.
    this.db
      .query(
        "DELETE FROM graph_edges WHERE source = ? AND client_tag IS NULL",
      )
      .run(notePath);
    // Wave 9: tasks are no longer joined to notes via note_id. They live
    // standalone in the new tasks schema and are managed via MCP tools.
    this.db.query("DELETE FROM aliases WHERE note_id = ?").run(noteId);
  }

  private linkReferenceEdges(sourcePath: string, body: string): void {
    const targets = extractReferenceTargets(body);
    if (targets.length === 0) return;

    const insert = this.db.query(
      `INSERT OR IGNORE INTO graph_edges
         (source, target, tier, weight, reason, client_tag, created_at)
       VALUES (?, ?, 'mentions', NULL, ?, NULL, ?)`,
    );
    const now = Date.now();
    const seenTargets = new Set<string>();
    for (const t of targets) {
      // First: try to resolve as a source-relative vault path.
      // E.g. source=projects/p/spec/a.md + target=../plan/c.md → projects/p/plan/c.md
      // Only accepted if a note row actually EXISTS at that path (no false edges).
      let resolved: string | null = null;
      if (t.raw && !t.raw.includes(" ")) {
        const candidate = posix.normalize(
          join(dirname(sourcePath), t.raw).replace(/\\/g, "/"),
        ).replace(/^\.\//, "");
        const exists = this.db
          .query("SELECT 1 FROM notes WHERE path = ?")
          .get(candidate) as 1 | null;
        if (exists) resolved = candidate;
      }
      // Fall back to title/alias/absolute resolution.
      if (!resolved) resolved = this.resolveLink(t.raw);
      if (!resolved || resolved === sourcePath) continue;
      if (seenTargets.has(resolved)) continue;
      seenTargets.add(resolved);
      insert.run(sourcePath, resolved, t.reason, now);
    }
  }

  private scheduleProjectIndex(notePath: string): void {
    if (!this.scheduler) return;
    const parts = notePath.split("/");
    // Don't recurse: regenerating _index.md must not schedule another regen.
    if (parts[parts.length - 1] === "_index.md") return;
    if (parts[0] !== "projects" || parts.length < 2 || !parts[1]) return;
    this.scheduler.schedule(parts[1]);
  }

  private resolveLink(target: string): string | null {
    // Try direct path match (with .md extension, in notes/ directory)
    const directPath = target.endsWith(".md") ? target : `notes/${target}.md`;
    const direct = this.db
      .query("SELECT path FROM notes WHERE path = ?")
      .get(directPath) as { path: string } | null;
    if (direct) return direct.path;

    // Try matching by title (case-insensitive)
    const byTitle = this.db
      .query("SELECT path FROM notes WHERE lower(title) = lower(?)")
      .get(target) as { path: string } | null;
    if (byTitle) return byTitle.path;

    // Try matching by alias
    const byAlias = this.db
      .query(
        "SELECT n.path FROM notes n JOIN aliases a ON a.note_id = n.id WHERE lower(a.alias) = lower(?)"
      )
      .get(target) as { path: string } | null;
    if (byAlias) return byAlias.path;

    return null;
  }
}
