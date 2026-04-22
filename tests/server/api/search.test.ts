// tests/server/api/search.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  env = createTestEnv();
  await env.writeNote("notes/react.md", "---\ntitle: React Guide\ntags: [frontend]\n---\nLearn about React components and hooks.");
  await env.writeNote("notes/sqlite.md", "---\ntitle: SQLite Guide\ntags: [backend]\n---\nLearn about SQLite databases and FTS5.");
  await env.writeNote("notes/linked.md", "---\ntitle: Linked\n---\nSee [[react]] and [[sqlite]].");
  // Wait for indexer
  await Bun.sleep(500);
  await env.app.indexer.fullReindex();
});

afterAll(() => env.cleanup());

describe("GET /api/search", () => {
  test("returns ranked FTS5 results with snippets", async () => {
    const res = await fetch(`${env.baseUrl}/api/search?q=SQLite`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty("snippet");
    expect(data[0].title).toBe("SQLite Guide");
  });

  test("returns empty array for no matches", async () => {
    const res = await fetch(`${env.baseUrl}/api/search?q=zzzznonexistent`);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("GET /api/search/tags", () => {
  test("returns matching tags with counts", async () => {
    const res = await fetch(`${env.baseUrl}/api/search/tags?q=front`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((t: any) => t.tag === "frontend")).toBe(true);
  });
});

describe("GET /api/graph", () => {
  test("returns nodes and edges for all notes", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("edges");
    expect(data.nodes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("GET /api/graph/*path", () => {
  test("returns local graph with depth parameter", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph/notes/linked.md?depth=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/backlinks/*path", () => {
  // graph-v2 (G2): wikilink edge production removed; the backlinks table is
  // no longer populated from prose [[…]]. Endpoint stays for API stability
  // but always returns [] now.
  test("returns array (empty after graph-v2)", async () => {
    const res = await fetch(`${env.baseUrl}/api/backlinks/notes/react.md`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});
