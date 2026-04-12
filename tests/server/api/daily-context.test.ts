import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "Research sources",
    content: "Prefer Reddit, HN, arxiv.",
    frontmatter: { active: true, category: "preference", priority: 3 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Open research question",
    content: "# Thread",
    frontmatter: { status: "open", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "journal",
    title: "t",
    content: "Today's morning thought",
  });
  await env.writeNote(
    "notes/recent.md",
    "---\ntitle: Recent\ntags: [fresh]\n---\n\n# Recent\n\nJust written.",
  );
  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/daily_context", () => {
  test("returns the five top-level keys", async () => {
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

  test("open_threads includes the seeded open thread", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(
      data.open_threads.some(
        (t: any) => t.slug === "open-research-question",
      ),
    ).toBe(true);
  });

  test("active_memories includes the seeded memory", async () => {
    const res = await fetch(`${env.baseUrl}/api/daily_context`);
    const data = await res.json();
    expect(
      data.active_memories.some((m: any) => m.slug === "research-sources"),
    ).toBe(true);
  });
});
