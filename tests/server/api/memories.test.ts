import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "3D printing",
    content: "body",
    frontmatter: { active: true, category: "interest", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "memory",
    title: "Old hobby",
    content: "body",
    frontmatter: { active: false, category: "interest", priority: 0 },
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/memories", () => {
  test("returns all memories by default", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters active=true", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories?active=true`);
    const data = await res.json();
    expect(data.every((m: any) => m.active === true)).toBe(true);
  });

  test("filters category", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories?category=interest`);
    const data = await res.json();
    expect(data.every((m: any) => m.category === "interest")).toBe(true);
  });

  test("sorted by priority DESC", async () => {
    const res = await fetch(`${env.baseUrl}/api/memories`);
    const data = await res.json();
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].priority).toBeGreaterThanOrEqual(data[i].priority);
    }
  });
});
