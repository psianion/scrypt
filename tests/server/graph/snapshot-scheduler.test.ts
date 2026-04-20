import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotScheduler } from "../../../src/server/graph/snapshot-scheduler";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SnapshotScheduler", () => {
  let db: Database;
  let vaultDir: string;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.run(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`,
    );
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-snap-"));
  });

  test("schedule() with debounce 50ms writes the snapshot once after quiet period", async () => {
    const s = new SnapshotScheduler(db, vaultDir, { debounceMs: 50 });
    s.schedule();
    s.schedule();
    s.schedule();
    await wait(120);
    const path = join(vaultDir, ".scrypt", "graph.json");
    expect(existsSync(path)).toBe(true);
    const snap = JSON.parse(readFileSync(path, "utf8"));
    expect(snap.nodes).toHaveLength(1);
    expect(s.buildCount).toBe(1);
  });

  test("single-flight: schedule() during in-flight build chains exactly one more, second build starts after first ends", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let resolveFirstStarted!: () => void;
    const firstStarted = new Promise<void>((r) => {
      resolveFirstStarted = r;
    });
    let firstEndedAt = 0;
    let secondStartedAt = 0;
    let calls = 0;
    const writer = async () => {
      calls += 1;
      const idx = calls;
      if (idx === 1) {
        order.push("a-start");
        resolveFirstStarted();
        await new Promise<void>((r) => {
          releaseFirst = r;
        });
        firstEndedAt = performance.now();
        order.push("a-end");
      } else {
        secondStartedAt = performance.now();
        order.push("b-start");
        await wait(5);
        order.push("b-end");
      }
    };

    const s = new SnapshotScheduler(db, vaultDir, { debounceMs: 5, writer });
    s.schedule();
    await firstStarted;
    // While the slow first build is in flight, schedule again.
    s.schedule();
    expect((s as unknown as { running: boolean }).running).toBe(true);
    expect((s as unknown as { pendingAfterCurrent: boolean }).pendingAfterCurrent).toBe(true);

    releaseFirst();
    // Wait long enough for chain (debounce + second build).
    await wait(60);

    expect(s.buildCount).toBe(2);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    expect(secondStartedAt).toBeGreaterThanOrEqual(firstEndedAt);
  });

  test("disables after N consecutive failures and stops chaining", async () => {
    let attempts = 0;
    const writer = () => {
      attempts += 1;
      throw new Error("boom");
    };

    const s = new SnapshotScheduler(db, vaultDir, {
      debounceMs: 1,
      writer,
      maxConsecutiveFailures: 5,
    });

    for (let i = 0; i < 5; i += 1) {
      await s.flushNow();
    }
    expect(attempts).toBe(5);
    expect(s.disabled).toBe(true);
    expect(s.lastError).toBeInstanceOf(Error);
    expect(s.lastError?.message).toBe("boom");

    // schedule() must be a no-op once disabled
    s.schedule();
    await wait(20);
    expect(attempts).toBe(5);

    // flushNow re-enables and tries once more
    await s.flushNow();
    expect(attempts).toBe(6);
  });

  test("flushNow() builds synchronously and clears any pending debounce", async () => {
    const s = new SnapshotScheduler(db, vaultDir, { debounceMs: 10_000 });
    s.schedule();
    await s.flushNow();
    const path = join(vaultDir, ".scrypt", "graph.json");
    expect(existsSync(path)).toBe(true);
    expect(s.buildCount).toBe(1);
  });
});
