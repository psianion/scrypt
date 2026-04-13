// tests/server/api/graph.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ready;

  // Two notes in dnd/research — subdomain edge
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "A",
    content: "See [[b-note]].",
    frontmatter: {
      domain: "dnd",
      subdomain: "research",
      tags: ["type:research", "project:longrest"],
    },
  });
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "B Note",
    content: "body",
    frontmatter: {
      domain: "dnd",
      subdomain: "research",
      tags: ["type:research", "architecture"],
    },
  });
  // Third note in dnd/plans — domain edge only
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "C Plan",
    content: "body",
    frontmatter: {
      domain: "dnd",
      subdomain: "plans",
      tags: ["type:plan"],
    },
  });
  // Fourth note in scrypt-dev — no edges to the others
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "D Scrypt",
    content: "body",
    frontmatter: {
      domain: "scrypt-dev",
      subdomain: "specs",
      tags: ["type:spec"],
    },
  });

  // Force a deterministic reindex — ingest writes files but relies on the
  // file watcher to populate the DB, which is racy inside a single test run.
  await env.app.indexer.fullReindex();
});

afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/graph", () => {
  test("returns nodes for every non-reserved note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const paths = data.nodes.map((n: any) => n.path);
    expect(paths).toContain("dnd/research/a.md");
    expect(paths).toContain("dnd/research/b-note.md");
    expect(paths).toContain("dnd/plans/c-plan.md");
    expect(paths).toContain("scrypt-dev/specs/d-scrypt.md");
  });

  test("generates wikilink edge from [[b-note]] in A to B Note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const wikilinks = data.edges.filter((e: any) => e.type === "wikilink");
    expect(wikilinks.length).toBe(1);
  });

  test("generates subdomain edge between A and B (both dnd/research)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const subdomainEdges = data.edges.filter(
      (e: any) => e.type === "subdomain",
    );
    expect(subdomainEdges.length).toBe(1);
    expect(subdomainEdges[0].weight).toBe(2);
  });

  test("generates domain edges between dnd/research notes and dnd/plans note", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const domainEdges = data.edges.filter((e: any) => e.type === "domain");
    expect(domainEdges.length).toBe(2);
    expect(domainEdges.every((e: any) => e.weight === 1)).toBe(true);
  });

  test("generates namespaced-tag edges on type:research only (A↔B)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const tagEdges = data.edges.filter((e: any) => e.type === "tag");
    expect(tagEdges.length).toBe(1);
    expect(tagEdges[0].weight).toBe(1.5);
  });

  test("flat topic tags do NOT create server-side edges", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    const tagEdges = data.edges.filter((e: any) => e.type === "tag");
    expect(tagEdges.length).toBe(1);
  });

  test("undirected edges deduplicated (no source>target pairs)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    for (const e of data.edges.filter((e: any) => e.type !== "wikilink")) {
      expect(e.source).toBeLessThan(e.target);
    }
  });

  test("connectionCount on each node is total edges touching it", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    const data = await res.json();
    for (const node of data.nodes) {
      const touching = data.edges.filter(
        (e: any) => e.source === node.id || e.target === node.id,
      );
      expect(node.connectionCount).toBe(touching.length);
    }
  });
});

describe("GET /api/graph auth", () => {
  test("route responds (auth gate covered separately)", async () => {
    const res = await fetch(`${env.baseUrl}/api/graph`);
    expect([200, 401]).toContain(res.status);
  });
});
