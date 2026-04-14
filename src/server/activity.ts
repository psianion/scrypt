// src/server/activity.ts
import type { Database } from "bun:sqlite";

export type ActivityAction = "create" | "update" | "delete" | "append" | "snapshot";
export type ActivityActor = "claude" | "ui" | "watcher" | "system";

interface ActivityRecord {
  action: ActivityAction;
  kind: string | null;
  path: string;
  actor: ActivityActor;
  meta?: Record<string, unknown>;
}

interface ActivityQuery {
  since?: string;
  until?: string;
  actor?: ActivityActor;
  kind?: string;
  action?: ActivityAction;
  limit?: number;
}

interface ActivityRow {
  id: number;
  timestamp: string;
  action: ActivityAction;
  kind: string | null;
  path: string;
  actor: ActivityActor;
  meta: Record<string, unknown> | null;
}

export class ActivityLog {
  constructor(private db: Database) {}

  record(rec: ActivityRecord): void {
    const timestamp = new Date().toISOString();
    const meta = rec.meta ? JSON.stringify(rec.meta) : null;
    this.db
      .query(
        `INSERT INTO activity_log (timestamp, action, kind, path, actor, meta)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(timestamp, rec.action, rec.kind, rec.path, rec.actor, meta);
  }

  query(q: ActivityQuery): ActivityRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.since) {
      where.push("timestamp >= ?");
      params.push(q.since);
    }
    if (q.until) {
      where.push("timestamp < ?");
      params.push(q.until);
    }
    if (q.actor) {
      where.push("actor = ?");
      params.push(q.actor);
    }
    if (q.kind) {
      where.push("kind = ?");
      params.push(q.kind);
    }
    if (q.action) {
      where.push("action = ?");
      params.push(q.action);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = q.limit ?? 100;
    const sql = `SELECT id, timestamp, action, kind, path, actor, meta
                 FROM activity_log
                 ${whereClause}
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ?`;
    const rows = this.db.query(sql).all(...params, limit) as unknown as any[];
    return rows.map((r) => ({
      ...r,
      meta: r.meta ? JSON.parse(r.meta) : null,
    }));
  }
}
