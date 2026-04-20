// tests/server/api/graph.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestEnv } from "../../helpers";
import { initSchema } from "../../../src/server/db";
import { graphRoutes } from "../../../src/server/api/graph";
import { SnapshotScheduler } from "../../../src/server/graph/snapshot-scheduler";
import { Router } from "../../../src/server/router";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ready;

  // Two notes in dnd/research — subdomain edge
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "A",
    content: "See [[b-note]].",
    frontmatter: {
      domain: "dnd",
      subdomain: "research",
      tags: ["type:research", "project:longrest"],
    },
  });
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "B Note",
    content: "body",
    frontmatter: {
      domain: "dnd",
      subdomain: "research",
      tags: ["type:research", "architecture"],
    },
  });
  // Third note in dnd/plans — domain edge only
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "C Plan",
    content: "body",
    frontmatter: {
      domain: "dnd",
      subdomain: "plans",
      tags: ["type:plan"],
    },
  });
  // Fourth note in scrypt-dev — no edges to the others
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "D Scrypt",
    content: "body",
    frontmatter: {
      domain: "scrypt-dev",
      subdomain: "specs",
      tags: ["type:spec"],
    },
  });

  // Force a deterministic reindex — ingest writes files but relies on the
  // file watcher to populate the DB, which is racy inside a single test run.
  await env.app.indexer.fullReindex();
});

afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/graph", () => {
  test("returns nodes for every non-reserved note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const paths = data.nodes.map((n: any) => n.path);
    expect(paths).toContain("dnd/research/a.md");
    expect(paths).toContain("dnd/research/b-note.md");
    expect(paths).toContain("dnd/plans/c-plan.md");
    expect(paths).toContain("scrypt-dev/specs/d-scrypt.md");
  });

  test("generates wikilink edge from [[b-note]] in A to B Note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const wikilinks = data.edges.filter((e: any) => e.type === "wikilink");
    expect(wikilinks.length).toBe(1);
  });

  test("generates subdomain edge between A and B (both dnd/research)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const subdomainEdges = data.edges.filter(
      (e: any) => e.type === "subdomain",
    );
    expect(subdomainEdges.length).toBe(1);
    expect(subdomainEdges[0].weight).toBe(2);
  });

  test("generates domain edges between dnd/research notes and dnd/plans note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const domainEdges = data.edges.filter((e: any) => e.type === "domain");
    expect(domainEdges.length).toBe(2);
    expect(domainEdges.every((e: any) => e.weight === 1)).toBe(true);
  });

  test("generates namespaced-tag edges on type:research only (A↔B)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const tagEdges = data.edges.filter((e: any) => e.type === "tag");
    expect(tagEdges.length).toBe(1);
    expect(tagEdges[0].weight).toBe(1.5);
  });

  test("flat topic tags do NOT create server-side edges", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const tagEdges = data.edges.filter((e: any) => e.type === "tag");
    expect(tagEdges.length).toBe(1);
  });

  test("undirected edges deduplicated (no source>target pairs)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    for (const e of data.edges.filter((e: any) => e.type !== "wikilink")) {
      // Wave 8: node ids are note paths (strings), compared lexicographically.
      expect(e.source < e.target).toBe(true);
    }
  });

  test("connectionCount on each node is total edges touching it", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    for (const node of data.nodes) {
      const touching = data.edges.filter(
        (e: any) => e.source === node.id || e.target === node.id,
      );
      expect(node.connectionCount).toBe(touching.length);
    }
  });
});

// Auth is covered end-to-end by the parameterized list in
// tests/server/app-auth.test.ts → "Wave 3 routes require auth in production"
// which now includes /api/graph and /api/graph/*path. The dev localhost
// env used by this test file is auth-bypassed, so we only assert the
// happy-path shape here.
describe("GET /api/graph response shape (dev bypass)", () => {
  test("returns 200 in localhost dev mode with array nodes + edges", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });
});

describe("GET /api/graph/snapshot", () => {
  let db: Database;
  let vaultDir: string;
  let router: Router;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.run(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`,
    );
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-graph-api-"));
    router = new Router();
    const sched = new SnapshotScheduler(db, vaultDir, { debounceMs: 10 });
    graphRoutes(router, db, vaultDir, sched);
  });

  test("returns JSON snapshot, 200, Content-Type and ETag set", async () => {
    const res = await router.handle(
      new Request("http://x/api/graph/snapshot"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("ETag")).toBeTruthy();
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0].id).toBe("a.md");
  });

  test("304 when If-None-Match matches", async () => {
    const first = await router.handle(
      new Request("http://x/api/graph/snapshot"),
    );
    if (!first) throw new Error("no response");
    const etag = first.headers.get("ETag")!;
    const second = await router.handle(
      new Request("http://x/api/graph/snapshot", {
        headers: { "If-None-Match": etag },
      }),
    );
    if (!second) throw new Error("no response");
    expect(second.status).toBe(304);
  });
});

describe("GET /api/graph/snapshot SWR + error paths", () => {
  let db: Database;
  let vaultDir: string;
  let router: Router;
  let scheduler: SnapshotScheduler;
  let scheduleCalls: number;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.run(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`,
    );
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-graph-swr-"));
    router = new Router();
    scheduler = new SnapshotScheduler(db, vaultDir, { debounceMs: 5 });
    scheduleCalls = 0;
    const original = scheduler.schedule.bind(scheduler);
    scheduler.schedule = () => {
      scheduleCalls += 1;
      return original();
    };
    graphRoutes(router, db, vaultDir, scheduler);
  });

  test("stale snapshot triggers scheduler.schedule exactly once and serves stale body", async () => {
    // Pre-write a stale snapshot file so the handler takes the SWR branch.
    const dir = join(vaultDir, ".scrypt");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "graph.json");
    const stalePayload = JSON.stringify({
      generated_at: 1,
      nodes: [{ id: "stale", title: "Stale", doc_type: null, project: "root", degree: 0, community: 0 }],
      edges: [],
    });
    writeFileSync(filePath, stalePayload);
    const oldSecs = (Date.now() - 20_000) / 1000;
    utimesSync(filePath, oldSecs, oldSecs);

    const res = await router.handle(
      new Request("http://x/api/graph/snapshot"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes[0].id).toBe("stale");
    expect(scheduleCalls).toBe(1);

    // Second request immediately after — file mtime was refreshed only if
    // scheduler finished writing. Either way, route must not call schedule()
    // a second time when fresh.
    // Wait for the in-flight rebuild to land + refresh mtime.
    await Bun.sleep(80);
    const res2 = await router.handle(
      new Request("http://x/api/graph/snapshot"),
    );
    if (!res2) throw new Error("no response");
    expect(res2.status).toBe(200);
    expect(scheduleCalls).toBe(1);
  });

  test("returns 503 JSON with errorId when snapshot read fails", async () => {
    // Force the read path to fail by making the writer succeed but stubbing
    // Bun.file to reject after the file is created.
    const fileSpy = spyOn(Bun, "file").mockImplementation(((..._args: unknown[]) => ({
      arrayBuffer: () => Promise.reject(new Error("simulated EIO")),
    })) as unknown as typeof Bun.file);

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await router.handle(
        new Request("http://x/api/graph/snapshot"),
      );
      if (!res) throw new Error("no response");
      expect(res.status).toBe(503);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      const body = (await res.json()) as { error: string; reason?: string; errorId?: string };
      expect(body.error).toBe("graph snapshot unavailable");
      expect(typeof body.errorId).toBe("string");
      expect(body.errorId!.length).toBeGreaterThan(0);
      // Logged with same errorId.
      const logged = errSpy.mock.calls.some((call) => {
        const meta = call[1] as { errorId?: string } | undefined;
        return meta?.errorId === body.errorId;
      });
      expect(logged).toBe(true);
    } finally {
      fileSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe("GET /api/graph/snapshot/health", () => {
  let db: Database;
  let vaultDir: string;
  let router: Router;
  let scheduler: SnapshotScheduler;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-graph-health-"));
    router = new Router();
    scheduler = new SnapshotScheduler(db, vaultDir, { debounceMs: 5 });
    graphRoutes(router, db, vaultDir, scheduler);
  });

  test("reports disabled, lastError, buildCount", async () => {
    const res = await router.handle(
      new Request("http://x/api/graph/snapshot/health"),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      disabled: boolean;
      lastError: string | null;
      buildCount: number;
    };
    expect(body.disabled).toBe(false);
    expect(body.lastError).toBeNull();
    expect(body.buildCount).toBe(0);

    await scheduler.flushNow();
    const res2 = await router.handle(
      new Request("http://x/api/graph/snapshot/health"),
    );
    if (!res2) throw new Error("no response");
    const body2 = (await res2.json()) as { buildCount: number };
    expect(body2.buildCount).toBeGreaterThanOrEqual(1);
  });
});
