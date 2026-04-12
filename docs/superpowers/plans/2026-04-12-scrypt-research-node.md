# Scrypt Research Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Scrypt from a local markdown second-brain into a production-ready knowledge server that a separate Claude Orchestrator can drive autonomously, while also polishing the browser UI for daily use.

**Architecture:** Add threads/research_runs/memories/activity_log as first-class concepts, a smart ingest router that places content by `kind`, Bearer token auth with dev bypass, an opt-in git-backed version history, and Docker/systemd packaging for Oracle ARM. The vault remains the source of truth; SQLite is the index; all writes flow through either `/api/ingest` (orchestrator) or the existing note CRUD (UI).

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, React 19, Vite, Tailwind, gray-matter, Docker, systemd, Bun-native `$` shell for git.

**Execution model:** 6 waves. Sequential within each wave; waves build on their predecessors. Each task uses TDD — failing test first, then minimal implementation, then commit.

---

## Wave 1 — Foundations (Sequential)

These are prerequisites for everything else. Must complete in order.

### Task 1: SQLite schema — activity_log and research_runs tables

**Files:**
- Modify: `src/server/db.ts`
- Test: `tests/server/db.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/server/db.test.ts` (new `describe` block, keep existing tests):

```typescript
describe("initSchema > new research node tables", () => {
  test("creates activity_log table with correct columns", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const cols = db
      .query("PRAGMA table_info(activity_log)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["action", "actor", "id", "kind", "meta", "path", "timestamp"].sort(),
    );
  });

  test("creates research_runs table with correct columns", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const cols = db
      .query("PRAGMA table_info(research_runs)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "completed_at",
        "duration_ms",
        "error",
        "id",
        "model",
        "note_path",
        "started_at",
        "status",
        "thread_slug",
        "tokens_in",
        "tokens_out",
      ].sort(),
    );
  });

  test("creates indexes on activity_log and research_runs", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_activity_timestamp");
    expect(names).toContain("idx_activity_actor");
    expect(names).toContain("idx_activity_kind");
    expect(names).toContain("idx_runs_thread");
    expect(names).toContain("idx_runs_status");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/db.test.ts -t "new research node"`
Expected: FAIL — "no such table: activity_log"

- [ ] **Step 3: Extend `initSchema` in `src/server/db.ts`**

Find the existing `initSchema` function and append these `CREATE TABLE` + `CREATE INDEX` statements before the function returns:

```typescript
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT    NOT NULL,
      action     TEXT    NOT NULL,
      kind       TEXT,
      path       TEXT    NOT NULL,
      actor      TEXT    NOT NULL,
      meta       TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor, timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_kind ON activity_log(kind, timestamp DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_slug   TEXT    NOT NULL,
      note_path     TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      started_at    TEXT    NOT NULL,
      completed_at  TEXT,
      duration_ms   INTEGER,
      model         TEXT,
      tokens_in     INTEGER,
      tokens_out    INTEGER,
      error         TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_thread ON research_runs(thread_slug, started_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON research_runs(status, started_at DESC)`);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/db.test.ts -t "new research node"`
Expected: PASS — 3 tests green

- [ ] **Step 5: Run the existing db tests to make sure nothing broke**

Run: `bun test tests/server/db.test.ts`
Expected: PASS — all existing tests still green (idempotency, FTS5, existing tables)

- [ ] **Step 6: Commit**

```bash
git add src/server/db.ts tests/server/db.test.ts
git commit -m "feat: SQLite schema for activity_log and research_runs"
```

---

### Task 2: Environment config loader

**Files:**
- Create: `src/server/config.ts`
- Test: `tests/server/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/config.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type ScryptConfig } from "../../src/server/config";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SCRYPT_") || k === "NODE_ENV") delete process.env[k];
  }
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  test("returns defaults when no env vars set", () => {
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.port).toBe(3777);
    expect(cfg.vaultPath).toBe("/tmp/v");
    expect(cfg.gitAutocommit).toBe(false);
    expect(cfg.gitAutocommitInterval).toBe(900);
    expect(cfg.trashRetentionDays).toBe(30);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.isProduction).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  test("reads SCRYPT_AUTH_TOKEN", () => {
    process.env.SCRYPT_AUTH_TOKEN = "secret-123";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.authToken).toBe("secret-123");
  });

  test("reads SCRYPT_PORT as number", () => {
    process.env.SCRYPT_PORT = "4000";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.port).toBe(4000);
  });

  test("reads SCRYPT_GIT_AUTOCOMMIT=1 as true", () => {
    process.env.SCRYPT_GIT_AUTOCOMMIT = "1";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.gitAutocommit).toBe(true);
  });

  test("reads NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.isProduction).toBe(true);
  });

  test("throws in production when SCRYPT_AUTH_TOKEN is missing", () => {
    process.env.NODE_ENV = "production";
    expect(() => loadConfig({ vaultPath: "/tmp/v" })).toThrow(
      /SCRYPT_AUTH_TOKEN/,
    );
  });

  test("does not throw in dev when SCRYPT_AUTH_TOKEN is missing", () => {
    expect(() => loadConfig({ vaultPath: "/tmp/v" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/config.test.ts`
Expected: FAIL — cannot find `../../src/server/config`

- [ ] **Step 3: Create `src/server/config.ts`**

```typescript
// src/server/config.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ScryptConfig {
  vaultPath: string;
  staticDir?: string;
  port: number;
  authToken: string | undefined;
  isProduction: boolean;
  gitAutocommit: boolean;
  gitAutocommitInterval: number;
  trashRetentionDays: number;
  logLevel: LogLevel;
}

export interface LoadConfigOpts {
  vaultPath: string;
  staticDir?: string;
}

export function loadConfig(opts: LoadConfigOpts): ScryptConfig {
  const env = process.env;
  const isProduction = env.NODE_ENV === "production";
  const authToken = env.SCRYPT_AUTH_TOKEN || undefined;

  if (isProduction && !authToken) {
    throw new Error(
      "SCRYPT_AUTH_TOKEN is required when NODE_ENV=production",
    );
  }

  return {
    vaultPath: opts.vaultPath,
    staticDir: opts.staticDir,
    port: Number(env.SCRYPT_PORT) || 3777,
    authToken,
    isProduction,
    gitAutocommit: env.SCRYPT_GIT_AUTOCOMMIT === "1",
    gitAutocommitInterval: Number(env.SCRYPT_GIT_AUTOCOMMIT_INTERVAL) || 900,
    trashRetentionDays: Number(env.SCRYPT_TRASH_RETENTION_DAYS) || 30,
    logLevel: (env.SCRYPT_LOG_LEVEL as LogLevel) || "info",
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/config.test.ts`
Expected: PASS — 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts tests/server/config.test.ts
git commit -m "feat: env config loader with production auth guard"
```

---

### Task 3: Bearer auth middleware with dev bypass

**Files:**
- Create: `src/server/auth.ts`
- Test: `tests/server/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/auth.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { checkAuth } from "../../src/server/auth";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("checkAuth", () => {
  test("allows dev localhost without token when no token configured", () => {
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: false, authToken: undefined },
    );
    expect(result.ok).toBe(true);
  });

  test("allows dev localhost even when token is configured", () => {
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects non-localhost in dev when token configured and header missing", () => {
    const result = checkAuth(
      req("http://192.168.1.10:3777/api/notes"),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("allows non-localhost in dev with correct Bearer token", () => {
    const result = checkAuth(
      req("http://192.168.1.10:3777/api/notes", {
        authorization: "Bearer secret",
      }),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects wrong token", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", {
        authorization: "Bearer wrong",
      }),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("rejects production localhost without token", () => {
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("accepts case-insensitive authorization header", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", { Authorization: "Bearer secret" }),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("static paths bypass auth", () => {
    const result = checkAuth(
      req("http://example.com/assets/index.js"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("root path bypasses auth (SPA shell)", () => {
    const result = checkAuth(
      req("http://example.com/"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/auth.test.ts`
Expected: FAIL — cannot find `auth` module

- [ ] **Step 3: Create `src/server/auth.ts`**

```typescript
// src/server/auth.ts
export interface AuthState {
  isProduction: boolean;
  authToken: string | undefined;
}

export interface AuthResult {
  ok: boolean;
  reason?: "missing_token" | "wrong_token" | "no_token_configured";
}

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function checkAuth(req: Request, state: AuthState): AuthResult {
  const url = new URL(req.url);

  // Static asset paths and the SPA shell always bypass auth — the shell
  // needs to load before it can send Bearer tokens on API calls.
  if (!url.pathname.startsWith("/api/")) {
    return { ok: true };
  }

  // Dev localhost bypass: when not in production, localhost requests skip auth.
  const isLocalhost = LOCALHOST_HOSTS.has(url.hostname);
  if (!state.isProduction && isLocalhost) {
    return { ok: true };
  }

  // Token required beyond this point. If no token configured and we're in dev,
  // the only allowed calls are the localhost bypass above — external callers
  // get 401.
  if (!state.authToken) {
    return { ok: false, reason: "no_token_configured" };
  }

  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_token" };
  }
  const provided = header.slice("Bearer ".length).trim();
  if (provided !== state.authToken) {
    return { ok: false, reason: "wrong_token" };
  }
  return { ok: true };
}

export function unauthorizedResponse(): Response {
  return new Response("", { status: 401 });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/auth.test.ts`
Expected: PASS — 9 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/auth.ts tests/server/auth.test.ts
git commit -m "feat: Bearer auth with dev localhost bypass"
```

---

### Task 4: Activity log writer and query

**Files:**
- Create: `src/server/activity.ts`
- Test: `tests/server/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/activity.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/activity.test.ts`
Expected: FAIL — cannot find `activity` module

- [ ] **Step 3: Create `src/server/activity.ts`**

```typescript
// src/server/activity.ts
import type { Database } from "bun:sqlite";

export type ActivityAction = "create" | "update" | "delete" | "append" | "snapshot";
export type ActivityActor = "claude" | "ui" | "watcher" | "system";

export interface ActivityRecord {
  action: ActivityAction;
  kind: string | null;
  path: string;
  actor: ActivityActor;
  meta?: Record<string, unknown>;
}

export interface ActivityQuery {
  since?: string;      // ISO timestamp lower bound (inclusive)
  until?: string;      // ISO timestamp upper bound (exclusive)
  actor?: ActivityActor;
  kind?: string;
  action?: ActivityAction;
  limit?: number;      // default 100
}

export interface ActivityRow {
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
    const params: unknown[] = [];
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
    const rows = this.db.query(sql).all(...params, limit) as any[];
    return rows.map((r) => ({
      ...r,
      meta: r.meta ? JSON.parse(r.meta) : null,
    }));
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/activity.test.ts`
Expected: PASS — 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/activity.ts tests/server/activity.test.ts
git commit -m "feat: activity log writer and query module"
```

---

### Task 5: Wire auth and config into createApp

**Files:**
- Modify: `src/server/index.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: Update `tests/helpers.ts` to pass through auth + config**

Read the current `tests/helpers.ts`. Replace the `createApp({...})` line so it supplies an optional `authToken`:

```typescript
// inside createTestEnv, after the directory setup:
const app = createApp({
  vaultPath,
  staticDir: join(vaultPath, ".scrypt", "public"),
});
```

Then extend the returned object with a helper that attaches auth:

```typescript
return {
  vaultPath,
  baseUrl,
  server,
  app,
  async writeNote(path: string, content: string) {
    // ... existing body unchanged
  },
  async cleanup() {
    // ... existing body unchanged
  },
  // NEW: helper for auth-gated fetch
  authFetch(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    // Default test env runs in dev mode from localhost, so no token needed;
    // this helper is future-proof for tests that set NODE_ENV=production.
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  },
};
```

- [ ] **Step 2: Update `src/server/index.ts` to use config + auth**

Find the top of `src/server/index.ts` and add imports:

```typescript
import { loadConfig, type ScryptConfig } from "./config";
import { checkAuth, unauthorizedResponse } from "./auth";
```

Change `createApp(config: AppConfig)` to accept a superset but stay backwards-compatible:

```typescript
export interface AppConfig {
  vaultPath: string;
  staticDir?: string;
  // Test-only overrides — production flows through loadConfig(env)
  authToken?: string;
  isProduction?: boolean;
}

export function createApp(config: AppConfig) {
  const scryptConfig: ScryptConfig = {
    vaultPath: config.vaultPath,
    staticDir: config.staticDir,
    port: 3777,
    authToken: config.authToken,
    isProduction: config.isProduction ?? false,
    gitAutocommit: false,
    gitAutocommitInterval: 900,
    trashRetentionDays: 30,
    logLevel: "info",
  };
  // ... rest of existing body
```

Then in the `fetch` handler, add an auth check immediately before `router.handle(req)`:

```typescript
    fetch(req: Request, server: any): Response | Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Auth gate for /api/*
      const authResult = checkAuth(req, {
        isProduction: scryptConfig.isProduction,
        authToken: scryptConfig.authToken,
      });
      if (!authResult.ok) {
        return unauthorizedResponse();
      }

      const apiResponse = router.handle(req);
      if (apiResponse) return apiResponse;
      // ... existing static fallback unchanged
```

Also update the CLI entry point at the bottom of the file:

```typescript
if (import.meta.main) {
  const config = loadConfig({ vaultPath: process.cwd() });
  const app = createApp({
    vaultPath: config.vaultPath,
    staticDir: config.staticDir,
    authToken: config.authToken,
    isProduction: config.isProduction,
  });
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: app.websocket,
  });
  console.log(`Scrypt running on http://localhost:${server.port}`);
}
```

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`
Expected: PASS — all existing server (111) and client (30) tests still green.

- [ ] **Step 4: Manual smoke test — production mode rejects unauth**

Run: `SCRYPT_AUTH_TOKEN=secret NODE_ENV=production bun src/server/index.ts` in one terminal.
In another terminal, run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3777/api/notes
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong" http://localhost:3777/api/notes
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer secret" http://localhost:3777/api/notes
```
Expected: `401`, `401`, `200`

Kill the server.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts tests/helpers.ts
git commit -m "feat: wire auth middleware and config into createApp"
```

---

### Task 6: Server-owned timestamps + FileManager.readRaw

**Files:**
- Modify: `src/server/parsers.ts`
- Modify: `src/server/file-manager.ts`
- Test: `tests/server/parsers.test.ts`
- Test: `tests/server/file-manager.test.ts`

- [ ] **Step 1: Write the failing test for parsers**

Add to `tests/server/parsers.test.ts`:

```typescript
import { mergeServerTimestamps } from "../../src/server/parsers";

describe("mergeServerTimestamps", () => {
  test("sets created and modified on a brand new note", () => {
    const before = Date.now();
    const out = mergeServerTimestamps({}, { existingCreated: null });
    const after = Date.now();
    expect(out.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.modified).toBe(out.created);
    expect(new Date(out.created as string).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(out.created as string).getTime()).toBeLessThanOrEqual(after);
  });

  test("preserves existing created and bumps modified", async () => {
    const existingCreated = "2026-01-01T00:00:00.000Z";
    await Bun.sleep(2);
    const out = mergeServerTimestamps(
      { title: "X", created: "should-be-ignored" },
      { existingCreated },
    );
    expect(out.created).toBe(existingCreated);
    expect(out.modified).not.toBe(existingCreated);
  });

  test("ignores client-set modified", () => {
    const out = mergeServerTimestamps(
      { modified: "2020-01-01T00:00:00.000Z" },
      { existingCreated: null },
    );
    expect(out.modified).not.toBe("2020-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/parsers.test.ts -t "mergeServerTimestamps"`
Expected: FAIL — `mergeServerTimestamps` not exported

- [ ] **Step 3: Add to `src/server/parsers.ts`**

At the bottom of `src/server/parsers.ts`:

```typescript
export interface TimestampContext {
  existingCreated: string | null;
}

/**
 * Enforces server-owned `created` and `modified` fields on frontmatter.
 * - `created` is set once at first write and never changes afterwards.
 * - `modified` is bumped to now on every call.
 * Client-provided values for either field are ignored.
 */
export function mergeServerTimestamps(
  frontmatter: Record<string, unknown>,
  ctx: TimestampContext,
): Record<string, unknown> {
  const now = new Date().toISOString();
  // Strip client-set values so they can't bleed through
  const { created: _clientCreated, modified: _clientModified, ...rest } =
    frontmatter as Record<string, unknown>;
  return {
    ...rest,
    created: ctx.existingCreated ?? now,
    modified: now,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/parsers.test.ts -t "mergeServerTimestamps"`
Expected: PASS — 3 tests green

- [ ] **Step 5: Run the full parsers test file to ensure nothing broke**

Run: `bun test tests/server/parsers.test.ts`
Expected: PASS — all existing parser tests still green

- [ ] **Step 6: Add `readRaw` to FileManager**

Several upcoming endpoints (threads, memories, daily-context) need to read the raw text of a note without going through the `parseFrontmatter` pipeline. Add a small helper next to `readNote` in `src/server/file-manager.ts`:

```typescript
  async readRaw(path: string): Promise<string | null> {
    const absPath = join(this.vaultPath, path);
    const file = Bun.file(absPath);
    if (!(await file.exists())) return null;
    return await file.text();
  }
```

- [ ] **Step 7: Write the test**

Add to `tests/server/file-manager.test.ts`:

```typescript
describe("readRaw", () => {
  test("returns raw file content including frontmatter", async () => {
    const env = createTmpVault();
    await Bun.write(
      `${env.vaultPath}/notes/raw.md`,
      "---\ntitle: Raw\n---\n\n# Raw body",
    );
    const content = await env.fm.readRaw("notes/raw.md");
    expect(content).toContain("---");
    expect(content).toContain("# Raw body");
    env.cleanup();
  });

  test("returns null for missing file", async () => {
    const env = createTmpVault();
    const content = await env.fm.readRaw("notes/does-not-exist.md");
    expect(content).toBeNull();
    env.cleanup();
  });
});
```

Use whatever `createTmpVault` helper already exists in that test file for the other FileManager tests; match the pattern.

- [ ] **Step 8: Run file-manager tests, verify they pass**

Run: `bun test tests/server/file-manager.test.ts`
Expected: PASS — new readRaw tests green, existing tests still green

- [ ] **Step 9: Commit**

```bash
git add src/server/parsers.ts src/server/file-manager.ts tests/server/parsers.test.ts tests/server/file-manager.test.ts
git commit -m "feat: mergeServerTimestamps + FileManager.readRaw"
```

---

### Task 7: Fix tag parser (hex colors, numbered headings, fence walking)

**Files:**
- Modify: `src/server/parsers.ts`
- Test: `tests/server/parsers.test.ts`

- [ ] **Step 1: Write the failing regression tests**

Add to `tests/server/parsers.test.ts` (inside the existing `describe("extractTags", ...)` block if present, otherwise a new describe):

```typescript
describe("extractTags > regressions", () => {
  test("does NOT pick up 3-char hex colors", () => {
    const tags = extractTags("The color is #fff and #333", {});
    expect(tags).not.toContain("fff");
    expect(tags).not.toContain("333");
  });

  test("does NOT pick up 6-char hex colors", () => {
    const tags = extractTags("Background: #f3f3f3, accent: #333333.", {});
    expect(tags).not.toContain("f3f3f3");
    expect(tags).not.toContain("333333");
  });

  test("does NOT pick up 8-char hex colors (with alpha)", () => {
    const tags = extractTags("rgba-style: #ff00ff80", {});
    expect(tags).not.toContain("ff00ff80");
  });

  test("does NOT pick up numeric-only #1, #2", () => {
    const tags = extractTags("Step #1 then #2 then #3.", {});
    expect(tags).not.toContain("1");
    expect(tags).not.toContain("2");
  });

  test("still picks up alpha tags like #project and #3d-printing", () => {
    const tags = extractTags("#project and #3d-printing are real.", {});
    expect(tags).toContain("project");
    expect(tags).toContain("3d-printing");
  });

  test("skips tags inside fenced code blocks", () => {
    const content = [
      "Normal #realtag here.",
      "```",
      "#fake_inside_fence",
      "```",
      "More #another outside.",
    ].join("\n");
    const tags = extractTags(content, {});
    expect(tags).toContain("realtag");
    expect(tags).toContain("another");
    expect(tags).not.toContain("fake_inside_fence");
  });

  test("skips tags inside inline code spans", () => {
    const tags = extractTags("Use `#inline_fake` but #outline is real.", {});
    expect(tags).toContain("outline");
    expect(tags).not.toContain("inline_fake");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `bun test tests/server/parsers.test.ts -t "regressions"`
Expected: FAIL — hex colors and `#1` are being picked up as tags

- [ ] **Step 3: Rewrite tag extraction in `src/server/parsers.ts`**

Replace the existing `extractTags` function with a fence-aware line walker. Keep the function's signature and the frontmatter tag merge logic; only the content-scanning part changes:

```typescript
const HEX_COLOR = /^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i;
const VALID_TAG = /^[A-Za-z][\w/-]*$/;

function extractInlineTagsFromLine(line: string): string[] {
  // Strip inline code spans before scanning for tags
  const stripped = line.replace(/`[^`]*`/g, "");
  const out: string[] = [];
  const re = /(^|[^\w&])#([\w/-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const tag = m[2];
    if (HEX_COLOR.test(tag)) continue;       // skip colors like #fff, #333333
    if (!VALID_TAG.test(tag)) continue;      // must start with a letter
    out.push(tag);
  }
  return out;
}

export function extractTags(
  content: string,
  frontmatter: Record<string, unknown>,
): string[] {
  const out = new Set<string>();

  // Walk lines, tracking fenced code block state
  const lines = content.split("\n");
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Skip ATX headings? No — tags on headings are valid.
    for (const tag of extractInlineTagsFromLine(line)) out.add(tag);
  }

  // Frontmatter tags
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === "string" && VALID_TAG.test(t)) out.add(t);
    }
  } else if (typeof fmTags === "string" && VALID_TAG.test(fmTags)) {
    out.add(fmTags);
  }

  return Array.from(out);
}
```

- [ ] **Step 4: Run regression tests, verify they pass**

Run: `bun test tests/server/parsers.test.ts -t "regressions"`
Expected: PASS — 7 tests green

- [ ] **Step 5: Run all parser tests to catch any existing behavior you broke**

Run: `bun test tests/server/parsers.test.ts`
Expected: PASS — all tests green (hierarchical tags, frontmatter tags, etc. still work)

- [ ] **Step 6: Run the indexer tests (they use extractTags indirectly)**

Run: `bun test tests/server/indexer.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/parsers.ts tests/server/parsers.test.ts
git commit -m "fix: tag parser skips hex colors, numeric tags, and code blocks"
```

---

## Wave 2 — Slug + Ingest Router (Sequential)

These tasks build the core write path that most of the new API routes delegate to.

### Task 8: Slug generator

**Files:**
- Create: `src/server/slugger.ts`
- Test: `tests/server/slugger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/slugger.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { slugify, uniqueSlug } from "../../src/server/slugger";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("What's new in ARM SVE2?")).toBe("whats-new-in-arm-sve2");
  });

  test("collapses repeated hyphens", () => {
    expect(slugify("a -- b")).toBe("a-b");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  test("strips punctuation", () => {
    expect(slugify("Hello, world!")).toBe("hello-world");
  });

  test("caps at 60 chars at a word boundary", () => {
    const long = "this is a very long title that keeps going and going and going and going";
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });

  test("handles unicode by stripping it", () => {
    expect(slugify("日本語 title")).toBe("title");
  });

  test("returns 'untitled' when input is empty after stripping", () => {
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  test("returns base when no collision", () => {
    expect(uniqueSlug("foo", () => false)).toBe("foo");
  });

  test("appends -2 on first collision", () => {
    const taken = new Set(["foo"]);
    expect(uniqueSlug("foo", (s) => taken.has(s))).toBe("foo-2");
  });

  test("keeps counting until unique", () => {
    const taken = new Set(["foo", "foo-2", "foo-3"]);
    expect(uniqueSlug("foo", (s) => taken.has(s))).toBe("foo-4");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/slugger.test.ts`
Expected: FAIL — cannot find `slugger` module

- [ ] **Step 3: Create `src/server/slugger.ts`**

```typescript
// src/server/slugger.ts
const MAX_LEN = 60;

export function slugify(input: string): string {
  const lowered = input.toLowerCase();
  const ascii = lowered
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length === 0) return "untitled";
  if (ascii.length <= MAX_LEN) return ascii;
  // Cut at the last hyphen before MAX_LEN
  const clipped = ascii.slice(0, MAX_LEN);
  const lastHyphen = clipped.lastIndexOf("-");
  const cut = lastHyphen > 0 ? clipped.slice(0, lastHyphen) : clipped;
  return cut.replace(/-+$/, "");
}

export function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => boolean,
): string {
  if (!isTaken(base)) return base;
  let n = 2;
  while (isTaken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/slugger.test.ts`
Expected: PASS — 10 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/slugger.ts tests/server/slugger.test.ts
git commit -m "feat: slug generator with collision resolution"
```

---

### Task 9: Kind definitions and folder router

**Files:**
- Create: `src/server/ingest/kinds.ts`
- Test: `tests/server/ingest/kinds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/ingest/kinds.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  KINDS,
  isValidKind,
  destinationFor,
  type Kind,
} from "../../../src/server/ingest/kinds";

describe("KINDS", () => {
  test("contains exactly the 10 expected kinds", () => {
    expect(new Set(KINDS)).toEqual(
      new Set([
        "thread",
        "research_run",
        "memory",
        "spec",
        "plan",
        "note",
        "log",
        "thought",
        "idea",
        "journal",
      ]),
    );
  });
});

describe("isValidKind", () => {
  test("returns true for known kinds", () => {
    for (const k of KINDS) expect(isValidKind(k)).toBe(true);
  });
  test("returns false for unknown", () => {
    expect(isValidKind("foo")).toBe(false);
    expect(isValidKind("")).toBe(false);
  });
});

describe("destinationFor", () => {
  const now = new Date("2026-04-12T03:14:05.000Z");

  test("thread", () => {
    expect(destinationFor("thread", "arm-sve2", now)).toBe(
      "notes/threads/arm-sve2.md",
    );
  });

  test("research_run", () => {
    expect(destinationFor("research_run", "sve2-survey", now)).toBe(
      "notes/research/2026-04-12-0314-sve2-survey.md",
    );
  });

  test("memory", () => {
    expect(destinationFor("memory", "3d-printing", now)).toBe(
      "memory/3d-printing.md",
    );
  });

  test("spec", () => {
    expect(destinationFor("spec", "auth-design", now)).toBe(
      "docs/specs/2026-04-12-auth-design.md",
    );
  });

  test("plan", () => {
    expect(destinationFor("plan", "auth-rollout", now)).toBe(
      "docs/plans/2026-04-12-auth-rollout.md",
    );
  });

  test("note", () => {
    expect(destinationFor("note", "quick-idea", now)).toBe(
      "notes/inbox/quick-idea.md",
    );
  });

  test("log", () => {
    expect(destinationFor("log", "deploy-run", now)).toBe(
      "notes/logs/2026-04-12-deploy-run.md",
    );
  });

  test("thought", () => {
    expect(destinationFor("thought", "shower-idea", now)).toBe(
      "notes/thoughts/2026-04-12-0314-shower-idea.md",
    );
  });

  test("idea", () => {
    expect(destinationFor("idea", "new-product", now)).toBe(
      "notes/ideas/new-product.md",
    );
  });

  test("journal always goes to today's file", () => {
    expect(destinationFor("journal", "ignored-slug", now)).toBe(
      "journal/2026-04-12.md",
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/ingest/kinds.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/ingest/kinds.ts`**

```typescript
// src/server/ingest/kinds.ts
export const KINDS = [
  "thread",
  "research_run",
  "memory",
  "spec",
  "plan",
  "note",
  "log",
  "thought",
  "idea",
  "journal",
] as const;

export type Kind = (typeof KINDS)[number];

export function isValidKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function ymdhm(d: Date): string {
  return `${ymd(d)}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

export function destinationFor(kind: Kind, slug: string, now: Date): string {
  switch (kind) {
    case "thread":
      return `notes/threads/${slug}.md`;
    case "research_run":
      return `notes/research/${ymdhm(now)}-${slug}.md`;
    case "memory":
      return `memory/${slug}.md`;
    case "spec":
      return `docs/specs/${ymd(now)}-${slug}.md`;
    case "plan":
      return `docs/plans/${ymd(now)}-${slug}.md`;
    case "note":
      return `notes/inbox/${slug}.md`;
    case "log":
      return `notes/logs/${ymd(now)}-${slug}.md`;
    case "thought":
      return `notes/thoughts/${ymdhm(now)}-${slug}.md`;
    case "idea":
      return `notes/ideas/${slug}.md`;
    case "journal":
      return `journal/${ymd(now)}.md`;
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/ingest/kinds.test.ts`
Expected: PASS — 14 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/kinds.ts tests/server/ingest/kinds.test.ts
git commit -m "feat: kind definitions and destination router"
```

---

### Task 10: Ingest router (file write + auto-frontmatter, no side effects yet)

**Files:**
- Create: `src/server/ingest/router.ts`
- Test: `tests/server/ingest/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/ingest/router.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../../src/server/db";
import { FileManager } from "../../../src/server/file-manager";
import { Indexer } from "../../../src/server/indexer";
import { ActivityLog } from "../../../src/server/activity";
import { IngestRouter } from "../../../src/server/ingest/router";
import { parseFrontmatter } from "../../../src/server/parsers";
import type { Database } from "bun:sqlite";

let vaultPath: string;
let db: Database;
let fm: FileManager;
let indexer: Indexer;
let activity: ActivityLog;
let ingest: IngestRouter;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-ingest-"));
  db = createDatabase(":memory:");
  initSchema(db);
  fm = new FileManager(vaultPath, join(vaultPath, ".scrypt"));
  indexer = new Indexer(db, fm);
  activity = new ActivityLog(db);
  ingest = new IngestRouter({ vaultPath, db, fm, indexer, activity });
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("IngestRouter.ingest — basic", () => {
  test("creates a note kind at notes/inbox/{slug}.md", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "Quick capture",
      content: "# Quick capture\n\nsomething to triage later",
    });
    expect(res.created).toBe(true);
    expect(res.path).toBe("notes/inbox/quick-capture.md");
    expect(res.kind).toBe("note");
    expect(existsSync(join(vaultPath, res.path))).toBe(true);
  });

  test("injects kind, created, modified, source into frontmatter", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "Test",
      content: "body",
    });
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.kind).toBe("note");
    expect(frontmatter.source).toBe("claude");
    expect(frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(frontmatter.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("ignores client-set created, modified, source", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "T",
      content: "x",
      frontmatter: {
        created: "1999-01-01T00:00:00.000Z",
        modified: "1999-01-01T00:00:00.000Z",
        source: "evil",
      },
    });
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.created).not.toBe("1999-01-01T00:00:00.000Z");
    expect(frontmatter.source).toBe("claude");
  });

  test("400-like error on unknown kind", async () => {
    await expect(
      ingest.ingest({ kind: "bogus" as any, title: "X", content: "y" }),
    ).rejects.toThrow(/unknown kind/i);
  });

  test("error on missing title", async () => {
    await expect(
      ingest.ingest({ kind: "note", title: "", content: "y" }),
    ).rejects.toThrow(/title/i);
  });

  test("error on missing content", async () => {
    await expect(
      ingest.ingest({ kind: "note", title: "X", content: "" }),
    ).rejects.toThrow(/content/i);
  });

  test("409-like error on collision with replace=false", async () => {
    await ingest.ingest({
      kind: "idea",
      title: "Neat idea",
      content: "a",
    });
    await expect(
      ingest.ingest({
        kind: "idea",
        title: "Neat idea",
        content: "b",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test("overwrites on replace=true", async () => {
    await ingest.ingest({ kind: "idea", title: "Neat idea", content: "a" });
    const res = await ingest.ingest({
      kind: "idea",
      title: "Neat idea",
      content: "b",
      replace: true,
    });
    expect(res.created).toBe(false);
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    expect(raw).toContain("b");
  });

  test("auto-increments slug when title collides but replace=false and distinct content", async () => {
    // not supported in v1 — test that we get a collision error instead
    await ingest.ingest({ kind: "idea", title: "Dup", content: "a" });
    await expect(
      ingest.ingest({ kind: "idea", title: "Dup", content: "b" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("emits a create activity_log row", async () => {
    await ingest.ingest({ kind: "note", title: "Log me", content: "x" });
    const rows = activity.query({ kind: "note" });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].actor).toBe("claude");
    expect(rows[0].path).toBe("notes/inbox/log-me.md");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/ingest/router.test.ts`
Expected: FAIL — `IngestRouter` not found

- [ ] **Step 3: Create `src/server/ingest/router.ts`**

```typescript
// src/server/ingest/router.ts
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { ActivityLog } from "../activity";
import { isValidKind, destinationFor, KINDS, type Kind } from "./kinds";
import { slugify } from "../slugger";
import { stringifyFrontmatter } from "../parsers";

export interface IngestRequest {
  kind: Kind;
  title: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  replace?: boolean;
}

export interface IngestResult {
  path: string;
  kind: Kind;
  created: boolean;
  side_effects?: {
    thread_updated?: string;
    research_run_id?: number;
  };
}

export interface IngestDeps {
  vaultPath: string;
  db: Database;
  fm: FileManager;
  indexer: Indexer;
  activity: ActivityLog;
}

export class IngestError extends Error {
  constructor(
    message: string,
    public code: "bad_request" | "conflict" | "not_found" | "internal",
    public field?: string,
  ) {
    super(message);
  }
}

export class IngestRouter {
  constructor(private deps: IngestDeps) {}

  async ingest(req: IngestRequest): Promise<IngestResult> {
    // Validation
    if (!req.kind) throw new IngestError("kind is required", "bad_request", "kind");
    if (!isValidKind(req.kind)) {
      throw new IngestError(
        `unknown kind: ${req.kind}. valid: ${KINDS.join(", ")}`,
        "bad_request",
        "kind",
      );
    }
    if (!req.title || req.title.trim() === "") {
      throw new IngestError("title is required", "bad_request", "title");
    }
    if (!req.content || req.content.trim() === "") {
      throw new IngestError("content is required", "bad_request", "content");
    }

    const now = new Date();
    const slug = slugify(req.title);
    const relPath = destinationFor(req.kind, slug, now);
    const absPath = join(this.deps.vaultPath, relPath);

    // Journal append handled in Task 11; all other kinds write directly
    if (req.kind === "journal") {
      throw new IngestError(
        "journal kind not yet implemented",
        "internal",
      );
    }

    const existed = existsSync(absPath);
    if (existed && !req.replace) {
      throw new IngestError(
        `file already exists: ${relPath}`,
        "conflict",
      );
    }

    // Build frontmatter with server-owned fields
    const userFm = { ...(req.frontmatter ?? {}) };
    delete (userFm as any).created;
    delete (userFm as any).modified;
    delete (userFm as any).source;

    const fullFm: Record<string, unknown> = {
      ...userFm,
      title: req.title,
      kind: req.kind,
      created: now.toISOString(),
      modified: now.toISOString(),
      source: "claude",
    };

    await mkdir(dirname(absPath), { recursive: true });
    const body = this.stripFrontmatterFromBody(req.content);
    const markdown = stringifyFrontmatter(fullFm, body);
    await Bun.write(absPath, markdown);

    this.deps.activity.record({
      action: existed ? "update" : "create",
      kind: req.kind,
      path: relPath,
      actor: "claude",
      meta: { bytes: markdown.length },
    });

    return {
      path: relPath,
      kind: req.kind,
      created: !existed,
    };
  }

  // If caller passes content that already starts with frontmatter, strip it —
  // we inject our own. Otherwise return content as-is.
  private stripFrontmatterFromBody(content: string): string {
    if (!content.startsWith("---\n")) return content;
    const end = content.indexOf("\n---\n", 4);
    if (end === -1) return content;
    return content.slice(end + 5);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/ingest/router.test.ts`
Expected: PASS — 10 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/ tests/server/ingest/
git commit -m "feat: ingest router — write + auto-frontmatter + activity log"
```

---

### Task 11: Ingest router — journal append + remaining kinds

**Files:**
- Modify: `src/server/ingest/router.ts`
- Test: `tests/server/ingest/router.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/ingest/router.test.ts`:

```typescript
describe("IngestRouter.ingest — journal kind", () => {
  test("creates today's journal file on first write", async () => {
    const res = await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "First entry of the day",
    });
    expect(res.path).toMatch(/^journal\/\d{4}-\d{2}-\d{2}\.md$/);
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    expect(raw).toContain("First entry of the day");
  });

  test("appends to existing journal file under a timestamp heading", async () => {
    await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "Morning thought",
    });
    const res2 = await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "Afternoon thought",
    });
    const raw = readFileSync(join(vaultPath, res2.path), "utf-8");
    expect(raw).toContain("Morning thought");
    expect(raw).toContain("Afternoon thought");
    // the second entry should live under an `## HH:MM UTC` heading
    expect(raw).toMatch(/##\s+\d{2}:\d{2}\s+UTC/);
    expect(res2.created).toBe(false);
  });

  test("emits append activity log row for journal appends", async () => {
    await ingest.ingest({
      kind: "journal",
      title: "u",
      content: "first",
    });
    await ingest.ingest({
      kind: "journal",
      title: "u",
      content: "second",
    });
    const rows = activity.query({ kind: "journal" });
    // first = create, second = append
    expect(rows.some((r) => r.action === "create")).toBe(true);
    expect(rows.some((r) => r.action === "append")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `bun test tests/server/ingest/router.test.ts -t "journal kind"`
Expected: FAIL — "journal kind not yet implemented"

- [ ] **Step 3: Implement journal append in `src/server/ingest/router.ts`**

Replace the body of `ingest()` — specifically the `if (req.kind === "journal")` throw — with a dedicated handler, and extract the main write path into a helper:

```typescript
  async ingest(req: IngestRequest): Promise<IngestResult> {
    // ... (validation unchanged) ...

    const now = new Date();
    const slug = slugify(req.title);

    if (req.kind === "journal") {
      return this.ingestJournal(req.content, now);
    }

    const relPath = destinationFor(req.kind, slug, now);
    // ... rest of the existing write path unchanged ...
  }

  private async ingestJournal(content: string, now: Date): Promise<IngestResult> {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const relPath = `journal/${y}-${m}-${d}.md`;
    const absPath = join(this.deps.vaultPath, relPath);
    const existed = existsSync(absPath);

    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const entryHeading = `## ${hh}:${mm} UTC`;
    const body = this.stripFrontmatterFromBody(content).trim();

    let markdown: string;
    if (existed) {
      const current = await Bun.file(absPath).text();
      markdown = current.trimEnd() + `\n\n${entryHeading}\n\n${body}\n`;
    } else {
      const fm: Record<string, unknown> = {
        title: `${y}-${m}-${d}`,
        kind: "journal",
        created: now.toISOString(),
        modified: now.toISOString(),
        source: "claude",
        tags: ["journal", "daily"],
      };
      markdown = stringifyFrontmatter(fm, `# ${y}-${m}-${d}\n\n${entryHeading}\n\n${body}\n`);
    }

    await mkdir(dirname(absPath), { recursive: true });
    await Bun.write(absPath, markdown);

    this.deps.activity.record({
      action: existed ? "append" : "create",
      kind: "journal",
      path: relPath,
      actor: "claude",
      meta: { bytes: markdown.length },
    });

    return {
      path: relPath,
      kind: "journal",
      created: !existed,
    };
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `bun test tests/server/ingest/router.test.ts`
Expected: PASS — all tests green (13 total now)

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/router.ts tests/server/ingest/router.test.ts
git commit -m "feat: ingest router — journal append with timestamp headings"
```

---

### Task 12: Ingest router — research_run side effects

**Files:**
- Modify: `src/server/ingest/router.ts`
- Create: `src/server/research.ts` (thread update helper)
- Test: `tests/server/ingest/router.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/ingest/router.test.ts`:

```typescript
describe("IngestRouter.ingest — research_run side effects", () => {
  async function seedThread(slug: string) {
    await ingest.ingest({
      kind: "thread",
      title: slug,
      content: "# Thread body",
      frontmatter: { status: "open", priority: 1, prompt: "initial" },
    });
  }

  test("rejects research_run when frontmatter.thread is missing", async () => {
    await expect(
      ingest.ingest({
        kind: "research_run",
        title: "orphan run",
        content: "# findings",
      }),
    ).rejects.toThrow(/thread/i);
  });

  test("rejects research_run when thread slug does not exist", async () => {
    await expect(
      ingest.ingest({
        kind: "research_run",
        title: "bad thread",
        content: "# findings",
        frontmatter: { thread: "no-such-thread" },
      }),
    ).rejects.toThrow(/unknown thread/i);
  });

  test("creates a research_run note and inserts research_runs row", async () => {
    await seedThread("arm-sve2");
    const res = await ingest.ingest({
      kind: "research_run",
      title: "sve2 survey",
      content: "## Summary\nFound three articles\n\n## Findings\nDetails",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: "2026-04-12T03:14:00.000Z",
        completed_at: "2026-04-12T03:14:48.000Z",
        duration_ms: 48000,
        model: "claude-opus-4-6",
        token_usage: { input: 100, output: 50 },
      },
    });
    expect(res.path).toMatch(/^notes\/research\/\d{4}-\d{2}-\d{2}-\d{4}-sve2-survey\.md$/);
    expect(res.side_effects?.research_run_id).toBeGreaterThan(0);
    expect(res.side_effects?.thread_updated).toBe("notes/threads/arm-sve2.md");

    const row = db
      .query("SELECT * FROM research_runs WHERE id = ?")
      .get(res.side_effects?.research_run_id) as any;
    expect(row.thread_slug).toBe("arm-sve2");
    expect(row.note_path).toBe(res.path);
    expect(row.status).toBe("success");
    expect(row.tokens_in).toBe(100);
  });

  test("updates thread frontmatter — last_run, run_count, modified", async () => {
    await seedThread("arm-sve2");
    const before = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    const beforeFm = parseFrontmatter(before).frontmatter;
    expect(beforeFm.run_count).toBeFalsy();

    await ingest.ingest({
      kind: "research_run",
      title: "run one",
      content: "## Summary\nfirst run",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    });

    const after = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    const afterFm = parseFrontmatter(after).frontmatter;
    expect(afterFm.run_count).toBe(1);
    expect(typeof afterFm.last_run).toBe("string");
  });

  test("appends a ## Runs summary block to the thread", async () => {
    await seedThread("arm-sve2");
    const res = await ingest.ingest({
      kind: "research_run",
      title: "the first run",
      content:
        "## Summary\nThis is the short summary of what was found today.\n\n## Findings\nLong body",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    });
    const threadRaw = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    expect(threadRaw).toContain("## Runs");
    expect(threadRaw).toContain("[[");
    expect(threadRaw).toContain(
      "This is the short summary of what was found today.",
    );
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `bun test tests/server/ingest/router.test.ts -t "research_run side effects"`
Expected: FAIL — side effects not implemented

- [ ] **Step 3: Create `src/server/research.ts`**

```typescript
// src/server/research.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { parseFrontmatter, stringifyFrontmatter } from "./parsers";

export interface ResearchRunRow {
  id: number;
  thread_slug: string;
  note_path: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
}

export interface InsertResearchRun {
  thread_slug: string;
  note_path: string;
  status: "success" | "partial" | "failed";
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
}

export function insertResearchRun(
  db: Database,
  rec: InsertResearchRun,
): number {
  const stmt = db.query(
    `INSERT INTO research_runs
     (thread_slug, note_path, status, started_at, completed_at, duration_ms, model, tokens_in, tokens_out, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    rec.thread_slug,
    rec.note_path,
    rec.status,
    rec.started_at,
    rec.completed_at ?? null,
    rec.duration_ms ?? null,
    rec.model ?? null,
    rec.tokens_in ?? null,
    rec.tokens_out ?? null,
    rec.error ?? null,
  );
  const row = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
  return row.id;
}

/**
 * Append a run summary block to the thread's markdown file and update
 * its frontmatter (last_run, run_count, modified).
 */
export async function appendRunToThread(opts: {
  vaultPath: string;
  threadSlug: string;
  runNoteFilename: string;       // e.g. "2026-04-12-0314-sve2-survey"
  summaryText: string;           // first 200 chars of run summary
  completedAt: string;           // ISO
}): Promise<string> {
  const threadPath = `notes/threads/${opts.threadSlug}.md`;
  const absPath = join(opts.vaultPath, threadPath);
  if (!existsSync(absPath)) {
    throw new Error(`unknown thread: ${opts.threadSlug}`);
  }

  const raw = await Bun.file(absPath).text();
  const { frontmatter, body } = parseFrontmatter(raw);

  const runCount =
    typeof frontmatter.run_count === "number" ? frontmatter.run_count : 0;
  const newFm: Record<string, unknown> = {
    ...frontmatter,
    last_run: opts.completedAt,
    run_count: runCount + 1,
    modified: new Date().toISOString(),
  };

  // YYYY-MM-DD HH:MM stamp from the filename prefix
  const stamp = opts.runNoteFilename.slice(0, 15).replace(
    /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/,
    "$1 $2:$3",
  );
  const summaryBlock =
    `### ${stamp} — [[${opts.runNoteFilename}]]\n${opts.summaryText}\n`;

  const runsHeaderRegex = /\n## Runs\s*\n/;
  let newBody: string;
  if (runsHeaderRegex.test(body)) {
    // Insert directly after the `## Runs` heading so the newest is first
    newBody = body.replace(runsHeaderRegex, (m) => `${m}\n${summaryBlock}\n`);
  } else {
    newBody = `${body.trimEnd()}\n\n## Runs\n\n${summaryBlock}\n`;
  }

  const out = stringifyFrontmatter(newFm, newBody);
  await Bun.write(absPath, out);
  return threadPath;
}

/** Grab the first 200 chars of the ## Summary section, or of the body. */
export function extractRunSummary(content: string): string {
  const summaryMatch = content.match(/##\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n?$)/);
  const src = summaryMatch ? summaryMatch[1] : content;
  const normalized = src.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 200);
}
```

- [ ] **Step 4: Wire research_run into `src/server/ingest/router.ts`**

Add imports at the top:

```typescript
import {
  insertResearchRun,
  appendRunToThread,
  extractRunSummary,
} from "../research";
import { basename } from "node:path";
```

In `ingest()`, after the validation block and before the existing `existed = existsSync(...)` check, add:

```typescript
    if (req.kind === "research_run") {
      return this.ingestResearchRun(req, now, slug);
    }
```

Then add a new private method:

```typescript
  private async ingestResearchRun(
    req: IngestRequest,
    now: Date,
    slug: string,
  ): Promise<IngestResult> {
    const threadSlug = (req.frontmatter as any)?.thread as string | undefined;
    if (!threadSlug) {
      throw new IngestError(
        "frontmatter.thread is required for research_run",
        "bad_request",
        "frontmatter.thread",
      );
    }
    // Verify the thread file exists
    const threadPath = join(
      this.deps.vaultPath,
      `notes/threads/${threadSlug}.md`,
    );
    if (!existsSync(threadPath)) {
      throw new IngestError(
        `unknown thread: ${threadSlug}`,
        "bad_request",
        "frontmatter.thread",
      );
    }

    const relPath = destinationFor("research_run", slug, now);
    const absPath = join(this.deps.vaultPath, relPath);
    if (existsSync(absPath) && !req.replace) {
      throw new IngestError(
        `file already exists: ${relPath}`,
        "conflict",
      );
    }

    // Build run note frontmatter
    const userFm = { ...(req.frontmatter ?? {}) };
    delete (userFm as any).created;
    delete (userFm as any).modified;
    delete (userFm as any).source;

    const fullFm: Record<string, unknown> = {
      ...userFm,
      title: req.title,
      kind: "research_run",
      created: now.toISOString(),
      modified: now.toISOString(),
      source: "claude",
    };

    const body = this.stripFrontmatterFromBody(req.content);
    // Prepend the thread link to the body for graph connectivity
    const bodyWithLink = body.includes(`[[${threadSlug}]]`)
      ? body
      : `Links: [[${threadSlug}]]\n\n${body}`;
    const markdown = stringifyFrontmatter(fullFm, bodyWithLink);

    await mkdir(dirname(absPath), { recursive: true });
    await Bun.write(absPath, markdown);

    // Insert DB row
    const runId = insertResearchRun(this.deps.db, {
      thread_slug: threadSlug,
      note_path: relPath,
      status: ((userFm as any).status as string) ?? "success",
      started_at: ((userFm as any).started_at as string) ?? now.toISOString(),
      completed_at: (userFm as any).completed_at as string | undefined,
      duration_ms: (userFm as any).duration_ms as number | undefined,
      model: (userFm as any).model as string | undefined,
      tokens_in: ((userFm as any).token_usage as any)?.input,
      tokens_out: ((userFm as any).token_usage as any)?.output,
    });

    // Update thread file
    const runNoteFilename = basename(relPath, ".md");
    const summary = extractRunSummary(body);
    const threadRelPath = await appendRunToThread({
      vaultPath: this.deps.vaultPath,
      threadSlug,
      runNoteFilename,
      summaryText: summary,
      completedAt: ((userFm as any).completed_at as string) ?? now.toISOString(),
    });

    this.deps.activity.record({
      action: "create",
      kind: "research_run",
      path: relPath,
      actor: "claude",
      meta: { run_id: runId, bytes: markdown.length },
    });
    this.deps.activity.record({
      action: "update",
      kind: "thread",
      path: threadRelPath,
      actor: "claude",
      meta: { run_id: runId, reason: "research_run side effect" },
    });

    return {
      path: relPath,
      kind: "research_run",
      created: true,
      side_effects: {
        thread_updated: threadRelPath,
        research_run_id: runId,
      },
    };
  }
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `bun test tests/server/ingest/router.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/server/research.ts src/server/ingest/router.ts tests/server/ingest/router.test.ts
git commit -m "feat: research_run side effects — thread update, DB row, summary block"
```

---

## Wave 3 — New API endpoints (mostly parallel)

Each task in this wave adds one endpoint file. They're independent; the only shared work is that Wave 2 is complete.

### Task 13: POST /api/ingest endpoint

**Files:**
- Create: `src/server/api/ingest.ts`
- Modify: `src/server/index.ts` — wire the route
- Test: `tests/server/api/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/ingest.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";
import { existsSync } from "node:fs";
import { join } from "node:path";

let env: ReturnType<typeof createTestEnv>;

beforeAll(() => {
  env = createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

describe("POST /api/ingest", () => {
  test("creates a note kind and returns the path", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note",
        title: "Through API",
        content: "body",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.path).toBe("notes/inbox/through-api.md");
    expect(data.kind).toBe("note");
    expect(data.created).toBe(true);
    expect(existsSync(join(env.vaultPath, data.path))).toBe(true);
  });

  test("returns 400 for unknown kind", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "bogus", title: "X", content: "y" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/unknown kind/i);
  });

  test("returns 400 for missing title", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "note", content: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 on collision with replace=false", async () => {
    await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "idea",
        title: "Collision test",
        content: "a",
      }),
    });
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "idea",
        title: "Collision test",
        content: "b",
      }),
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/ingest.test.ts`
Expected: FAIL — route not registered

- [ ] **Step 3: Create `src/server/api/ingest.ts`**

```typescript
// src/server/api/ingest.ts
import type { Router } from "../router";
import { IngestRouter, IngestError } from "../ingest/router";

export function ingestRoutes(router: Router, ingest: IngestRouter): void {
  router.post("/api/ingest", async (req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    try {
      const result = await ingest.ingest(body);
      return Response.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof IngestError) {
        const status =
          err.code === "bad_request"
            ? 400
            : err.code === "conflict"
              ? 409
              : err.code === "not_found"
                ? 404
                : 500;
        return Response.json(
          { error: err.message, field: err.field },
          { status },
        );
      }
      console.error("ingest internal error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  });
}
```

- [ ] **Step 4: Wire the route in `src/server/index.ts`**

In `createApp`, after the existing route registrations, add:

```typescript
import { ingestRoutes } from "./api/ingest";
import { IngestRouter } from "./ingest/router";
import { ActivityLog } from "./activity";
// ... inside createApp:
  const activity = new ActivityLog(db);
  const ingestRouter = new IngestRouter({
    vaultPath: config.vaultPath,
    db,
    fm,
    indexer,
    activity,
  });
  ingestRoutes(router, ingestRouter);
```

Also expose `activity` and `ingestRouter` on the returned app object so tests can use them:

```typescript
  return {
    fetch: ...,
    websocket: ws.handlers(),
    indexer,
    fm,
    db,
    activity,
    ingestRouter,
  };
```

- [ ] **Step 5: Run test, verify it passes**

Run: `bun test tests/server/api/ingest.test.ts`
Expected: PASS — 4 tests green

- [ ] **Step 6: Make sure the existing full suite still passes**

Run: `bun run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/api/ingest.ts src/server/index.ts tests/server/api/ingest.test.ts
git commit -m "feat: POST /api/ingest — primary orchestrator write path"
```

---

### Task 14: Thread endpoints (GET list, GET single, PATCH)

**Files:**
- Create: `src/server/api/threads.ts`
- Modify: `src/server/index.ts` — wire routes
- Test: `tests/server/api/threads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/threads.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Open SVE2 question",
    content: "# Open",
    frontmatter: { status: "open", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Resolved old thing",
    content: "# Done",
    frontmatter: { status: "resolved", priority: 0 },
  });
  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/threads", () => {
  test("returns all threads when no filter", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=open`);
    const data = await res.json();
    expect(data.every((t: any) => t.status === "open")).toBe(true);
  });

  test("filters by comma-separated statuses", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads?status=open,resolved`,
    );
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by priority", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?priority=2`);
    const data = await res.json();
    expect(data.every((t: any) => t.priority >= 2)).toBe(true);
  });
});

describe("GET /api/threads/:slug", () => {
  test("returns full thread with content", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/open-sve2-question`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slug).toBe("open-sve2-question");
    expect(data.status).toBe("open");
    expect(data.content).toContain("Open");
  });

  test("returns 404 for unknown slug", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/nope`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/threads/:slug", () => {
  test("updates status and run_count", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in-progress", run_count: 5 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await (
      await fetch(`${env.baseUrl}/api/threads/open-sve2-question`)
    ).json();
    expect(updated.status).toBe("in-progress");
    expect(updated.run_count).toBe(5);
  });

  test("rejects unknown fields with 400", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evil: "yes" }),
      },
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/threads.test.ts`
Expected: FAIL — routes missing

- [ ] **Step 3: Create `src/server/api/threads.ts`**

```typescript
// src/server/api/threads.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import { parseFrontmatter, stringifyFrontmatter } from "../parsers";
import { ActivityLog } from "../activity";

const ALLOWED_PATCH_FIELDS = new Set([
  "status",
  "priority",
  "prompt",
  "last_run",
  "run_count",
]);

const ALLOWED_STATUSES = new Set([
  "open",
  "in-progress",
  "resolved",
  "failed",
  "blocked",
  "paused",
  "archived",
]);

export function threadRoutes(
  router: Router,
  fm: FileManager,
  vaultPath: string,
  activity: ActivityLog,
): void {
  async function listThreads(filters: {
    statuses?: string[];
    priority?: number;
    tag?: string;
    limit?: number;
  }) {
    const notes = await fm.listNotes();
    const threads = [];
    for (const note of notes) {
      if (!note.path.startsWith("notes/threads/")) continue;
      const raw = await fm.readRaw(note.path);
      if (!raw) continue;
      const { frontmatter } = parseFrontmatter(raw);
      if (frontmatter.kind !== "thread") continue;
      const status = (frontmatter.status as string) ?? "open";
      const priority =
        typeof frontmatter.priority === "number" ? frontmatter.priority : 1;
      if (filters.statuses && !filters.statuses.includes(status)) continue;
      if (filters.priority !== undefined && priority < filters.priority) continue;
      if (
        filters.tag &&
        !(Array.isArray(frontmatter.tags) && frontmatter.tags.includes(filters.tag))
      )
        continue;
      threads.push({
        slug: note.path
          .replace(/^notes\/threads\//, "")
          .replace(/\.md$/, ""),
        title: (frontmatter.title as string) ?? note.title,
        status,
        priority,
        prompt: frontmatter.prompt ?? null,
        last_run: frontmatter.last_run ?? null,
        run_count: (frontmatter.run_count as number | undefined) ?? 0,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        path: note.path,
        modified: frontmatter.modified ?? note.modified,
      });
    }
    threads.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (!a.last_run && b.last_run) return -1;
      if (a.last_run && !b.last_run) return 1;
      return (a.last_run ?? "").localeCompare(b.last_run ?? "");
    });
    if (filters.limit) return threads.slice(0, filters.limit);
    return threads;
  }

  router.get("/api/threads", async (req) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam ? statusParam.split(",") : undefined;
    const priority = url.searchParams.get("priority");
    const tag = url.searchParams.get("tag") || undefined;
    const limit = url.searchParams.get("limit");
    const data = await listThreads({
      statuses,
      priority: priority ? Number(priority) : undefined,
      tag,
      limit: limit ? Number(limit) : undefined,
    });
    return Response.json(data);
  });

  router.get("/api/threads/:slug", async (_req, params) => {
    const path = `notes/threads/${params.slug}.md`;
    const absPath = join(vaultPath, path);
    if (!existsSync(absPath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const raw = await Bun.file(absPath).text();
    const { frontmatter, body } = parseFrontmatter(raw);
    return Response.json({
      slug: params.slug,
      path,
      title: frontmatter.title,
      status: frontmatter.status ?? "open",
      priority: frontmatter.priority ?? 1,
      prompt: frontmatter.prompt ?? null,
      last_run: frontmatter.last_run ?? null,
      run_count: frontmatter.run_count ?? 0,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      created: frontmatter.created,
      modified: frontmatter.modified,
      content: body,
    });
  });

  router.patch("/api/threads/:slug", async (req, params) => {
    const path = `notes/threads/${params.slug}.md`;
    const absPath = join(vaultPath, path);
    if (!existsSync(absPath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    for (const k of Object.keys(body)) {
      if (!ALLOWED_PATCH_FIELDS.has(k)) {
        return Response.json(
          { error: `unknown field: ${k}`, field: k },
          { status: 400 },
        );
      }
    }
    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return Response.json(
        { error: `invalid status: ${body.status}`, field: "status" },
        { status: 400 },
      );
    }

    const raw = await Bun.file(absPath).text();
    const { frontmatter, body: bodyText } = parseFrontmatter(raw);
    const nowIso = new Date().toISOString();
    const newFm = {
      ...frontmatter,
      ...body,
      modified: nowIso,
    };
    const markdown = stringifyFrontmatter(newFm, bodyText);
    await Bun.write(absPath, markdown);

    activity.record({
      action: "update",
      kind: "thread",
      path,
      actor: "claude",
      meta: { fields: Object.keys(body) },
    });
    return Response.json({ slug: params.slug, updated: Object.keys(body) });
  });
}
```

- [ ] **Step 4: Ensure `Router` has a `patch()` method**

Check `src/server/router.ts` — if `patch()` is not present, add it alongside `get`, `post`, `put`, `delete`:

```typescript
  patch(path: string, handler: Handler) { this.add("PATCH", path, handler); }
```

`readRaw` was added in Task 6.

- [ ] **Step 5: Wire the routes in `src/server/index.ts`**

```typescript
import { threadRoutes } from "./api/threads";
// ... inside createApp after other route registrations:
  threadRoutes(router, fm, config.vaultPath, activity);
```

- [ ] **Step 6: Run test, verify it passes**

Run: `bun test tests/server/api/threads.test.ts`
Expected: PASS — 7 tests green

- [ ] **Step 7: Commit**

```bash
git add src/server/api/threads.ts src/server/index.ts src/server/file-manager.ts src/server/router.ts tests/server/api/threads.test.ts
git commit -m "feat: thread endpoints — list, get, patch"
```

---

### Task 15: POST /api/research_runs + GET /api/research_runs

**Files:**
- Create: `src/server/api/research.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/api/research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/research.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Research target",
    content: "# target",
    frontmatter: { status: "open", priority: 1 },
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("POST /api/research_runs", () => {
  test("creates run note + DB row + updates thread", async () => {
    const res = await fetch(`${env.baseUrl}/api/research_runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "First run",
        content: "## Summary\nFound three good articles\n\n## Findings\nlong",
        frontmatter: {
          thread: "research-target",
          status: "success",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 15000,
          model: "claude-opus-4-6",
          token_usage: { input: 500, output: 200 },
        },
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.path).toMatch(/^notes\/research\/\d{4}-\d{2}-\d{2}-\d{4}-first-run\.md$/);
    expect(data.side_effects.research_run_id).toBeGreaterThan(0);
    expect(data.side_effects.thread_updated).toBe(
      "notes/threads/research-target.md",
    );
  });
});

describe("GET /api/research_runs", () => {
  test("returns list of recent runs", async () => {
    const res = await fetch(`${env.baseUrl}/api/research_runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by thread", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/research_runs?thread=research-target`,
    );
    const data = await res.json();
    expect(data.every((r: any) => r.thread_slug === "research-target")).toBe(true);
  });

  test("filters by status", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/research_runs?status=success`,
    );
    const data = await res.json();
    expect(data.every((r: any) => r.status === "success")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/research.test.ts`
Expected: FAIL — routes missing

- [ ] **Step 3: Create `src/server/api/research.ts`**

```typescript
// src/server/api/research.ts
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import { IngestRouter, IngestError } from "../ingest/router";

export function researchRoutes(
  router: Router,
  db: Database,
  ingest: IngestRouter,
): void {
  router.post("/api/research_runs", async (req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    try {
      const result = await ingest.ingest({
        kind: "research_run",
        title: body.title,
        content: body.content,
        frontmatter: body.frontmatter,
      });
      return Response.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof IngestError) {
        const status =
          err.code === "bad_request" ? 400 : err.code === "conflict" ? 409 : 500;
        return Response.json(
          { error: err.message, field: err.field },
          { status },
        );
      }
      console.error("research_run internal error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  });

  router.get("/api/research_runs", (req) => {
    const url = new URL(req.url);
    const thread = url.searchParams.get("thread");
    const status = url.searchParams.get("status");
    const since = url.searchParams.get("since");
    const limitStr = url.searchParams.get("limit");
    const limit = Math.min(Number(limitStr) || 100, 500);

    const where: string[] = [];
    const params: unknown[] = [];
    if (thread) {
      where.push("thread_slug = ?");
      params.push(thread);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (since) {
      where.push("started_at >= ?");
      params.push(since);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db
      .query(
        `SELECT id, thread_slug, note_path, status, started_at, completed_at, duration_ms, model, tokens_in, tokens_out, error
         FROM research_runs
         ${whereClause}
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, limit);
    return Response.json(rows);
  });
}
```

- [ ] **Step 4: Wire in `src/server/index.ts`**

```typescript
import { researchRoutes } from "./api/research";
// inside createApp:
  researchRoutes(router, db, ingestRouter);
```

- [ ] **Step 5: Run test, verify it passes**

Run: `bun test tests/server/api/research.test.ts`
Expected: PASS — 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/server/api/research.ts src/server/index.ts tests/server/api/research.test.ts
git commit -m "feat: research_runs endpoints — create + list"
```

---

### Task 16: GET /api/memories

**Files:**
- Create: `src/server/api/memories.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/api/memories.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/memories.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "3D printing",
    content: "body",
    frontmatter: { active: true, category: "interest", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "Old hobby",
    content: "body",
    frontmatter: { active: false, category: "interest", priority: 0 },
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/memories", () => {
  test("returns all memories by default", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters active=true", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories?active=true`);
    const data = await res.json();
    expect(data.every((m: any) => m.active === true)).toBe(true);
  });

  test("filters category", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories?category=interest`);
    const data = await res.json();
    expect(data.every((m: any) => m.category === "interest")).toBe(true);
  });

  test("sorted by priority DESC", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories`);
    const data = await res.json();
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].priority).toBeGreaterThanOrEqual(data[i].priority);
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/memories.test.ts`
Expected: FAIL — route missing

- [ ] **Step 3: Create `src/server/api/memories.ts`**

```typescript
// src/server/api/memories.ts
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import { parseFrontmatter } from "../parsers";

export function memoryRoutes(
  router: Router,
  fm: FileManager,
): void {
  router.get("/api/memories", async (req) => {
    const url = new URL(req.url);
    const activeParam = url.searchParams.get("active");
    const activeFilter =
      activeParam === "true" ? true : activeParam === "false" ? false : undefined;
    const categoryFilter = url.searchParams.get("category") || undefined;

    const notes = await fm.listNotes();
    const memories = [];
    for (const n of notes) {
      if (!n.path.startsWith("memory/")) continue;
      const raw = await fm.readRaw(n.path);
      if (!raw) continue;
      const { frontmatter, body } = parseFrontmatter(raw);
      if (frontmatter.kind !== "memory") continue;
      const active = frontmatter.active !== false;
      const category = (frontmatter.category as string) ?? "interest";
      const priority =
        typeof frontmatter.priority === "number" ? frontmatter.priority : 1;
      if (activeFilter !== undefined && active !== activeFilter) continue;
      if (categoryFilter && category !== categoryFilter) continue;
      memories.push({
        slug: n.path.replace(/^memory\//, "").replace(/\.md$/, ""),
        path: n.path,
        title: frontmatter.title,
        category,
        priority,
        active,
        created: frontmatter.created,
        modified: frontmatter.modified,
        content: body,
      });
    }
    memories.sort((a, b) => b.priority - a.priority);
    return Response.json(memories);
  });
}
```

- [ ] **Step 4: Wire in `src/server/index.ts`**

```typescript
import { memoryRoutes } from "./api/memories";
// inside createApp:
  memoryRoutes(router, fm);
```

- [ ] **Step 5: Run test, verify it passes**

Run: `bun test tests/server/api/memories.test.ts`
Expected: PASS — 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/server/api/memories.ts src/server/index.ts tests/server/api/memories.test.ts
git commit -m "feat: GET /api/memories — list active interest profiles"
```

---

### Task 17: GET /api/daily_context

**Files:**
- Create: `src/server/api/daily-context.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/api/daily-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/daily-context.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "Research sources",
    content: "Prefer Reddit, HN, arxiv.",
    frontmatter: { active: true, category: "preference", priority: 3 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Open research question",
    content: "# Thread",
    frontmatter: { status: "open", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "journal",
    title: "t",
    content: "Today's morning thought",
  });
  await env.writeNote(
    "notes/recent.md",
    "---\ntitle: Recent\ntags: [fresh]\n---\n\n# Recent\n\nJust written.",
  );
  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/daily_context", () => {
  test("returns the five top-level keys", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("generated_at");
    expect(data).toHaveProperty("today");
    expect(data).toHaveProperty("recent_notes");
    expect(data).toHaveProperty("open_threads");
    expect(data).toHaveProperty("active_memories");
    expect(data).toHaveProperty("tag_cloud");
  });

  test("today.journal contains today's entry", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(data.today.journal.exists).toBe(true);
    expect(data.today.journal.content).toContain("morning thought");
  });

  test("open_threads includes the seeded open thread", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(
      data.open_threads.some(
        (t: any) => t.slug === "open-research-question",
      ),
    ).toBe(true);
  });

  test("active_memories includes the seeded memory", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(
      data.active_memories.some((m: any) => m.slug === "research-sources"),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/daily-context.test.ts`
Expected: FAIL — route missing

- [ ] **Step 3: Create `src/server/api/daily-context.ts`**

```typescript
// src/server/api/daily-context.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { parseFrontmatter } from "../parsers";

export function dailyContextRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  vaultPath: string,
): void {
  router.get("/api/daily_context", async () => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const date = `${y}-${m}-${d}`;
    const journalRel = `journal/${date}.md`;
    const journalAbs = join(vaultPath, journalRel);

    const journal = existsSync(journalAbs)
      ? {
          path: journalRel,
          content: await Bun.file(journalAbs).text(),
          exists: true,
        }
      : { path: journalRel, content: "", exists: false };

    // Walk the vault once so we can extract recent notes, threads, and memories
    const notes = await fm.listNotes();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const recent_notes = [];
    const open_threads = [];
    const active_memories = [];

    for (const n of notes) {
      const raw = await fm.readRaw(n.path);
      if (!raw) continue;
      const { frontmatter, body } = parseFrontmatter(raw);

      const modified =
        (frontmatter.modified as string) ||
        n.modified ||
        new Date(0).toISOString();

      if (n.path.startsWith("notes/threads/") && frontmatter.kind === "thread") {
        const status = (frontmatter.status as string) ?? "open";
        if (["open", "in-progress", "blocked"].includes(status)) {
          open_threads.push({
            slug: n.path
              .replace(/^notes\/threads\//, "")
              .replace(/\.md$/, ""),
            title: frontmatter.title,
            status,
            priority: (frontmatter.priority as number) ?? 1,
            last_run: frontmatter.last_run ?? null,
            prompt: frontmatter.prompt ?? null,
            path: n.path,
          });
        }
      } else if (
        n.path.startsWith("memory/") &&
        frontmatter.kind === "memory"
      ) {
        const active = frontmatter.active !== false;
        if (active) {
          active_memories.push({
            slug: n.path.replace(/^memory\//, "").replace(/\.md$/, ""),
            title: frontmatter.title,
            category: frontmatter.category ?? "interest",
            priority: (frontmatter.priority as number) ?? 1,
            content: body,
          });
        }
      } else if (modified >= cutoff && !n.path.startsWith("journal/")) {
        const snippet = body
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        recent_notes.push({
          path: n.path,
          title: frontmatter.title ?? n.title,
          modified,
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
          snippet,
        });
      }
    }

    // Sort everything
    recent_notes.sort((a, b) => b.modified.localeCompare(a.modified));
    open_threads.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a.last_run ?? "").localeCompare(b.last_run ?? "");
    });
    active_memories.sort((a, b) => b.priority - a.priority);

    const tag_cloud = indexer.getTags().slice(0, 20);

    return Response.json({
      generated_at: now.toISOString(),
      today: { date, journal },
      recent_notes: recent_notes.slice(0, 20),
      open_threads,
      active_memories,
      tag_cloud,
    });
  });
}
```

- [ ] **Step 4: Wire in `src/server/index.ts`**

```typescript
import { dailyContextRoutes } from "./api/daily-context";
// inside createApp:
  dailyContextRoutes(router, fm, indexer, config.vaultPath);
```

- [ ] **Step 5: Run test, verify it passes**

Run: `bun test tests/server/api/daily-context.test.ts`
Expected: PASS — 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/server/api/daily-context.ts src/server/index.ts tests/server/api/daily-context.test.ts
git commit -m "feat: GET /api/daily_context — orchestrator daily bundle"
```

---

### Task 18: GET /api/activity

**Files:**
- Create: `src/server/api/activity.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/api/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api/activity.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "activity one",
    content: "x",
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "activity two",
    content: "y",
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/activity", () => {
  test("returns recent activity", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by kind", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?kind=thread`);
    const data = await res.json();
    expect(data.every((r: any) => r.kind === "thread")).toBe(true);
  });

  test("filters by actor", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?actor=claude`);
    const data = await res.json();
    expect(data.every((r: any) => r.actor === "claude")).toBe(true);
  });

  test("respects limit", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=1`);
    const data = await res.json();
    expect(data.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/api/activity.test.ts`
Expected: FAIL — route missing

- [ ] **Step 3: Create `src/server/api/activity.ts`**

```typescript
// src/server/api/activity.ts
import type { Router } from "../router";
import { ActivityLog, type ActivityActor } from "../activity";

export function activityRoutes(router: Router, activity: ActivityLog): void {
  router.get("/api/activity", (req) => {
    const url = new URL(req.url);
    const since = url.searchParams.get("since") || undefined;
    const until = url.searchParams.get("until") || undefined;
    const actor = (url.searchParams.get("actor") as ActivityActor) || undefined;
    const kind = url.searchParams.get("kind") || undefined;
    const action = (url.searchParams.get("action") as any) || undefined;
    const limitStr = url.searchParams.get("limit");
    const limit = Math.min(Number(limitStr) || 100, 1000);

    const rows = activity.query({ since, until, actor, kind, action, limit });
    return Response.json(rows);
  });
}
```

- [ ] **Step 4: Wire in `src/server/index.ts`**

```typescript
import { activityRoutes } from "./api/activity";
// inside createApp:
  activityRoutes(router, activity);
```

- [ ] **Step 5: Run test, verify it passes**

Run: `bun test tests/server/api/activity.test.ts`
Expected: PASS — 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/server/api/activity.ts src/server/index.ts tests/server/api/activity.test.ts
git commit -m "feat: GET /api/activity — write history with filters"
```

---

## Wave 4 — Maintenance, git, CLI (parallel with Wave 5)

### Task 19: Git autocommit module

**Files:**
- Create: `src/server/git-autocommit.ts`
- Test: `tests/server/git-autocommit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/git-autocommit.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRepo, commitPending } from "../../src/server/git-autocommit";
import { $ } from "bun";

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-git-"));
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("initRepo", () => {
  test("initializes a git repo if none exists", async () => {
    await initRepo(vaultPath);
    expect(existsSync(join(vaultPath, ".git"))).toBe(true);
  });

  test("is idempotent — running twice does not error", async () => {
    await initRepo(vaultPath);
    await initRepo(vaultPath);
    expect(existsSync(join(vaultPath, ".git"))).toBe(true);
  });

  test("writes a .gitignore excluding .scrypt/scrypt.db*", async () => {
    await initRepo(vaultPath);
    const gi = await Bun.file(join(vaultPath, ".gitignore")).text();
    expect(gi).toContain(".scrypt/scrypt.db");
  });
});

describe("commitPending", () => {
  test("returns null when there are no changes", async () => {
    await initRepo(vaultPath);
    writeFileSync(join(vaultPath, "note.md"), "initial");
    await $`git -C ${vaultPath} add -A`.quiet();
    await $`git -C ${vaultPath} -c user.email=s@s -c user.name=s commit -m initial`.quiet();

    const result = await commitPending(vaultPath);
    expect(result).toBeNull();
  });

  test("commits pending changes and returns the new sha", async () => {
    await initRepo(vaultPath);
    writeFileSync(join(vaultPath, "a.md"), "one");
    const result = await commitPending(vaultPath);
    expect(result).not.toBeNull();
    expect(result!.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(result!.fileCount).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/git-autocommit.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Create `src/server/git-autocommit.ts`**

```typescript
// src/server/git-autocommit.ts
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const GITIGNORE_CONTENT = `
.scrypt/scrypt.db
.scrypt/scrypt.db-shm
.scrypt/scrypt.db-wal
.scrypt/trash/
.DS_Store
`.trimStart();

export async function initRepo(vaultPath: string): Promise<void> {
  const gitDir = join(vaultPath, ".git");
  if (!existsSync(gitDir)) {
    await $`git -C ${vaultPath} init -q`.quiet();
    await $`git -C ${vaultPath} config user.email "scrypt@local"`.quiet();
    await $`git -C ${vaultPath} config user.name "Scrypt"`.quiet();
  }
  const giPath = join(vaultPath, ".gitignore");
  if (!existsSync(giPath)) {
    await Bun.write(giPath, GITIGNORE_CONTENT);
  }
}

export interface CommitResult {
  sha: string;
  fileCount: number;
  timestamp: string;
}

/**
 * Commit any pending changes in the vault. Returns the commit info or null
 * when there's nothing to commit. Never throws — logs and returns null on
 * failure so the auto-commit loop can keep running.
 */
export async function commitPending(
  vaultPath: string,
): Promise<CommitResult | null> {
  try {
    const status = await $`git -C ${vaultPath} status --porcelain`.quiet().text();
    if (status.trim() === "") return null;
    const fileCount = status.trim().split("\n").length;
    const timestamp = new Date().toISOString();
    await $`git -C ${vaultPath} add -A`.quiet();
    await $`git -C ${vaultPath} commit -m ${`scrypt snapshot ${timestamp}`}`.quiet();
    const sha = (await $`git -C ${vaultPath} rev-parse --short HEAD`.quiet().text()).trim();
    return { sha, fileCount, timestamp };
  } catch (err) {
    console.error("[git-autocommit] commit failed:", err);
    return null;
  }
}

export interface AutocommitLoop {
  stop: () => void;
}

export function startAutocommitLoop(opts: {
  vaultPath: string;
  intervalSeconds: number;
  onCommit?: (r: CommitResult) => void;
}): AutocommitLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    const result = await commitPending(opts.vaultPath);
    if (result && opts.onCommit) opts.onCommit(result);
    if (!stopped) {
      timer = setTimeout(tick, opts.intervalSeconds * 1000);
    }
  };

  // Kick off the first tick after one interval (not immediately)
  timer = setTimeout(tick, opts.intervalSeconds * 1000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/git-autocommit.test.ts`
Expected: PASS — 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/git-autocommit.ts tests/server/git-autocommit.test.ts
git commit -m "feat: git autocommit module — initRepo, commitPending, loop"
```

---

### Task 20: Wire git autocommit into createApp (opt-in)

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add the autocommit loop to `createApp` when configured**

In `src/server/index.ts`, at the top:

```typescript
import {
  initRepo,
  startAutocommitLoop,
  type AutocommitLoop,
} from "./git-autocommit";
```

In `createApp`, after the activity log and ingest router are wired up, add:

```typescript
  let autocommit: AutocommitLoop | undefined;
  if (config.gitAutocommit) {
    initRepo(config.vaultPath).catch((e) =>
      console.error("[scrypt] git init failed:", e),
    );
    autocommit = startAutocommitLoop({
      vaultPath: config.vaultPath,
      intervalSeconds: config.gitAutocommitInterval,
      onCommit: (r) => {
        activity.record({
          action: "snapshot",
          kind: null,
          path: ".",
          actor: "system",
          meta: { sha: r.sha, fileCount: r.fileCount },
        });
      },
    });
  }
```

And expose a `stop()` on the returned app that tears down the loop:

```typescript
  return {
    fetch: ...,
    websocket: ws.handlers(),
    indexer,
    fm,
    db,
    activity,
    ingestRouter,
    stop: () => {
      autocommit?.stop();
    },
  };
```

Update `ScryptConfig` in `src/server/config.ts` — already done in Task 2 — and update the `loadConfig()` → `createApp` call at the CLI entry point to pass through `gitAutocommit` and `gitAutocommitInterval`:

```typescript
if (import.meta.main) {
  const config = loadConfig({ vaultPath: process.cwd() });
  const app = createApp({
    vaultPath: config.vaultPath,
    staticDir: config.staticDir,
    authToken: config.authToken,
    isProduction: config.isProduction,
    gitAutocommit: config.gitAutocommit,
    gitAutocommitInterval: config.gitAutocommitInterval,
  });
  // ...
}
```

Also add `gitAutocommit?: boolean` and `gitAutocommitInterval?: number` to the `AppConfig` interface in `src/server/index.ts`:

```typescript
export interface AppConfig {
  vaultPath: string;
  staticDir?: string;
  authToken?: string;
  isProduction?: boolean;
  gitAutocommit?: boolean;
  gitAutocommitInterval?: number;
}
```

And read them in the `scryptConfig` object:

```typescript
  const scryptConfig: ScryptConfig = {
    // ...
    gitAutocommit: config.gitAutocommit ?? false,
    gitAutocommitInterval: config.gitAutocommitInterval ?? 900,
    // ...
  };
```

- [ ] **Step 2: Update `tests/helpers.ts` cleanup to call `app.stop()`**

In `tests/helpers.ts`, inside the returned `cleanup()`:

```typescript
    async cleanup() {
      app.fm.stopWatching();
      app.stop?.();
      try {
        await app.ready;
      } catch {}
      server.stop();
      app.db.close();
      rmSync(vaultPath, { recursive: true, force: true });
    },
```

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`
Expected: PASS — all tests still green, no new tests needed since the loop is opt-in and disabled by default in tests

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/server/config.ts tests/helpers.ts
git commit -m "feat: opt-in git autocommit loop wired into createApp"
```

---

### Task 21: Maintenance CLI

**Files:**
- Create: `src/server/cli.ts`
- Test: `tests/server/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/cli.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMaintenance } from "../../src/server/cli";

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-maint-"));
  mkdirSync(join(vaultPath, ".scrypt", "trash"), { recursive: true });
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("runMaintenance", () => {
  test("prunes trash files older than the threshold", async () => {
    const oldFile = join(vaultPath, ".scrypt", "trash", "old.md");
    const newFile = join(vaultPath, ".scrypt", "trash", "new.md");
    writeFileSync(oldFile, "old");
    writeFileSync(newFile, "new");
    // Backdate oldFile by 60 days
    const past = (Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000;
    await Bun.$`touch -t ${new Date(past * 1000)
      .toISOString()
      .slice(0, 16)
      .replace(/[-:]/g, "")} ${oldFile}`.nothrow();

    const result = await runMaintenance({
      vaultPath,
      trashRetentionDays: 30,
    });

    expect(result.trashPruned).toBe(1);
    expect(Bun.file(oldFile).size > 0).toBe(false);
  });

  test("returns counts for every step", async () => {
    const result = await runMaintenance({
      vaultPath,
      trashRetentionDays: 30,
    });
    expect(result).toHaveProperty("trashPruned");
    expect(result).toHaveProperty("vacuumed");
    expect(result).toHaveProperty("ftsRebuilt");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/server/cli.test.ts`
Expected: FAIL — cli module missing

- [ ] **Step 3: Create `src/server/cli.ts`**

```typescript
// src/server/cli.ts
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createDatabase, initSchema } from "./db";
import { ActivityLog } from "./activity";

export interface MaintenanceOpts {
  vaultPath: string;
  trashRetentionDays: number;
}

export interface MaintenanceResult {
  trashPruned: number;
  vacuumed: boolean;
  ftsRebuilt: boolean;
}

async function pruneTrash(
  vaultPath: string,
  retentionDays: number,
): Promise<number> {
  const trashDir = join(vaultPath, ".scrypt", "trash");
  if (!existsSync(trashDir)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(trashDir);
  let pruned = 0;
  for (const entry of entries) {
    const full = join(trashDir, entry);
    try {
      const s = await stat(full);
      if (s.isFile() && s.mtimeMs < cutoff) {
        await unlink(full);
        pruned++;
      }
    } catch {
      // ignore individual failures
    }
  }
  return pruned;
}

export async function runMaintenance(
  opts: MaintenanceOpts,
): Promise<MaintenanceResult> {
  const result: MaintenanceResult = {
    trashPruned: 0,
    vacuumed: false,
    ftsRebuilt: false,
  };

  result.trashPruned = await pruneTrash(opts.vaultPath, opts.trashRetentionDays);

  const dbPath = join(opts.vaultPath, ".scrypt", "scrypt.db");
  if (existsSync(dbPath)) {
    const db = createDatabase(dbPath);
    try {
      initSchema(db);
      db.run("VACUUM");
      result.vacuumed = true;

      // FTS5 rebuild — no drift detection yet, always rebuild
      try {
        db.run("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')");
        result.ftsRebuilt = true;
      } catch {
        // table may not exist yet in fresh vaults
      }

      const activity = new ActivityLog(db);
      activity.record({
        action: "update",
        kind: null,
        path: ".scrypt/scrypt.db",
        actor: "system",
        meta: result as unknown as Record<string, unknown>,
      });
    } finally {
      db.close();
    }
  }

  return result;
}

if (import.meta.main) {
  const sub = process.argv[2];
  if (sub !== "maintenance") {
    console.error("usage: bun src/server/cli.ts maintenance");
    process.exit(2);
  }
  const vaultPath = process.env.SCRYPT_VAULT_PATH || process.cwd();
  const retention = Number(process.env.SCRYPT_TRASH_RETENTION_DAYS) || 30;
  runMaintenance({ vaultPath, trashRetentionDays: retention })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error("maintenance failed:", e);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test tests/server/cli.test.ts`
Expected: PASS — 2 tests green

- [ ] **Step 5: Commit**

```bash
git add src/server/cli.ts tests/server/cli.test.ts
git commit -m "feat: maintenance CLI — trash prune, vacuum, FTS rebuild"
```

---

## Wave 5 — UI polish (parallel with Wave 4)

### Task 22: Default route redirect /→/journal

**Files:**
- Modify: `src/client/App.tsx`
- Test: `tests/client/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/app-shell.test.tsx` (inside the existing describe):

```typescript
  test("root route / redirects to /journal", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    // JournalView has a Today button; look for it
    await waitFor(() => {
      expect(screen.getByText(/Today/i)).toBeDefined();
    });
  });

  test("sidebar highlights Journal when on /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    const sidebar = screen.getByTestId("sidebar");
    const journalBtn = within(sidebar).getByText("Journal");
    // active class or aria-current — assert one of them
    expect(
      journalBtn.className.includes("bg-") ||
        journalBtn.getAttribute("aria-current") === "page",
    ).toBe(true);
  });
```

Also add `waitFor` to the imports if it's not there:

```typescript
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test tests/client/app-shell.test.tsx -t "root route"`
Expected: FAIL — `/` currently renders something else or nothing selected

- [ ] **Step 3: Add redirect in `src/client/App.tsx`**

Find the Routes block. Change the root route:

```tsx
import { Navigate } from "react-router";
// ...
<Routes>
  <Route path="/" element={<Navigate to="/journal" replace />} />
  <Route path="/journal" element={<JournalView />} />
  {/* ...existing routes... */}
</Routes>
```

For the sidebar highlight: find the Journal button in the Sidebar component and add an active class when `useLocation().pathname === "/journal" || useLocation().pathname === "/"`. Example:

```tsx
const { pathname } = useLocation();
const isJournal = pathname === "/journal" || pathname === "/";
<button
  aria-current={isJournal ? "page" : undefined}
  className={`... ${isJournal ? "bg-[var(--bg-tertiary)]" : ""}`}
  onClick={() => navigate("/journal")}
>
  Journal
</button>
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test tests/client/app-shell.test.tsx`
Expected: PASS — all app shell tests (including new ones) green

- [ ] **Step 5: Commit**

```bash
git add src/client/App.tsx tests/client/app-shell.test.tsx
git commit -m "fix: / redirects to /journal and sidebar highlights it"
```

---

### Task 23: Notes list view at /notes

**Files:**
- Create: `src/client/views/NotesList.tsx`
- Modify: `src/client/App.tsx` (add route)
- Test: `tests/client/notes-list.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/client/notes-list.test.tsx`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { NotesList } from "../../src/client/views/NotesList";

globalThis.fetch = (async (url: string) => {
  if (url.startsWith("/api/notes")) {
    return new Response(
      JSON.stringify([
        {
          path: "notes/a.md",
          title: "A Note",
          tags: ["intro"],
          modified: "2026-04-12T10:00:00Z",
          created: "2026-04-10T10:00:00Z",
        },
        {
          path: "notes/b.md",
          title: "B Note",
          tags: ["project"],
          modified: "2026-04-11T10:00:00Z",
          created: "2026-04-11T10:00:00Z",
        },
      ]),
    );
  }
  return new Response("[]");
}) as any;

afterEach(() => cleanup());

describe("NotesList", () => {
  test("renders all notes with titles", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    expect(await screen.findByText("A Note")).toBeDefined();
    expect(screen.getByText("B Note")).toBeDefined();
  });

  test("shows tags", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/intro/)).toBeDefined();
    expect(screen.getByText(/project/)).toBeDefined();
  });

  test("sorts by modified desc by default", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    const rows = await screen.findAllByTestId("note-row");
    expect(rows[0]).toHaveTextContent("A Note");
    expect(rows[1]).toHaveTextContent("B Note");
  });

  test("filter by tag narrows the list", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    await screen.findByText("A Note");
    const filterInput = screen.getByPlaceholderText(/filter by tag/i);
    fireEvent.change(filterInput, { target: { value: "intro" } });
    expect(screen.queryByText("B Note")).toBeNull();
    expect(screen.getByText("A Note")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test tests/client/notes-list.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 3: Create `src/client/views/NotesList.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import type { NoteMeta } from "../../shared/types";

type SortKey = "modified" | "created" | "title";

export function NotesList() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [sort, setSort] = useState<SortKey>("modified");
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    api.notes.list().then(setNotes).catch(() => setNotes([]));
  }, []);

  const filtered = useMemo(() => {
    let out = notes;
    if (tagFilter) {
      out = out.filter((n) =>
        n.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase())),
      );
    }
    out = [...out].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const aVal = a[sort] || "";
      const bVal = b[sort] || "";
      return bVal.localeCompare(aVal);
    });
    return out;
  }, [notes, sort, tagFilter]);

  return (
    <div data-testid="notes-list" className="p-4 h-full overflow-auto">
      <div className="flex gap-3 items-center mb-4">
        <input
          placeholder="Filter by tag"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)]"
        >
          <option value="modified">Modified</option>
          <option value="created">Created</option>
          <option value="title">Title</option>
        </select>
        <span className="text-[var(--text-muted)] text-xs ml-auto">
          {filtered.length} notes
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--text-muted)] uppercase text-xs">
            <th className="py-1">Title</th>
            <th className="py-1">Tags</th>
            <th className="py-1">Modified</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((n) => (
            <tr
              key={n.path}
              data-testid="note-row"
              onClick={() => navigate(`/note/${n.path}`)}
              className="border-t border-[var(--border)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            >
              <td className="py-1.5 text-[var(--text-primary)]">{n.title}</td>
              <td className="py-1.5 text-[var(--text-muted)]">
                {n.tags.map((t) => `#${t}`).join(" ")}
              </td>
              <td className="py-1.5 text-[var(--text-muted)]">
                {n.modified?.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Add the route in `src/client/App.tsx`**

```tsx
import { NotesList } from "./views/NotesList";
// ...
<Route path="/notes" element={<NotesList />} />
```

Also make the Notes sidebar button navigate to `/notes`:

```tsx
<button onClick={() => navigate("/notes")}>Notes</button>
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `bun test tests/client/notes-list.test.tsx`
Expected: PASS — 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/client/views/NotesList.tsx src/client/App.tsx tests/client/notes-list.test.tsx
git commit -m "feat: /notes list view with sort and tag filter"
```

---

### Task 24: Sidebar files list grouping

**Files:**
- Modify: `src/client/App.tsx` (or wherever Sidebar is defined)
- Test: `tests/client/sidebar-grouping.test.tsx`

- [ ] **Step 1: Find the sidebar Files list**

Open `src/client/App.tsx` and locate the block rendering the flat `FILES` list (the one that shows all notes like "Welcome to Scrypt", "Roadmap", etc.).

- [ ] **Step 2: Write the failing test**

Create `tests/client/sidebar-grouping.test.tsx`:

```typescript
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppContent } from "../../src/client/App";
import { useStore } from "../../src/client/store";

globalThis.fetch = (async () =>
  new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  })) as any;

beforeEach(() => {
  useStore.setState({
    notes: [
      {
        path: "notes/threads/open-thing.md",
        title: "Open Thing",
        tags: [],
        modified: "2026-04-12T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
      {
        path: "notes/research/2026-04-12-0314-run.md",
        title: "Run Note",
        tags: [],
        modified: "2026-04-12T11:00:00Z",
        created: "2026-04-12T11:00:00Z",
        aliases: [],
      },
      {
        path: "memory/3d-printing.md",
        title: "3D Printing",
        tags: [],
        modified: "2026-04-10T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
      {
        path: "notes/inbox/random.md",
        title: "Random",
        tags: [],
        modified: "2026-04-10T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
    ],
    tabs: [],
    activeTab: null,
    commandPaletteOpen: false,
    sidebarCollapsed: false,
  });
});
afterEach(() => cleanup());

describe("Sidebar grouping", () => {
  test("shows collapsible section headers", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.getByText(/THREADS/i)).toBeDefined();
    expect(screen.getByText(/RESEARCH/i)).toBeDefined();
    expect(screen.getByText(/MEMORY/i)).toBeDefined();
    expect(screen.getByText(/INBOX/i)).toBeDefined();
  });

  test("does not show empty sections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/LOGS/i)).toBeNull();
  });

  test("files appear under their section", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.getByText("Open Thing")).toBeDefined();
    expect(screen.getByText("Run Note")).toBeDefined();
    expect(screen.getByText("3D Printing")).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `bun test tests/client/sidebar-grouping.test.tsx`
Expected: FAIL — sidebar renders a flat list

- [ ] **Step 4: Replace the flat files list with a grouped renderer**

In `src/client/App.tsx`, replace the existing FILES section rendering with:

```tsx
const SIDEBAR_GROUPS = [
  { label: "THREADS", prefix: "notes/threads/" },
  { label: "RESEARCH", prefix: "notes/research/" },
  { label: "MEMORY", prefix: "memory/" },
  { label: "INBOX", prefix: "notes/inbox/" },
  { label: "IDEAS", prefix: "notes/ideas/" },
  { label: "THOUGHTS", prefix: "notes/thoughts/" },
  { label: "LOGS", prefix: "notes/logs/" },
  { label: "DOCS", prefix: "docs/" },
];

function SidebarFiles() {
  const notes = useStore((s) => s.notes);
  const navigate = useNavigate();

  return (
    <>
      {SIDEBAR_GROUPS.map((group) => {
        const items = notes
          .filter((n) => n.path.startsWith(group.prefix))
          .sort((a, b) =>
            (b.modified ?? "").localeCompare(a.modified ?? ""),
          )
          .slice(0, 20);
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mt-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] px-3 mb-1">
              {group.label}
            </div>
            {items.map((n) => (
              <button
                key={n.path}
                onClick={() => navigate(`/note/${n.path}`)}
                className="block w-full text-left px-3 py-0.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate"
              >
                {n.title}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
```

Use `<SidebarFiles />` inside the existing Sidebar component where the old `FILES` list was rendered.

- [ ] **Step 5: Run tests, verify they pass**

Run: `bun test tests/client/sidebar-grouping.test.tsx`
Expected: PASS — 3 tests green

- [ ] **Step 6: Run the app-shell tests to make sure nothing broke**

Run: `bun test tests/client/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/client/App.tsx tests/client/sidebar-grouping.test.tsx
git commit -m "feat: sidebar groups files by folder with section headers"
```

---

## Wave 6 — Deployment, seed, verification (Sequential)

### Task 25: Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.scrypt
.git
.github
.vscode
.cursor
.claude
.superpowers
.playwright-mcp
test-results
test-screenshots
coverage
docs
tests
*.log
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Multi-stage build for Scrypt
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3777
USER bun
CMD ["bun", "src/server/index.ts"]
```

- [ ] **Step 3: Build the image locally and verify it runs**

Run: `docker build -t scrypt:dev .`
Expected: build succeeds, image created.

Run: `docker run --rm -e SCRYPT_AUTH_TOKEN=test -e NODE_ENV=production -p 3777:3777 -v $(pwd)/test-vault:/app/vault scrypt:dev`
(You may need to `mkdir test-vault` first.)

In another shell: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer test" http://localhost:3777/api/daily_context`
Expected: `200`

Kill the container.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: Dockerfile and .dockerignore for production deploys"
```

---

### Task 26: docker-compose.yml and .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```
# Scrypt — environment configuration
# Copy to .env and fill in.

# Required in production
SCRYPT_AUTH_TOKEN=change-me

# Optional — defaults shown
# SCRYPT_PORT=3777
# SCRYPT_VAULT_PATH=/vault
# SCRYPT_LOG_LEVEL=info
# SCRYPT_TRASH_RETENTION_DAYS=30

# Git-backed version history (opt-in)
# SCRYPT_GIT_AUTOCOMMIT=1
# SCRYPT_GIT_AUTOCOMMIT_INTERVAL=900

# Set to production to enforce auth and disable localhost dev bypass
NODE_ENV=production
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  scrypt:
    build: .
    container_name: scrypt
    restart: unless-stopped
    ports:
      - "3777:3777"
    environment:
      - SCRYPT_AUTH_TOKEN=${SCRYPT_AUTH_TOKEN}
      - SCRYPT_VAULT_PATH=/vault
      - SCRYPT_GIT_AUTOCOMMIT=${SCRYPT_GIT_AUTOCOMMIT:-0}
      - NODE_ENV=production
    volumes:
      - ./vault:/vault
    working_dir: /vault
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "build: docker-compose and .env.example"
```

---

### Task 27: systemd unit

**Files:**
- Create: `systemd/scrypt.service`

- [ ] **Step 1: Create the unit file**

```ini
[Unit]
Description=Scrypt knowledge server
Documentation=https://github.com/your-org/scrypt
After=network.target

[Service]
Type=simple
User=scrypt
WorkingDirectory=/home/scrypt/vault
EnvironmentFile=/etc/scrypt/scrypt.env
ExecStart=/home/scrypt/.bun/bin/bun /opt/scrypt/src/server/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add systemd/scrypt.service
git commit -m "build: systemd unit for non-docker deploys"
```

---

### Task 28: README deployment section + top-level update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a deployment section**

Append to `README.md`:

````markdown
## Deploying to Oracle Cloud (ARM Always Free)

Scrypt is designed to run on an Oracle Cloud Ampere A1 Always-Free VM (aarch64, 1GB RAM). It can run in Docker or directly via systemd.

### Prerequisites

- An Ampere A1 VM (Ubuntu 22.04 or similar)
- A Tailscale-connected network (recommended — keeps the API off the public internet)
- A secret token you'll generate yourself and pass as `SCRYPT_AUTH_TOKEN`

### Option A: Docker

```bash
# On the VM
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
# Log out / back in for group change

git clone https://github.com/your-org/scrypt.git
cd scrypt
cp .env.example .env
# Edit .env — set SCRYPT_AUTH_TOKEN to a strong random value
mkdir vault
docker compose up -d

# Verify
curl -s -H "Authorization: Bearer $(grep SCRYPT_AUTH_TOKEN .env | cut -d= -f2)" \
  http://localhost:3777/api/daily_context
```

### Option B: systemd (lower RAM ceiling)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install dependencies
sudo useradd -m -s /bin/bash scrypt
sudo mkdir -p /opt/scrypt /etc/scrypt
sudo chown scrypt:scrypt /opt/scrypt
sudo -u scrypt git clone https://github.com/your-org/scrypt.git /opt/scrypt
sudo -u scrypt bash -lc "cd /opt/scrypt && bun install && bun run build"

# Configure
sudo tee /etc/scrypt/scrypt.env > /dev/null <<EOF
SCRYPT_AUTH_TOKEN=change-me
SCRYPT_VAULT_PATH=/home/scrypt/vault
NODE_ENV=production
EOF
sudo mkdir -p /home/scrypt/vault
sudo chown -R scrypt:scrypt /home/scrypt/vault

# Install and start
sudo cp /opt/scrypt/systemd/scrypt.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scrypt
sudo systemctl status scrypt
```

### Nightly maintenance cron

Prune trash, vacuum the DB, and rebuild FTS once a day:

```
0 3 * * * cd /home/scrypt/vault && /home/scrypt/.bun/bin/bun /opt/scrypt/src/server/cli.ts maintenance
```

### Smoke test from the orchestrator

```bash
TOKEN=your-token
HOST=http://scrypt.tailnet:3777

curl -s -H "Authorization: Bearer $TOKEN" "$HOST/api/daily_context" | jq .
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"thought","title":"Smoke","content":"hello"}' \
  "$HOST/api/ingest"
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Oracle ARM deployment guide"
```

---

### Task 29: Seed research-sources memory

**Files:**
- Create: `memory/research-sources.md` (in the user's working vault, not in the repo)

- [ ] **Step 1: Write the seed memory file**

Write the following content to `memory/research-sources.md` in the current working vault:

```markdown
---
title: Research sources
kind: memory
category: preference
active: true
priority: 3
tags: [memory, preference, research]
---

# Research sources

Preferred places to look for research, ranked by usefulness:

## Tech / programming
- Reddit: r/programming, r/ExperiencedDevs, r/rust, r/golang, r/cpp
- Hacker News (news.ycombinator.com)
- arxiv.org — recent papers
- GitHub trending + release notes of relevant projects
- Company engineering blogs (Cloudflare, Discord, Stripe, Netflix, Meta)

## Making / hardware / 3D printing
- Reddit: r/resinprinting, r/3Dprinting, r/functionalprint
- YouTube: Bambu Lab channel, Teaching Tech, CNC Kitchen
- Printables + Thingiverse for models

## Art / creative
- ArtStation, Behance
- Reddit: r/Art, r/DigitalPainting
- YouTube: Proko, Marco Bucci

## Anime / pop culture
- MyAnimeList, AniList
- Reddit: r/anime, r/manga
- Crunchyroll / ANN news

## Avoid
- Wikipedia for cutting-edge tech (stale)
- Medium blogs (SEO noise)
- Any aggregator that doesn't link to primary sources
```

- [ ] **Step 2: Confirm the file was picked up**

Run: `curl -s http://localhost:3777/api/memories | jq .`
Expected: the response contains an entry with `"slug": "research-sources"` and `"active": true`.

(Server does not need to be restarted — the file watcher picks it up.)

- [ ] **Step 3: No commit for this task**

The file lives in the user's vault, which is gitignored by the app's own `.gitignore`. Skip committing.

---

### Task 30: End-to-end smoke test

**Files:**
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write the smoke script**

Create `scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HOST="${SCRYPT_URL:-http://localhost:3777}"
TOKEN="${SCRYPT_AUTH_TOKEN:-}"
AUTH=()
if [ -n "$TOKEN" ]; then
  AUTH=(-H "Authorization: Bearer $TOKEN")
fi

fail() { echo "FAIL: $1"; exit 1; }

echo "1. daily_context"
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$HOST/api/daily_context")
[ "$STATUS" = "200" ] || fail "daily_context returned $STATUS"

echo "2. ingest a thread"
THREAD_PATH=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"kind":"thread","title":"smoke test thread","content":"# test","frontmatter":{"status":"open","priority":1,"prompt":"smoke"}}' \
  "$HOST/api/ingest" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$THREAD_PATH" ] || fail "ingest thread returned no path"

echo "3. threads list includes new thread"
curl -sS "${AUTH[@]}" "$HOST/api/threads?status=open" | grep -q "smoke-test-thread" || fail "thread not in list"

echo "4. create a research run"
RUN=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"title":"smoke run","content":"## Summary\nfound things\n","frontmatter":{"thread":"smoke-test-thread","status":"success","started_at":"2026-04-12T00:00:00.000Z","completed_at":"2026-04-12T00:01:00.000Z"}}' \
  "$HOST/api/research_runs")
echo "$RUN" | grep -q "thread_updated" || fail "run did not update thread"

echo "5. activity log has 3+ entries"
COUNT=$(curl -sS "${AUTH[@]}" "$HOST/api/activity?limit=100" | grep -o '"id"' | wc -l)
[ "$COUNT" -ge 3 ] || fail "activity log has $COUNT entries, expected >= 3"

echo "PASS"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/smoke.sh
```

- [ ] **Step 3: Run the smoke test against the local server**

Start the server in one terminal:
```bash
rm -f .scrypt/scrypt.db .scrypt/scrypt.db-shm .scrypt/scrypt.db-wal
bun src/server/index.ts
```

In another terminal:
```bash
./scripts/smoke.sh
```
Expected: `PASS`

Kill the server.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.sh
git commit -m "test: end-to-end smoke script for orchestrator contract"
```

---

### Task 31: Final full test suite + manual visual check

- [ ] **Step 1: Run the full test suite**

Run: `bun run test`
Expected: ALL tests pass. Tests added in this plan should be approximately:
- `db.test.ts` — +3
- `config.test.ts` — 7
- `auth.test.ts` — 9
- `activity.test.ts` — 7
- `parsers.test.ts` — +3 (timestamps) +7 (tag regressions)
- `slugger.test.ts` — 10
- `ingest/kinds.test.ts` — 14
- `ingest/router.test.ts` — 13
- `git-autocommit.test.ts` — 5
- `cli.test.ts` — 2
- `api/ingest.test.ts` — 4
- `api/threads.test.ts` — 7
- `api/research.test.ts` — 4
- `api/memories.test.ts` — 4
- `api/daily-context.test.ts` — 4
- `api/activity.test.ts` — 4
- `app-shell.test.tsx` — +2
- `notes-list.test.tsx` — 4
- `sidebar-grouping.test.tsx` — 3

Total new: ~115 tests. Combined with existing 141 → ~256 tests all green.

- [ ] **Step 2: Start the server and run the visual check**

```bash
rm -f .scrypt/scrypt.db*
bun src/server/index.ts
```

Open `http://localhost:3777/` in a browser. Verify:
- `/` redirects to `/journal` and Journal is highlighted in the sidebar
- `/notes` shows the notes list with filter + sort working
- Sidebar files are grouped by section, empty sections hidden
- Graph view renders
- Command palette opens on ⌘K
- Data explorer renders `books.csv`

Kill the server.

- [ ] **Step 3: No commit for this task**

---

## Summary

When every task in this plan is green:

1. Scrypt has a production auth layer with dev bypass
2. Threads, research_runs, memories, activity_log are all first-class
3. `POST /api/ingest` routes any `kind` to the right folder with server-owned timestamps
4. The orchestrator can drive research runs that update threads and the graph view
5. `GET /api/daily_context` returns a single bundle for starting each Claude session
6. Git autocommit provides free version history on opt-in
7. The maintenance CLI keeps trash and the SQLite index tidy
8. The browser UI is pleasant for daily use: `/`→`/journal`, a real notes list, grouped sidebar
9. Tag parser no longer pollutes the index with hex colors or numeric tags
10. The app builds as a Docker image and ships via `docker compose up -d` or a systemd unit

After this plan lands, the next step is building the Orchestrator (a separate project) against the `/api/ingest`, `/api/threads`, `/api/research_runs`, and `/api/daily_context` contracts documented here.
