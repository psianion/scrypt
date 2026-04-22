// tests/server/indexer/clustering.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { runLouvain } from "../../../src/server/indexer/clustering";

describe("runLouvain", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  test("assigns community ids to clustered nodes", () => {
    const nodes = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const insertNode = db.prepare(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
    );
    for (const n of nodes) insertNode.run(n, n, n);
    const insertEdge = db.prepare(
      `INSERT INTO graph_edges (source, target, tier) VALUES (?, ?, 'connected')`,
    );
    for (const [s, t] of [
      ["a1", "a2"],
      ["a2", "a3"],
      ["a3", "a1"],
      ["b1", "b2"],
      ["b2", "b3"],
      ["b3", "b1"],
      ["a1", "b1"],
    ]) {
      insertEdge.run(s, t);
    }

    const result = runLouvain(db);
    expect(result.communities).toBeGreaterThanOrEqual(2);

    const rows = db
      .query<{ id: string; community_id: number }, []>(
        `SELECT id, community_id FROM graph_nodes`,
      )
      .all();
    const communityOf = (id: string) =>
      rows.find((r) => r.id === id)?.community_id;
    expect(communityOf("a1")).toBe(communityOf("a2"));
    expect(communityOf("b1")).toBe(communityOf("b2"));
    expect(communityOf("a1")).not.toBe(communityOf("b1"));
  });

  test("handles isolated nodes gracefully", () => {
    db.query(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('solo', 'note', 'solo', 'solo')`,
    ).run();
    const r = runLouvain(db);
    expect(r.communities).toBeGreaterThanOrEqual(0);
  });
});
