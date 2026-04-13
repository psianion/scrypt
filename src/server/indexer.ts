// src/server/indexer.ts
import type { Database } from "bun:sqlite";
import type { FileManager } from "./file-manager";
import {
  parseFrontmatter,
  extractWikiLinks,
  extractTags,
  extractTasks,
} from "./parsers";
import { resolveSlug } from "./slug-resolver";
import type {
  SearchResult,
  Backlink,
  GraphNode,
  GraphEdge,
  Task,
} from "../shared/types";

export class Indexer {
  constructor(
    private db: Database,
    private fm: FileManager
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

    // Pass 1: index all notes to ensure all records exist in DB
    for (const note of notes) {
      await this.reindexNote(note.path);
    }

    // Pass 2: re-resolve cross-references now that all notes are indexed
    this.db.query("UPDATE notes SET content_hash = ''").run();
    for (const note of notes) {
      await this.reindexNote(note.path);
    }
  }

  async reindexNote(path: string): Promise<void> {
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
      this.clearNoteRelations(noteId);
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

      this.db
        .query("INSERT OR IGNORE INTO graph_edges (source_id, target_id, type) VALUES (?, ?, 'link')")
        .run(noteId, target.id);
    }

    // Tasks
    const tasks = extractTasks(note.content);
    const taskStmt = this.db.query(
      "INSERT INTO tasks (note_id, text, done, line) VALUES (?, ?, ?, ?)"
    );
    for (const task of tasks) {
      taskStmt.run(noteId, task.text, task.done ? 1 : 0, task.line);
    }

    this.writeLinkIndexRows(note.path, note.title ?? "");
  }

  async removeNote(path: string): Promise<void> {
    const row = this.db
      .query("SELECT id FROM notes WHERE path = ?")
      .get(path) as { id: number } | null;
    if (!row) return;

    this.clearNoteRelations(row.id);
    this.db.query("DELETE FROM notes_fts WHERE rowid = ?").run(row.id);
    this.db.query("DELETE FROM notes WHERE id = ?").run(row.id);
    this.db.query("DELETE FROM link_index WHERE path = ?").run(path);
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

  getGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = this.db
      .query(
        `SELECT n.id, n.path, n.title,
                (SELECT count(*) FROM graph_edges WHERE source_id = n.id OR target_id = n.id) as connections
         FROM notes n`
      )
      .all() as (GraphNode & { id: number })[];

    // Attach tags to nodes
    for (const node of nodes) {
      const tags = this.db
        .query("SELECT tag FROM tags WHERE note_id = ?")
        .all(node.id) as { tag: string }[];
      node.tags = tags.map((t) => t.tag);
    }

    const edges = this.db
      .query("SELECT source_id as source, target_id as target, type FROM graph_edges")
      .all() as GraphEdge[];

    return { nodes, edges };
  }

  getLocalGraph(
    path: string,
    depth: number = 2
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const startNote = this.db
      .query("SELECT id FROM notes WHERE path = ?")
      .get(path) as { id: number } | null;
    if (!startNote) return { nodes: [], edges: [] };

    const visited = new Set<number>();
    const queue: { id: number; d: number }[] = [{ id: startNote.id, d: 0 }];
    visited.add(startNote.id);

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;

      const neighbors = this.db
        .query(
          `SELECT DISTINCT CASE WHEN source_id = ? THEN target_id ELSE source_id END as neighbor_id
           FROM graph_edges WHERE source_id = ? OR target_id = ?`
        )
        .all(id, id, id) as { neighbor_id: number }[];

      for (const n of neighbors) {
        if (!visited.has(n.neighbor_id)) {
          visited.add(n.neighbor_id);
          queue.push({ id: n.neighbor_id, d: d + 1 });
        }
      }
    }

    const ids = Array.from(visited);
    const placeholders = ids.map(() => "?").join(",");

    const nodes = this.db
      .query(
        `SELECT n.id, n.path, n.title,
                (SELECT count(*) FROM graph_edges WHERE source_id = n.id OR target_id = n.id) as connections
         FROM notes n WHERE n.id IN (${placeholders})`
      )
      .all(...ids) as GraphNode[];

    for (const node of nodes) {
      const tags = this.db
        .query("SELECT tag FROM tags WHERE note_id = ?")
        .all((node as any).id) as { tag: string }[];
      node.tags = tags.map((t) => t.tag);
    }

    const edges = this.db
      .query(
        `SELECT source_id as source, target_id as target, type
         FROM graph_edges
         WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`
      )
      .all(...ids, ...ids) as GraphEdge[];

    return { nodes, edges };
  }

  getTags(): { tag: string; count: number }[] {
    return this.db
      .query("SELECT tag, count(*) as count FROM tags GROUP BY tag ORDER BY count DESC")
      .all() as { tag: string; count: number }[];
  }

  getTasks(filters?: {
    board?: string;
    done?: boolean;
    tag?: string;
  }): Task[] {
    let sql = `
      SELECT t.id, t.note_id as noteId, n.path as notePath, t.text, t.done,
             t.due_date as dueDate, t.priority, t.board, t.line
      FROM tasks t
      JOIN notes n ON n.id = t.note_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filters?.board) {
      sql += " AND t.board = ?";
      params.push(filters.board);
    }
    if (filters?.done !== undefined) {
      sql += " AND t.done = ?";
      params.push(filters.done ? 1 : 0);
    }
    if (filters?.tag) {
      sql += " AND t.note_id IN (SELECT note_id FROM tags WHERE tag = ?)";
      params.push(filters.tag);
    }

    return this.db.query(sql).all(...params) as Task[];
  }

  updateTask(
    id: number,
    updates: Partial<Pick<Task, "done" | "board" | "priority">>
  ): void {
    if (updates.done !== undefined) {
      this.db.query("UPDATE tasks SET done = ? WHERE id = ?").run(updates.done ? 1 : 0, id);
    }
    if (updates.board !== undefined) {
      this.db.query("UPDATE tasks SET board = ? WHERE id = ?").run(updates.board, id);
    }
    if (updates.priority !== undefined) {
      this.db.query("UPDATE tasks SET priority = ? WHERE id = ?").run(updates.priority, id);
    }
  }

  private clearNoteRelations(noteId: number): void {
    this.db.query("DELETE FROM backlinks WHERE source_id = ?").run(noteId);
    this.db.query("DELETE FROM tags WHERE note_id = ?").run(noteId);
    this.db.query("DELETE FROM graph_edges WHERE source_id = ?").run(noteId);
    this.db.query("DELETE FROM tasks WHERE note_id = ?").run(noteId);
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
