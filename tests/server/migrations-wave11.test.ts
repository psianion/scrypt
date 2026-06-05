import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave11Migration } from "../../src/server/migrations/wave11";

function baseGraphEdges(db: Database): void {
  // Mirrors the graph_edges CREATE in src/server/db.ts (pre-C4 shape).
  db.run(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('connected','mentions','semantically_related')),
      weight REAL,
      reason TEXT,
      client_tag TEXT,
      created_at INTEGER,
      UNIQUE (source, target, tier)
    )
  `);
}

function cols(db: Database): string[] {
  return (db.query("PRAGMA table_info(graph_edges)").all() as { name: string }[]).map(
    (c) => c.name,
  );
}

describe("wave11 migration", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    baseGraphEdges(db);
  });

  test("adds rel_type column to graph_edges", () => {
    expect(cols(db)).not.toContain("rel_type");
    applyWave11Migration(db);
    expect(cols(db)).toContain("rel_type");
  });

  test("is idempotent — second run does not throw or duplicate", () => {
    applyWave11Migration(db);
    applyWave11Migration(db);
    expect(cols(db).filter((c) => c === "rel_type").length).toBe(1);
  });

  test("preserves existing rows and leaves rel_type NULL on legacy edges", () => {
    db.run(
      `INSERT INTO graph_edges (source, target, tier, reason, client_tag, created_at)
       VALUES ('a.md', 'b.md', 'connected', 'reference', NULL, 1)`,
    );
    applyWave11Migration(db);
    const row = db
      .query<{ rel_type: string | null; reason: string | null }, []>(
        `SELECT rel_type, reason FROM graph_edges WHERE source = 'a.md'`,
      )
      .get();
    expect(row?.rel_type).toBeNull();
    expect(row?.reason).toBe("reference");
  });

  test("drops all legacy semantically_related rows, keeps the rest", () => {
    db.run(`INSERT INTO graph_edges (source, target, tier) VALUES ('a','b','semantically_related')`);
    db.run(`INSERT INTO graph_edges (source, target, tier) VALUES ('a','c','connected')`);
    db.run(`INSERT INTO graph_edges (source, target, tier) VALUES ('a','d','mentions')`);
    applyWave11Migration(db);
    const tiers = db
      .query<{ tier: string }, []>(`SELECT tier FROM graph_edges ORDER BY tier`)
      .all()
      .map((r) => r.tier);
    expect(tiers).toEqual(["connected", "mentions"]);
  });

  test("deletes semantically_related even when rel_type column already exists", () => {
    applyWave11Migration(db); // adds rel_type
    db.run(`INSERT INTO graph_edges (source, target, tier) VALUES ('x','y','semantically_related')`);
    db.run(`INSERT INTO graph_edges (source, target, tier) VALUES ('x','z','connected')`);
    applyWave11Migration(db); // ALTER skipped; DELETE must still fire
    const tiers = db.query<{ tier: string }, []>(`SELECT tier FROM graph_edges ORDER BY tier`).all().map((r) => r.tier);
    expect(tiers).toEqual(["connected"]);
  });

  test("no-ops when graph_edges does not exist", () => {
    const fresh = new Database(":memory:");
    expect(() => applyWave11Migration(fresh)).not.toThrow();
    fresh.close();
  });
});
