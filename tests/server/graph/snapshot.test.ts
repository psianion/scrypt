import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { buildGraphSnapshot } from "../../../src/server/graph/snapshot";

describe("buildGraphSnapshot", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  test("emits nodes with id, title, doc_type, degree, community", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path, community_id) VALUES
      ('a.md','note','A','a.md',1),
      ('b.md','note','B','b.md',1),
      ('c.md','note','C','c.md',2)`);
    db.run(`INSERT INTO graph_edges (source,target,relation,confidence,created_at) VALUES
      ('a.md','b.md','elaborates','connected', 0),
      ('a.md','c.md','references','mentions', 0)`);
    db.run(`INSERT INTO note_metadata (note_path,doc_type,summary,updated_at) VALUES
      ('a.md','research','sum',0),
      ('b.md','spec','sum',0)`);

    const snap = buildGraphSnapshot(db);
    expect(snap.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md", "c.md"]);
    const a = snap.nodes.find((n) => n.id === "a.md")!;
    expect(a.title).toBe("A");
    expect(a.doc_type).toBe("research");
    expect(a.degree).toBe(2);
    expect(a.community).toBe(1);
    const c = snap.nodes.find((n) => n.id === "c.md")!;
    expect(c.doc_type).toBeNull();
  });

  test("emits edges with source/target/relation/confidence/reason", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md'),('b.md','note','B','b.md')`);
    db.run(`INSERT INTO graph_edges (source,target,relation,confidence,reason,created_at) VALUES
      ('a.md','b.md','implements','connected','does the thing',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toEqual([
      {
        source: "a.md",
        target: "b.md",
        relation: "implements",
        confidence: "connected",
        reason: "does the thing",
      },
    ]);
  });

  test("skips non-note nodes and dangling edges", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`);
    db.run(`INSERT INTO graph_edges (source,target,relation,confidence,created_at) VALUES ('a.md','ghost.md','x','connected',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.edges).toHaveLength(0);
  });

  test("sets generated_at to a number close to now", () => {
    const snap = buildGraphSnapshot(db);
    expect(Math.abs(Date.now() - snap.generated_at)).toBeLessThan(2000);
  });
});
