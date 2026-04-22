import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import {
  buildGraphSnapshot,
  writeGraphSnapshot,
} from "../../../src/server/graph/snapshot";
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('a.md','b.md','connected', 0),
      ('a.md','c.md','mentions', 0)`);
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

  test("emits edges with source/target/tier/reason", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md'),('b.md','note','B','b.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,reason,created_at) VALUES
      ('a.md','b.md','connected','does the thing',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toEqual([
      {
        source: "a.md",
        target: "b.md",
        tier: "connected",
        reason: "does the thing",
      },
    ]);
  });

  test("skips non-note nodes and dangling edges", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES ('a.md','ghost.md','connected',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.edges).toHaveLength(0);
  });

  test("keeps cross-project explicit edges but drops cross-project semantic edges", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/dnd/a.md','note','A','research/dnd/a.md'),
      ('research/dnd/b.md','note','B','research/dnd/b.md'),
      ('research/goveva/c.md','note','C','research/goveva/c.md'),
      ('research/goveva/d.md','note','D','research/goveva/d.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('research/dnd/a.md','research/goveva/c.md','mentions',0),
      ('research/dnd/a.md','research/goveva/d.md','semantically_related',0),
      ('research/dnd/a.md','research/dnd/b.md','semantically_related',0)`);

    const snap = buildGraphSnapshot(db);
    const pairs = snap.edges.map((e) => `${e.source}->${e.target}:${e.tier}`).sort();
    expect(pairs).toEqual([
      "research/dnd/a.md->research/dnd/b.md:semantically_related",
      "research/dnd/a.md->research/goveva/c.md:mentions",
    ]);
  });

  test("sets generated_at to a number close to now", () => {
    const snap = buildGraphSnapshot(db);
    expect(Math.abs(Date.now() - snap.generated_at)).toBeLessThan(2000);
  });
});

describe("buildGraphSnapshot anti-connection rules (G3)", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  test("plan↔plan edges are dropped regardless of tier", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/p/a.md','note','A','research/p/a.md'),
      ('research/p/b.md','note','B','research/p/b.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('research/p/a.md','research/p/b.md','connected',0)`);
    db.run(`INSERT INTO note_metadata (note_path,doc_type,updated_at) VALUES
      ('research/p/a.md','plan',0),
      ('research/p/b.md','plan',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toEqual([]);
  });

  test("journal source caps tier at 'mentions'", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/p/j.md','note','J','research/p/j.md'),
      ('research/p/n.md','note','N','research/p/n.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,reason,created_at) VALUES
      ('research/p/j.md','research/p/n.md','connected','x',0)`);
    db.run(`INSERT INTO note_metadata (note_path,doc_type,updated_at) VALUES
      ('research/p/j.md','journal',0),
      ('research/p/n.md','research',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].tier).toBe("mentions");
  });

  test("changelog target caps tier at 'mentions'", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/p/n.md','note','N','research/p/n.md'),
      ('research/p/c.md','note','C','research/p/c.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,reason,created_at) VALUES
      ('research/p/n.md','research/p/c.md','connected','y',0)`);
    db.run(`INSERT INTO note_metadata (note_path,doc_type,updated_at) VALUES
      ('research/p/n.md','research',0),
      ('research/p/c.md','changelog',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].tier).toBe("mentions");
  });

  test("regression: cross-project semantic still dropped", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/x/a.md','note','A','research/x/a.md'),
      ('research/y/b.md','note','B','research/y/b.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('research/x/a.md','research/y/b.md','semantically_related',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toEqual([]);
  });

  test("regression: same-project semantic preserved", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/x/a.md','note','A','research/x/a.md'),
      ('research/x/b.md','note','B','research/x/b.md')`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('research/x/a.md','research/x/b.md','semantically_related',0)`);
    const snap = buildGraphSnapshot(db);
    expect(snap.edges).toHaveLength(1);
    expect(snap.edges[0].tier).toBe("semantically_related");
  });

  test("end-to-end: only rule-compliant edges survive a mixed insert batch", () => {
    db.run(`INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('research/p/plan1.md','note','P1','research/p/plan1.md'),
      ('research/p/plan2.md','note','P2','research/p/plan2.md'),
      ('research/p/journal.md','note','J','research/p/journal.md'),
      ('research/p/regular.md','note','R','research/p/regular.md'),
      ('research/p/other.md','note','O','research/p/other.md'),
      ('research/q/elsewhere.md','note','E','research/q/elsewhere.md')`);
    db.run(`INSERT INTO note_metadata (note_path,doc_type,updated_at) VALUES
      ('research/p/plan1.md','plan',0),
      ('research/p/plan2.md','plan',0),
      ('research/p/journal.md','journal',0),
      ('research/p/regular.md','research',0),
      ('research/p/other.md','research',0),
      ('research/q/elsewhere.md','research',0)`);
    db.run(`INSERT INTO graph_edges (source,target,tier,created_at) VALUES
      ('research/p/plan1.md','research/p/plan2.md','connected',0),
      ('research/p/journal.md','research/p/regular.md','connected',0),
      ('research/p/regular.md','research/p/other.md','connected',0),
      ('research/p/regular.md','research/p/other.md','semantically_related',0),
      ('research/p/regular.md','research/q/elsewhere.md','semantically_related',0)`);
    const snap = buildGraphSnapshot(db);
    const summary = snap.edges
      .map((e) => `${e.source}->${e.target}:${e.tier}`)
      .sort();
    expect(summary).toEqual([
      "research/p/journal.md->research/p/regular.md:mentions",
      "research/p/regular.md->research/p/other.md:connected",
      "research/p/regular.md->research/p/other.md:semantically_related",
    ]);
  });
});

describe("writeGraphSnapshot atomicity", () => {
  let db: Database;
  let vaultDir: string;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.run(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES ('a.md','note','A','a.md')`,
    );
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-write-"));
  });

  test("writes a complete graph.json and leaves no .tmp behind on success", () => {
    writeGraphSnapshot(db, vaultDir);
    const dir = join(vaultDir, ".scrypt");
    const files = readdirSync(dir);
    expect(files).toContain("graph.json");
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    const snap = JSON.parse(readFileSync(join(dir, "graph.json"), "utf8"));
    expect(snap.nodes).toHaveLength(1);
  });

  test("on rename failure: removes orphan .tmp and leaves prior graph.json intact", () => {
    // Make graph.json a directory so renameSync(tmpPath, finalPath) fails with
    // EISDIR/ENOTEMPTY/EEXIST depending on platform — exercises the cleanup
    // path without monkey-patching fs (snapshot.ts uses destructured imports).
    const dir = join(vaultDir, ".scrypt");
    mkdirSync(dir, { recursive: true });
    const finalPath = join(dir, "graph.json");
    mkdirSync(finalPath); // a directory at the final path
    // Drop a sentinel inside so we can prove the directory wasn't replaced.
    writeFileSync(join(finalPath, "sentinel"), "x", "utf8");

    expect(() => writeGraphSnapshot(db, vaultDir)).toThrow();

    const files = readdirSync(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    // The directory at finalPath must still exist with its sentinel.
    expect(fs.statSync(finalPath).isDirectory()).toBe(true);
    expect(readFileSync(join(finalPath, "sentinel"), "utf8")).toBe("x");
  });
});
