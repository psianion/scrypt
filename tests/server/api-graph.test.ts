// tests/server/api-graph.test.ts
//
// ingest-v3: verify /api/graph + /api/graph/search surface project /
// doc_type / thread fields and honour filter query params.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote } from "../helpers/ctx";
import { Router } from "../../src/server/router";
import { graphRoutes } from "../../src/server/api/graph";
import type { SnapshotScheduler } from "../../src/server/graph/snapshot-scheduler";

function fakeScheduler(): SnapshotScheduler {
  return {
    schedule: () => {},
    buildCount: 0,
    disabled: false,
    lastError: null,
  } as unknown as SnapshotScheduler;
}

function mount(db: Database): { router: Router; cleanupDir: () => void } {
  const vaultDir = mkdtempSync(join(tmpdir(), "graph-api-"));
  const router = new Router();
  graphRoutes(router, db, vaultDir, fakeScheduler());
  return {
    router,
    cleanupDir: () => rmSync(vaultDir, { recursive: true, force: true }),
  };
}

test("GET /api/graph returns nodes with project/doc_type/thread", async () => {
  const ctx = buildCtx();
  const { router, cleanupDir } = mount(ctx.db as unknown as Database);
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "t1",
    });
    const res = await router.handle(new Request("http://x/api/graph"));
    expect(res).not.toBeNull();
    const body = (await (res as Response).json()) as {
      nodes: Array<{
        path: string;
        project: string | null;
        doc_type: string | null;
        thread: string | null;
      }>;
    };
    const n = body.nodes.find((x) => x.path === "projects/p/plan/a.md");
    expect(n).toBeDefined();
    expect(n!.project).toBe("p");
    expect(n!.doc_type).toBe("plan");
    expect(n!.thread).toBe("t1");
  } finally {
    cleanupDir();
    ctx.cleanup();
  }
});

test("GET /api/graph?project=testp filters nodes to that project", async () => {
  const ctx = buildCtx();
  const { router, cleanupDir } = mount(ctx.db as unknown as Database);
  try {
    seedNote(ctx, { project: "testp", doc_type: "plan", slug: "a" });
    seedNote(ctx, { project: "other", doc_type: "plan", slug: "b" });
    const res = await router.handle(
      new Request("http://x/api/graph?project=testp"),
    );
    const body = (await (res as Response).json()) as {
      nodes: Array<{ path: string; project: string | null }>;
    };
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(
      body.nodes.every((n) => n.path.startsWith("projects/testp/")),
    ).toBe(true);
  } finally {
    cleanupDir();
    ctx.cleanup();
  }
});

test("GET /api/graph?doc_type=plan&thread=t1 applies combined filters", async () => {
  const ctx = buildCtx();
  const { router, cleanupDir } = mount(ctx.db as unknown as Database);
  try {
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "t1",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "b",
      thread: "t2",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "research",
      slug: "c",
      thread: "t1",
    });
    const res = await router.handle(
      new Request("http://x/api/graph?doc_type=plan&thread=t1"),
    );
    const body = (await (res as Response).json()) as {
      nodes: Array<{
        path: string;
        doc_type: string | null;
        thread: string | null;
      }>;
    };
    expect(body.nodes.length).toBe(1);
    expect(body.nodes[0].doc_type).toBe("plan");
    expect(body.nodes[0].thread).toBe("t1");
  } finally {
    cleanupDir();
    ctx.cleanup();
  }
});
