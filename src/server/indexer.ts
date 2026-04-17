// src/server/indexer.ts
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { FileManager } from "./file-manager";
import {
  parseFrontmatter,
  extractWikiLinks,
  extractTags,
} from "./parsers";
import { resolveSlug } from "./slug-resolver";
import { parseStructural } from "./indexer/structural-parse";
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

export class Indexer {
  constructor(
    private db: Database,
    private fm: FileManager,
    private wave8?: Wave8Pipeline,
  ) {}

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

    const raw = `${JSON.stringify(note.frontmatter)}${note.content}`;
    const contentHash = Bun.hash(raw).toString(16);

    const existing = this.db
      .query("SELECT id, content_hash FROM notes WHERE path = ?")
      .get(path) as { id: number; content_hash: string } | null;

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

    // Wave 8: mirror the note into graph_nodes so the TEXT-keyed graph
    // layer (walked by /api/graph, /api/graph/*path, Louvain, semantic
    // edges) always has a row for every note.
    this.db
      .query(
        `INSERT INTO graph_nodes (id, kind, note_path, label, content_hash)
         VALUES (?, 'note', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           content_hash = excluded.content_hash`,
      )
      .run(path, path, note.title ?? "", contentHash);

    // FTS5
    this.db.query("INSERT OR REPLACE INTO notes_fts (rowid, title, content, path) VALUES (?, ?, ?, ?)").run(noteId, note.title, note.content, path);

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

    // Wiki-links → backlinks + graph_edges
    const links = extractWikiLinks(note.content);
    for (const link of links) {
      const match = resolveSlug(link.target, this.db);
      const targetPath = match ? match.path : this.resolveLink(link.target);
      if (!targetPath) continue;

      const target = this.db
        .query("SELECT id FROM notes WHERE path = ?")
        .get(targetPath) as { id: number } | null;
      if (!target) continue;

      // Extract context: the line containing the link
      const contextLine = note.content
        .split("\n")
        .find((l) => l.includes(`[[${link.target}`)) || "";

      this.db
        .query("INSERT OR IGNORE INTO backlinks (source_id, target_id, context) VALUES (?, ?, ?)")
        .run(noteId, target.id, contextLine.trim());

      // Ensure the target has a graph_nodes row even if it hasn't been
      // fully reindexed yet (e.g. during fullReindex pass 1).
      this.db
        .query(
          `INSERT OR IGNORE INTO graph_nodes (id, kind, note_path, label)
           VALUES (?, 'note', ?, ?)`,
        )
        .run(targetPath, targetPath, targetPath);

      this.db
        .query(
          `INSERT OR IGNORE INTO graph_edges
             (source, target, relation, weight, created_at)
           VALUES (?, ?, 'wikilink', 3, ?)`,
        )
        .run(path, targetPath, Date.now());
    }

    // Wave 9: legacy checkbox-based task extraction is dead. Tasks now come
    // from MCP create_task (LLM-decided during ingest, or ad-hoc) against the
    // new tasks schema (id/note_path/title/type/status/...). The old shape
    // (note_id/text/done/line) was dropped in wave9 migration.

    this.writeLinkIndexRows(note.path, note.title ?? "");

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
        "SELECT source, target, relation as type FROM graph_edges",
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
        `SELECT source, target, relation as type
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
