// src/server/indexer/tasks-repo.ts
//
// CRUD over the Wave 9 `tasks` table. Mirrors metadata-repo's shape:
// thin wrapper above bun:sqlite with JSON-friendly marshalling for metadata.
import type { Database } from "bun:sqlite";

export const TASK_TYPES = [
  "BRAINSTORM",
  "PLAN",
  "BUILD",
  "RESEARCH",
  "REVIEW",
  "CUSTOM",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["open", "in_progress", "closed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskCreate {
  note_path?: string | null;
  title: string;
  type: TaskType;
  status?: TaskStatus;
  due_date?: string | null;
  priority?: number;
  metadata?: Record<string, unknown> | null;
  client_tag?: string | null;
}

export interface TaskUpdate {
  title?: string;
  type?: TaskType;
  status?: TaskStatus;
  due_date?: string | null;
  priority?: number;
  metadata?: Record<string, unknown> | null;
}

export interface Task {
  id: number;
  note_path: string | null;
  title: string;
  type: TaskType;
  status: TaskStatus;
  due_date: string | null;
  priority: number;
  metadata: Record<string, unknown> | null;
  client_tag: string | null;
  created_at: number;
  updated_at: number;
}

interface Row {
  id: number;
  note_path: string | null;
  title: string;
  type: string;
  status: string;
  due_date: string | null;
  priority: number;
  metadata: string | null;
  client_tag: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: Row): Task {
  return {
    id: row.id,
    note_path: row.note_path,
    title: row.title,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    due_date: row.due_date,
    priority: row.priority,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    client_tag: row.client_tag,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ListFilter {
  note_path?: string;
  type?: TaskType;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

export class TasksRepo {
  constructor(private db: Database) {}

  create(input: TaskCreate): Task {
    const now = Date.now();
    const res = this.db
      .query(
        `INSERT INTO tasks
           (note_path, title, type, status, due_date, priority, metadata, client_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.note_path ?? null,
        input.title,
        input.type,
        input.status ?? "open",
        input.due_date ?? null,
        input.priority ?? 0,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.client_tag ?? null,
        now,
        now,
      );
    const id = Number(res.lastInsertRowid);
    return this.get(id)!;
  }

  get(id: number): Task | null {
    const row = this.db
      .query<Row, [number]>(`SELECT * FROM tasks WHERE id = ?`)
      .get(id);
    return row ? rowToTask(row) : null;
  }

  list(filter: ListFilter = {}): { tasks: Task[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.note_path !== undefined) {
      where.push(`note_path = ?`);
      params.push(filter.note_path);
    }
    if (filter.type !== undefined) {
      where.push(`type = ?`);
      params.push(filter.type);
    }
    if (filter.status !== undefined) {
      where.push(`status = ?`);
      params.push(filter.status);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const total =
      (this.db
        .query<{ c: number }, (string | number)[]>(
          `SELECT COUNT(*) AS c FROM tasks ${whereClause}`,
        )
        .get(...params)?.c) ?? 0;

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .query<Row, (string | number)[]>(
        `SELECT * FROM tasks ${whereClause}
         ORDER BY priority DESC, (due_date IS NULL) ASC, due_date ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return { tasks: rows.map(rowToTask), total };
  }

  update(id: number, patch: TaskUpdate): Task | null {
    const existing = this.get(id);
    if (!existing) return null;
    const merged: Task = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      updated_at: Date.now(),
    };
    this.db
      .query(
        `UPDATE tasks SET
           title = ?, type = ?, status = ?, due_date = ?, priority = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.title,
        merged.type,
        merged.status,
        merged.due_date,
        merged.priority,
        merged.metadata ? JSON.stringify(merged.metadata) : null,
        merged.updated_at,
        id,
      );
    return this.get(id);
  }

  delete(id: number): boolean {
    const res = this.db.query(`DELETE FROM tasks WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
