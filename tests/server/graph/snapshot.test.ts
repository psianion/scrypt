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
