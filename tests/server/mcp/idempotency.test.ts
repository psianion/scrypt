// tests/server/mcp/idempotency.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { Idempotency } from "../../../src/server/mcp/idempotency";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { MCP_ERROR } from "../../../src/server/mcp/errors";

describe("Idempotency", () => {
  let db: Database;
  let idem: Idempotency;
  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    idem = new Idempotency(db);
  });

  test("first call with a tag executes and caches", async () => {
    let calls = 0;
    const exec = async () => {
      calls++;
      return { ok: true, n: 42 };
    };
    const r1 = await idem.runCached("create_note", "tag-1", exec);
    const r2 = await idem.runCached("create_note", "tag-1", exec);
    expect(calls).toBe(1);
    expect(r1).toEqual(r2);
    expect((r2 as { n: number }).n).toBe(42);
  });

  test("reusing a tag with a different tool throws idempotency mismatch", async () => {
    await idem.runCached("create_note", "tag-2", async () => ({ ok: true }));
    let caught: unknown = null;
    try {
      await idem.runCached("add_edge", "tag-2", async () => ({ ok: true }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.IDEMPOTENCY_MISMATCH });
  });

  test("sweepExpired removes rows older than the cutoff", () => {
    const now = Date.now();
    const insert = db.prepare(
      `INSERT INTO mcp_dedup (client_tag, tool, response, created_at) VALUES (?, ?, ?, ?)`,
    );
    insert.run("old", "create_note", "{}", now - 40 * 86400_000);
    insert.run("fresh", "create_note", "{}", now - 1000);

    const deleted = idem.sweepExpired(30 * 86400_000);
    expect(deleted).toBe(1);

    const remaining = db
      .query<{ client_tag: string }, []>(
        "SELECT client_tag FROM mcp_dedup ORDER BY client_tag",
      )
      .all();
    expect(remaining).toEqual([{ client_tag: "fresh" }]);
  });
});
