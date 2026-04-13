import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();

  await env.app.ingestRouter.ingest({
    kind: "journal",
    title: "t",
    content: "Today's morning thought",
  });

  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "open a",
    content: "# a",
    frontmatter: { status: "open", priority: 2, last_run: "2026-04-01T00:00:00Z" },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "open b",
    content: "# b",
    frontmatter: { status: "open", priority: 2, last_run: "2026-04-10T00:00:00Z" },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "in progress c",
    content: "# c",
    frontmatter: { status: "in-progress", priority: 3 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "resolved d",
    content: "# d",
    frontmatter: {
      status: "resolved",
      priority: 3,
      last_run: "2026-04-11T00:00:00Z",
    },
  });

  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "active m1",
    content: "alive",
    frontmatter: { active: true, category: "interest", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "inactive m2",
    content: "dormant",
    frontmatter: { active: false, category: "interest", priority: 2 },
  });

  await env.writeNote(
    "notes/recent.md",
    "---\ntitle: Recent\ntags: [fresh]\nmodified: " +
      new Date().toISOString() +
      "\n---\n\n# Recent\n\nJust written.",
  );

  const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await env.writeNote(
    "notes/stale.md",
    `---\ntitle: Stale\ntags: [old]\nmodified: ${stale}\n---\n\n# Stale\n\nOld.`,
  );

  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/daily_context", () => {
  test("returns the six top-level keys", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("generated_at");
    expect(data).toHaveProperty("today");
    expect(data).toHaveProperty("recent_notes");
    expect(data).toHaveProperty("open_threads");
    expect(data).toHaveProperty("active_memories");
    expect(data).toHaveProperty("tag_cloud");
  });

  test("today.journal contains today's entry", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(data.today.journal.exists).toBe(true);
    expect(data.today.journal.content).toContain("morning thought");
  });

  test("open_threads excludes resolved threads", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const slugs = data.open_threads.map((t: any) => t.slug);
    expect(slugs).toContain("in-progress-c");
    expect(slugs).toContain("open-a");
    expect(slugs).toContain("open-b");
    expect(slugs).not.toContain("resolved-d");
  });

  test("open_threads sort: priority DESC then last_run ASC", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const slugs: string[] = data.open_threads.map((t: any) => t.slug);
    const pIdx = {
      c: slugs.indexOf("in-progress-c"),
      a: slugs.indexOf("open-a"),
      b: slugs.indexOf("open-b"),
    };
    expect(pIdx.c).toBeGreaterThanOrEqual(0);
    expect(pIdx.a).toBeGreaterThanOrEqual(0);
    expect(pIdx.b).toBeGreaterThanOrEqual(0);
    expect(pIdx.c).toBeLessThan(pIdx.a);
    expect(pIdx.a).toBeLessThan(pIdx.b);
  });

  test("active_memories excludes inactive entries", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const slugs = data.active_memories.map((m: any) => m.slug);
    expect(slugs).toContain("active-m1");
    expect(slugs).not.toContain("inactive-m2");
  });

  test("recent_notes contains recent.md and excludes stale.md", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const paths = data.recent_notes.map((n: any) => n.path);
    expect(paths).toContain("notes/recent.md");
    expect(paths).not.toContain("notes/stale.md");
  });

  test("recent_notes is capped at 20", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(data.recent_notes.length).toBeLessThanOrEqual(20);
  });
});

describe("GET /api/daily_context > related", () => {
  test("related bundle is present on response", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(data.related).toBeDefined();
    expect(data.related.notes).toBeDefined();
    expect(data.related.memories).toBeDefined();
    expect(data.related.draft_prompts).toBeDefined();
  });

  test("related.notes contains recent domain-matching notes", async () => {
    // Rewrite today's journal so it carries a domain + tag.
    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(today.getUTCDate()).padStart(2, "0");
    await env.writeNote(
      `journal/${yyyy}-${mm}-${dd}.md`,
      "---\ndomain: dnd\ntags: [architecture]\n---\n# Today",
    );
    await env.writeNote(
      "dnd/research/fresh.md",
      `---\ntitle: Fresh\ndomain: dnd\nsubdomain: research\nmodified: ${new Date().toISOString()}\n---\nbody`,
    );
    await env.app.indexer.fullReindex();

    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const paths = data.related.notes.map((n: any) => n.path);
    expect(paths).toContain("dnd/research/fresh.md");
  });

  test("related.draft_prompts lists stage:draft notes oldest first", async () => {
    await env.writeNote(
      "dnd/research/draft-a.md",
      "---\ntitle: Draft A\ndomain: dnd\ntags: [stage:draft]\ncreated: 2026-03-01T00:00:00Z\n---\nbody",
    );
    await env.writeNote(
      "dnd/research/draft-b.md",
      "---\ntitle: Draft B\ndomain: dnd\ntags: [stage:draft]\ncreated: 2026-04-01T00:00:00Z\n---\nbody",
    );
    await env.app.indexer.fullReindex();

    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const drafts = data.related.draft_prompts;
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    const draftPaths = drafts.map((d: any) => d.path);
    const idxA = draftPaths.indexOf("dnd/research/draft-a.md");
    const idxB = draftPaths.indexOf("dnd/research/draft-b.md");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });

  test("related.memories overlap with today's tags", async () => {
    await env.writeNote(
      "memory/arch-interest.md",
      "---\ntitle: Architecture\nkind: memory\nactive: true\ntags: [architecture]\n---\nbody",
    );
    await env.app.indexer.fullReindex();

    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    const mems = data.related.memories.map((m: any) => m.path);
    expect(mems).toContain("memory/arch-interest.md");
  });
});
