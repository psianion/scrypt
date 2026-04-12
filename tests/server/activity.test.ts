import { describe, test, expect, beforeEach } from "bun:test";
import { createDatabase, initSchema } from "../../src/server/db";
import { ActivityLog } from "../../src/server/activity";
import type { Database } from "bun:sqlite";

let db: Database;
let log: ActivityLog;

beforeEach(() => {
  db = createDatabase(":memory:");
  initSchema(db);
  log = new ActivityLog(db);
});

describe("ActivityLog.record", () => {
  test("inserts a row with all fields", () => {
    log.record({
      action: "create",
      kind: "thread",
      path: "notes/threads/foo.md",
      actor: "claude",
      meta: { bytes: 123 },
    });
    const rows = db.query("SELECT * FROM activity_log").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].kind).toBe("thread");
    expect(rows[0].path).toBe("notes/threads/foo.md");
    expect(rows[0].actor).toBe("claude");
    expect(JSON.parse(rows[0].meta).bytes).toBe(123);
    expect(rows[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("stores null kind", () => {
    log.record({
      action: "update",
      kind: null,
      path: "notes/hand.md",
      actor: "watcher",
    });
    const row = db.query("SELECT kind FROM activity_log").get() as any;
    expect(row.kind).toBeNull();
  });
});

describe("ActivityLog.query", () => {
  beforeEach(() => {
    log.record({
      action: "create",
      kind: "thread",
      path: "notes/threads/a.md",
      actor: "claude",
    });
    log.record({
      action: "update",
      kind: "note",
      path: "notes/b.md",
      actor: "ui",
    });
    log.record({
      action: "create",
      kind: "research_run",
      path: "notes/research/r.md",
      actor: "claude",
    });
  });

  test("returns all rows ordered by timestamp DESC when no filters", () => {
    const rows = log.query({});
    expect(rows).toHaveLength(3);
  });

  test("filters by actor", () => {
    const rows = log.query({ actor: "claude" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor === "claude")).toBe(true);
  });

  test("filters by kind", () => {
    const rows = log.query({ kind: "note" });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("notes/b.md");
  });

  test("respects limit", () => {
    const rows = log.query({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  test("filters by since", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const rows = log.query({ since: future });
    expect(rows).toHaveLength(0);
  });
});
