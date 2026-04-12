import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Open SVE2 question",
    content: "# Open",
    frontmatter: { status: "open", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Resolved old thing",
    content: "# Done",
    frontmatter: { status: "resolved", priority: 0 },
  });
  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/threads", () => {
  test("returns all threads when no filter", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=open`);
    const data = await res.json();
    expect(data.every((t: any) => t.status === "open")).toBe(true);
  });

  test("filters by comma-separated statuses", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads?status=open,resolved`,
    );
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by priority", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?priority=2`);
    const data = await res.json();
    expect(data.every((t: any) => t.priority >= 2)).toBe(true);
  });
});

describe("GET /api/threads/:slug", () => {
  test("returns full thread with content", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/open-sve2-question`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slug).toBe("open-sve2-question");
    expect(data.status).toBe("open");
    expect(data.content).toContain("Open");
  });

  test("returns 404 for unknown slug", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/nope`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/threads/:slug", () => {
  test("updates status and run_count", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in-progress", run_count: 5 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await (
      await fetch(`${env.baseUrl}/api/threads/open-sve2-question`)
    ).json();
    expect(updated.status).toBe("in-progress");
    expect(updated.run_count).toBe(5);
  });

  test("rejects unknown fields with 400", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evil: "yes" }),
      },
    );
    expect(res.status).toBe(400);
  });
});
