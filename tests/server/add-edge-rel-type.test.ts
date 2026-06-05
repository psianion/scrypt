// tests/server/add-edge-rel-type.test.ts
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, type TestCtx } from "../helpers/ctx";
import { addEdgeTool } from "../../src/server/mcp/tools/add-edge";
import { removeEdgeTool } from "../../src/server/mcp/tools/remove-edge";
import { Idempotency } from "../../src/server/mcp/idempotency";
import type { ToolContext } from "../../src/server/mcp/types";
import { REL_TYPES } from "../../src/server/vocab/rel-types";
import { buildGraphSnapshot } from "../../src/server/graph/snapshot";

function toolCtx(t: TestCtx): ToolContext {
  return {
    db: t.db as unknown as Database,
    idempotency: new Idempotency(t.db as unknown as Database),
    scheduleGraphRebuild: () => {},
  } as unknown as ToolContext;
}

test("add_edge persists each rel_type at tier='mentions'", async () => {
  const ctx = buildCtx();
  try {
    let i = 0;
    for (const rt of REL_TYPES) {
      const s = seedNote(ctx, { project: "p", doc_type: "guide", slug: `s${i}` });
      const t = seedNote(ctx, { project: "p", doc_type: "guide", slug: `t${i}` });
      const r = await addEdgeTool.handler(
        toolCtx(ctx),
        { source: s, target: t, tier: "mentions", rel_type: rt, client_tag: `rel${i}` },
        "c",
      );
      expect(r.edge_id).toBeGreaterThan(0);
      const row = ctx.db
        .query<{ rel_type: string | null; client_tag: string | null }, [number]>(
          `SELECT rel_type, client_tag FROM graph_edges WHERE id = ?`,
        )
        .get(r.edge_id);
      expect(row?.rel_type).toBe(rt);
      expect(row?.client_tag).toBe(`rel${i}`);
      i++;
    }
  } finally {
    ctx.cleanup();
  }
});

test("add_edge rejects an unknown rel_type", async () => {
  const ctx = buildCtx();
  try {
    const s = seedNote(ctx, { project: "p", doc_type: "guide", slug: "a" });
    const t = seedNote(ctx, { project: "p", doc_type: "guide", slug: "b" });
    await expect(
      addEdgeTool.handler(
        toolCtx(ctx),
        { source: s, target: t, tier: "mentions", rel_type: "supports", client_tag: "bad1" },
        "c",
      ),
    ).rejects.toThrow(/invalid rel_type/);
  } finally {
    ctx.cleanup();
  }
});

test("add_edge omitting rel_type still works (column stays NULL)", async () => {
  const ctx = buildCtx();
  try {
    const s = seedNote(ctx, { project: "p", doc_type: "guide", slug: "c" });
    const t = seedNote(ctx, { project: "p", doc_type: "guide", slug: "d" });
    const r = await addEdgeTool.handler(
      toolCtx(ctx),
      { source: s, target: t, tier: "mentions", client_tag: "nr1" },
      "c",
    );
    const row = ctx.db
      .query<{ rel_type: string | null }, [number]>(
        `SELECT rel_type FROM graph_edges WHERE id = ?`,
      )
      .get(r.edge_id);
    expect(row?.rel_type).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

test("remove_edge deletes a curated typed edge but leaves a client_tag NULL structural edge", async () => {
  const ctx = buildCtx();
  try {
    const s = seedNote(ctx, { project: "p", doc_type: "guide", slug: "src" });
    const t = seedNote(ctx, { project: "p", doc_type: "guide", slug: "tgt" });
    await addEdgeTool.handler(
      toolCtx(ctx),
      { source: s, target: t, tier: "mentions", rel_type: "builds_on", client_tag: "cur1" },
      "c",
    );
    ctx.db.run(
      `INSERT INTO graph_edges (source, target, tier, reason, client_tag, created_at)
       VALUES (?, ?, 'connected', 'reference', NULL, ?)`,
      [s, t, Date.now()],
    );
    const before = ctx.db
      .query<{ n: number }, [string, string]>(
        `SELECT COUNT(*) AS n FROM graph_edges WHERE source = ? AND target = ?`,
      )
      .get(s, t);
    expect(before?.n).toBe(2);
    const rm = await removeEdgeTool.handler(
      toolCtx(ctx),
      { source: s, target: t, client_tag: "rm1" },
      "c",
    );
    expect(rm.removed).toBe(1);
    const survivor = ctx.db
      .query<{ tier: string; reason: string | null; client_tag: string | null }, [string, string]>(
        `SELECT tier, reason, client_tag FROM graph_edges WHERE source = ? AND target = ?`,
      )
      .get(s, t);
    expect(survivor?.client_tag).toBeNull();
    expect(survivor?.reason).toBe("reference");
    expect(survivor?.tier).toBe("connected");
  } finally {
    ctx.cleanup();
  }
});

test("typed rel_type edge survives the snapshot and carries rel_type", async () => {
  const ctx = buildCtx();
  try {
    const s = seedNote(ctx, { project: "p", doc_type: "guide", slug: "sa" });
    const t = seedNote(ctx, { project: "p", doc_type: "guide", slug: "ta" });
    await addEdgeTool.handler(
      toolCtx(ctx),
      { source: s, target: t, tier: "mentions", rel_type: "builds_on", client_tag: "snap1" },
      "c",
    );
    const snap = buildGraphSnapshot(ctx.db as unknown as Database);
    const edge = snap.edges.find((e) => e.source === s && e.target === t);
    expect(edge).toBeDefined();
    expect(edge?.tier).toBe("mentions");
    expect(edge?.rel_type).toBe("builds_on");
  } finally {
    ctx.cleanup();
  }
});
