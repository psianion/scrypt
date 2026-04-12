import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestEnv } from "../../helpers";
import { parseFrontmatter } from "../../../src/server/parsers";

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

describe("POST /api/research_runs timestamp invariants", () => {
  test("ignores client-supplied created/modified on both run note and thread", async () => {
    await env.app.ingestRouter.ingest({
      kind: "thread",
      title: "ts bypass research",
      content: "# orig",
      frontmatter: { status: "open", priority: 1 },
    });
    const threadSlug = "ts-bypass-research";

    const res = await fetch(`${env.baseUrl}/api/research_runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "bypass attempt",
        content: "body",
        frontmatter: {
          thread: threadSlug,
          status: "success",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1000,
          model: "claude-opus-4-6",
          token_usage: { input: 10, output: 10 },
          created: "1999-01-01T00:00:00Z",
          modified: "1999-01-01T00:00:00Z",
        },
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();

    const runRaw = readFileSync(join(env.vaultPath, data.path), "utf-8");
    const runFm = parseFrontmatter(runRaw).frontmatter;
    expect(runFm.created).not.toBe("1999-01-01T00:00:00Z");
    expect(runFm.modified).not.toBe("1999-01-01T00:00:00Z");
    expect(new Date(runFm.created as string).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
    expect(new Date(runFm.modified as string).getUTCFullYear()).toBeGreaterThanOrEqual(2025);

    const threadRaw = readFileSync(
      join(env.vaultPath, `notes/threads/${threadSlug}.md`),
      "utf-8",
    );
    const threadFm = parseFrontmatter(threadRaw).frontmatter;
    expect(threadFm.modified).not.toBe("1999-01-01T00:00:00Z");
    expect(new Date(threadFm.modified as string).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  });

  test("returns 400 for malformed JSON body", async () => {
    const res = await fetch(`${env.baseUrl}/api/research_runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});
