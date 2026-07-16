// tests/server/api/hybrid-search-endpoint.test.ts
//
// S8: GET /api/search/hybrid wired through Router (FTS-only path — no
// engine/embeddings passed, mirroring SCRYPT_EMBED_DISABLE=1 runtime).
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { searchRoutes } from "../../../src/server/api/search";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";
import { Router } from "../../../src/server/router";
import type { Indexer } from "../../../src/server/indexer";

interface Hit {
  path: string;
  title: string;
  project: string | null;
  doc_type: string | null;
  description: string | null;
  excerpt: string;
  score: number;
  fts_rank: number | null;
  sem_rank: number | null;
}

function seedNote(
  db: Database,
  path: string,
  title: string,
  body: string,
  project: string | null = null,
): void {
  db.query(
    `INSERT INTO notes (path, title, content_hash, project) VALUES (?, ?, 'h', ?)`,
  ).run(path, title, project);
  const id = Number(
    (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
  db.query(
    `INSERT INTO notes_fts (rowid, title, content, path, summary, entities, themes, edge_reasons)
     VALUES (?, ?, ?, ?, '', '', '', '')`,
  ).run(id, title, body, path);
}

const stubIndexer = { search: () => [], getTags: () => [] } as unknown as Indexer;

describe("GET /api/search/hybrid", () => {
  let db: Database;
  let router: Router;
  let metadata: MetadataRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    metadata = new MetadataRepo(db);
    router = new Router();
    searchRoutes(router, stubIndexer, db, metadata);
  });

  async function get(qs: string): Promise<{ query: string; hits: Hit[] }> {
    const res = await router.handle(
      new Request(`http://x/api/search/hybrid${qs}`),
    );
    if (!res) throw new Error("no response");
    expect(res.status).toBe(200);
    return res.json() as Promise<{ query: string; hits: Hit[] }>;
  }

  test("returns ranked hits with metadata for seeded notes", async () => {
    seedNote(db, "a.md", "Alpha", "alpha discusses zebras at length", "zoo");
    seedNote(db, "b.md", "Beta", "beta is about something else");
    metadata.upsert("a.md", {
      description: "All about zebras",
      doc_type: "research",
    });

    const body = await get("?q=zebras");
    expect(body.query).toBe("zebras");
    expect(body.hits.length).toBe(1);
    const top = body.hits[0]!;
    expect(top.path).toBe("a.md");
    expect(top.title).toBe("Alpha");
    expect(top.project).toBe("zoo");
    expect(top.doc_type).toBe("research");
    expect(top.description).toBe("All about zebras");
    expect(top.excerpt).toContain("zebras");
    expect(typeof top.score).toBe("number");
    expect(top.score).toBeGreaterThan(0);
    expect(top.fts_rank).toBe(1);
    expect(top.sem_rank).toBe(null);
  });

  test("null metadata fields when note has no note_metadata row", async () => {
    seedNote(db, "bare.md", "Bare", "bare note mentions quokka");
    const body = await get("?q=quokka");
    const top = body.hits[0]!;
    expect(top.description).toBe(null);
    expect(top.doc_type).toBe(null);
    expect(top.project).toBe(null);
  });

  test("empty q returns { query, hits: [] }", async () => {
    const body = await get("?q=");
    expect(body).toEqual({ query: "", hits: [] });
    const body2 = await get("");
    expect(body2).toEqual({ query: "", hits: [] });
  });

  test("default limit is 8 and cap is 25", async () => {
    for (let i = 0; i < 30; i++) {
      seedNote(db, `n${i}.md`, `Note ${i}`, "wombat wombat wombat");
    }
    const def = await get("?q=wombat");
    expect(def.hits.length).toBe(8);
    const capped = await get("?q=wombat&limit=100");
    expect(capped.hits.length).toBe(25);
    const small = await get("?q=wombat&limit=3");
    expect(small.hits.length).toBe(3);
  });

  test("excerpt is trimmed to ~200 chars of body", async () => {
    seedNote(db, "long.md", "Long", "axolotl " + "x".repeat(500));
    const body = await get("?q=axolotl");
    expect(body.hits[0]!.excerpt.length).toBeLessThanOrEqual(200);
    expect(body.hits[0]!.excerpt.startsWith("axolotl")).toBe(true);
  });

  test("malformed FTS query returns empty hits, not 500", async () => {
    seedNote(db, "a.md", "Alpha", "content");
    const body = await get(`?q=${encodeURIComponent('"unbalanced')}`);
    expect(body.hits).toEqual([]);
  });
});
