// tests/server/indexer.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../src/server/db";
import { FileManager } from "../../src/server/file-manager";
import { Indexer } from "../../src/server/indexer";
import type { Database } from "bun:sqlite";

let vaultPath: string;
let db: Database;
let fm: FileManager;
let indexer: Indexer;

beforeEach(async () => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-idx-test-"));
  mkdirSync(join(vaultPath, ".scrypt", "trash"), { recursive: true });
  mkdirSync(join(vaultPath, "notes"), { recursive: true });

  db = createDatabase(join(vaultPath, ".scrypt", "test.db"));
  initSchema(db);
  fm = new FileManager(vaultPath, join(vaultPath, ".scrypt"));
  indexer = new Indexer(db, fm);
});

afterEach(() => {
  fm.stopWatching();
  db.close();
  rmSync(vaultPath, { recursive: true, force: true });
});

async function writeTestNote(path: string, content: string) {
  const fullPath = join(vaultPath, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  await Bun.write(fullPath, content);
}

describe("reindexNote", () => {
  test("inserts note record with path, title, content_hash", async () => {
    await writeTestNote("notes/a.md", "---\ntitle: Alpha\n---\nContent.");
    await indexer.reindexNote("notes/a.md");

    const row = db.query("SELECT * FROM notes WHERE path = ?").get("notes/a.md") as any;
    expect(row).toBeDefined();
    expect(row.title).toBe("Alpha");
    expect(row.content_hash).toBeTruthy();
  });

  test("updates existing note when content_hash changes", async () => {
    await writeTestNote("notes/b.md", "---\ntitle: Beta\n---\nV1.");
    await indexer.reindexNote("notes/b.md");

    await writeTestNote("notes/b.md", "---\ntitle: Beta Updated\n---\nV2.");
    await indexer.reindexNote("notes/b.md");

    const row = db.query("SELECT * FROM notes WHERE path = ?").get("notes/b.md") as any;
    expect(row.title).toBe("Beta Updated");
  });

  test("skips update when content_hash matches", async () => {
    await writeTestNote("notes/c.md", "---\ntitle: Gamma\n---\nSame.");
    await indexer.reindexNote("notes/c.md");
    const hash1 = (db.query("SELECT content_hash FROM notes WHERE path = ?").get("notes/c.md") as any).content_hash;

    await indexer.reindexNote("notes/c.md");
    const hash2 = (db.query("SELECT content_hash FROM notes WHERE path = ?").get("notes/c.md") as any).content_hash;

    expect(hash1).toBe(hash2);
  });

  test("extracts wiki-links and inserts backlinks", async () => {
    await writeTestNote("notes/source.md", "---\ntitle: Source\n---\nSee [[target]].");
    await writeTestNote("notes/target.md", "---\ntitle: Target\n---\nTarget note.");
    await indexer.reindexNote("notes/target.md");
    await indexer.reindexNote("notes/source.md");

    const backlinks = indexer.getBacklinks("notes/target.md");
    expect(backlinks.length).toBeGreaterThanOrEqual(1);
    expect(backlinks[0].sourcePath).toBe("notes/source.md");
  });

  test("handles [[link|display text]] syntax", async () => {
    await writeTestNote("notes/fancy.md", "---\ntitle: Fancy\n---\nLink to [[target|Target Note]].");
    await writeTestNote("notes/target.md", "---\ntitle: Target\n---\nTarget.");
    await indexer.reindexNote("notes/target.md");
    await indexer.reindexNote("notes/fancy.md");

    const edges = db.query("SELECT * FROM graph_edges WHERE tier = 'connected'").all();
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  test("extracts inline #tags and frontmatter tags", async () => {
    await writeTestNote("notes/tagged.md", "---\ntitle: Tagged\ntags: [project]\n---\nInline #active tag.");
    await indexer.reindexNote("notes/tagged.md");

    const tags = db.query("SELECT tag FROM tags WHERE note_id = (SELECT id FROM notes WHERE path = ?)").all("notes/tagged.md") as { tag: string }[];
    const tagNames = tags.map((t) => t.tag);
    expect(tagNames).toContain("project");
    expect(tagNames).toContain("active");
  });

  test("creates graph_edges for links", async () => {
    await writeTestNote("notes/g1.md", "---\ntitle: G1\n---\nLink to [[g2]].");
    await writeTestNote("notes/g2.md", "---\ntitle: G2\n---\nTarget.");
    await indexer.reindexNote("notes/g2.md");
    await indexer.reindexNote("notes/g1.md");

    const edges = db
      .query("SELECT * FROM graph_edges WHERE tier = 'connected'")
      .all() as any[];
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].source).toBe("notes/g1.md");
    expect(edges[0].target).toBe("notes/g2.md");
  });

  // Wave 9: legacy checkbox-task extraction is dead. Task creation now goes
  // through MCP create_task; covered in tests/server/mcp/tools/tasks-crud.test.ts.
});

describe("removeNote", () => {
  test("cleans up all related records", async () => {
    await writeTestNote("notes/rm.md", "---\ntitle: Remove\ntags: [test]\n---\n- [ ] Task\nLink [[other]].");
    await indexer.reindexNote("notes/rm.md");

    const noteId = (db.query("SELECT id FROM notes WHERE path = ?").get("notes/rm.md") as any).id;
    await indexer.removeNote("notes/rm.md");

    expect(db.query("SELECT * FROM notes WHERE id = ?").get(noteId)).toBeNull();
    expect(db.query("SELECT * FROM tags WHERE note_id = ?").all(noteId)).toHaveLength(0);
    // Wave 9: tasks no longer foreign-key to notes via note_id; cleanup is
    // not coupled to note removal. New tasks schema is decoupled from notes.
  });
});

describe("fullReindex", () => {
  test("processes all .md files and builds complete index", async () => {
    await writeTestNote("notes/f1.md", "---\ntitle: F1\n---\nFirst.");
    await writeTestNote("notes/f2.md", "---\ntitle: F2\n---\nSecond.");
    await indexer.fullReindex();

    const count = (db.query("SELECT count(*) as c FROM notes").get() as any).c;
    expect(count).toBe(2);
  });

  test("removes stale records for deleted files", async () => {
    await writeTestNote("notes/stale.md", "---\ntitle: Stale\n---\nOld.");
    await indexer.fullReindex();

    rmSync(join(vaultPath, "notes/stale.md"));
    await indexer.fullReindex();

    const count = (db.query("SELECT count(*) as c FROM notes").get() as any).c;
    expect(count).toBe(0);
  });
});

describe("search", () => {
  test("FTS5 search returns ranked results matching query", async () => {
    await writeTestNote("notes/s1.md", "---\ntitle: SQLite Guide\n---\nLearn about SQLite databases.");
    await writeTestNote("notes/s2.md", "---\ntitle: React Guide\n---\nLearn about React components.");
    await indexer.fullReindex();

    const results = indexer.search("SQLite");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("SQLite Guide");
  });

  test("FTS5 search supports prefix matching", async () => {
    await writeTestNote("notes/pre.md", "---\ntitle: Architecture\n---\nArchitectural decisions.");
    await indexer.fullReindex();

    const results = indexer.search("arch*");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getBacklinks", () => {
  test("returns notes linking to target with context snippet", async () => {
    await writeTestNote("notes/ref.md", "---\ntitle: Referrer\n---\nPlease see [[target-note]] for more.");
    await writeTestNote("notes/target-note.md", "---\ntitle: Target Note\n---\nTarget content.");
    await indexer.fullReindex();

    const backlinks = indexer.getBacklinks("notes/target-note.md");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourcePath).toBe("notes/ref.md");
    expect(backlinks[0].context).toContain("target-note");
  });
});

describe("getGraph", () => {
  test("returns all nodes and edges", async () => {
    await writeTestNote("notes/n1.md", "---\ntitle: N1\n---\nLink to [[n2]].");
    await writeTestNote("notes/n2.md", "---\ntitle: N2\n---\nStandalone.");
    await indexer.fullReindex();

    const graph = indexer.getGraph();
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getLocalGraph", () => {
  test("returns nodes within N hops", async () => {
    await writeTestNote("notes/center.md", "---\ntitle: Center\n---\nLink to [[hop1]].");
    await writeTestNote("notes/hop1.md", "---\ntitle: Hop1\n---\nLink to [[hop2]].");
    await writeTestNote("notes/hop2.md", "---\ntitle: Hop2\n---\nEnd.");
    await writeTestNote("notes/isolated.md", "---\ntitle: Isolated\n---\nNo links.");
    await indexer.fullReindex();

    const local = indexer.getLocalGraph("notes/center.md", 1);
    const paths = local.nodes.map((n) => n.path);
    expect(paths).toContain("notes/center.md");
    expect(paths).toContain("notes/hop1.md");
    expect(paths).not.toContain("notes/isolated.md");
  });
});

describe("getTags", () => {
  test("returns all tags with note counts", async () => {
    await writeTestNote("notes/t1.md", "---\ntitle: T1\ntags: [alpha]\n---\nContent.");
    await writeTestNote("notes/t2.md", "---\ntitle: T2\ntags: [alpha, beta]\n---\nContent.");
    await indexer.fullReindex();

    const tags = indexer.getTags();
    const alpha = tags.find((t) => t.tag === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.count).toBe(2);
  });
});

// Wave 9: legacy Indexer.getTasks() removed. Task listing now goes through
// MCP list_tasks; covered in tests/server/mcp/tools/tasks-crud.test.ts.

describe("link_index population", () => {
  test("each note produces three rows: basename, full path, title slug", async () => {
    mkdirSync(join(vaultPath, "notes/inbox"), { recursive: true });
    await writeTestNote(
      "notes/inbox/foo-bar.md",
      "---\ntitle: Foo Bar Note\n---\n\nbody",
    );
    await indexer.fullReindex();

    const rows = db
      .query("SELECT slug, path, title FROM link_index ORDER BY slug")
      .all() as any[];
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain("foo-bar");
    expect(slugs).toContain("notes/inbox/foo-bar");
    expect(slugs).toContain("foo-bar-note");
    expect(rows.every((r) => r.path === "notes/inbox/foo-bar.md")).toBe(true);
  });

  test("deleting a note clears its link_index rows", async () => {
    await writeTestNote("notes/a.md", "---\ntitle: A\n---\nbody");
    await indexer.fullReindex();
    expect(
      (db.query("SELECT COUNT(*) as c FROM link_index").get() as any).c,
    ).toBeGreaterThan(0);

    await indexer.removeNote("notes/a.md");

    expect(
      (db.query("SELECT COUNT(*) as c FROM link_index WHERE path = 'notes/a.md'").get() as any).c,
    ).toBe(0);
  });

  test("resolves [[basename]] wiki-links across folders", async () => {
    mkdirSync(join(vaultPath, "notes/inbox"), { recursive: true });
    mkdirSync(join(vaultPath, "dnd/research"), { recursive: true });
    await writeTestNote(
      "notes/inbox/source.md",
      "---\ntitle: Source\n---\nSee [[target-note]] for details.",
    );
    await writeTestNote(
      "dnd/research/target-note.md",
      "---\ntitle: Target Note\n---\nbody",
    );
    await indexer.fullReindex();

    const edge = db
      .query(
        "SELECT source, target FROM graph_edges WHERE source = ? AND target = ? AND tier = 'connected'",
      )
      .get("notes/inbox/source.md", "dnd/research/target-note.md") as any;
    expect(edge).toBeTruthy();
    expect(edge.source).toBe("notes/inbox/source.md");
    expect(edge.target).toBe("dnd/research/target-note.md");
  });
});
