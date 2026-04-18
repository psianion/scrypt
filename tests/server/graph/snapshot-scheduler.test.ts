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

  test("single-flight: if a rebuild runs when another schedule() arrives, chain one more", async () => {
    const slowDb = db;
    const s = new SnapshotScheduler(slowDb, vaultDir, { debounceMs: 10 });
    s.schedule();
    await wait(30); // first build starts
    s.schedule();
    await wait(80);
    expect(s.buildCount).toBe(2);
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
