import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Research target",
    content: "# target",
    frontmatter: { status: "open", priority: 1 },
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("POST /api/research_runs", () => {
  test("creates run note + DB row + updates thread", async () => {
    const res = await fetch(`${env.baseUrl}/api/research_runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "First run",
        content: "## Summary\nFound three good articles\n\n## Findings\nlong",
        frontmatter: {
          thread: "research-target",
          status: "success",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 15000,
          model: "claude-opus-4-6",
          token_usage: { input: 500, output: 200 },
        },
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.path).toMatch(/^notes\/research\/\d{4}-\d{2}-\d{2}-\d{4}-first-run\.md$/);
    expect(data.side_effects.research_run_id).toBeGreaterThan(0);
    expect(data.side_effects.thread_updated).toBe(
      "notes/threads/research-target.md",
    );
  });
});

describe("GET /api/research_runs", () => {
  test("returns list of recent runs", async () => {
    const res = await fetch(`${env.baseUrl}/api/research_runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by thread", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/research_runs?thread=research-target`,
    );
    const data = await res.json();
    expect(data.every((r: any) => r.thread_slug === "research-target")).toBe(true);
  });

  test("filters by status", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/research_runs?status=success`,
    );
    const data = await res.json();
    expect(data.every((r: any) => r.status === "success")).toBe(true);
  });
});
