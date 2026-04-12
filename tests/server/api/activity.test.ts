import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "note",
    title: "activity one",
    content: "x",
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "activity two",
    content: "y",
  });
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/activity", () => {
  test("returns recent activity", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by kind", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?kind=thread`);
    const data = await res.json();
    expect(data.every((r: any) => r.kind === "thread")).toBe(true);
  });

  test("filters by actor", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?actor=claude`);
    const data = await res.json();
    expect(data.every((r: any) => r.actor === "claude")).toBe(true);
  });

  test("respects limit", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=1`);
    const data = await res.json();
    expect(data.length).toBe(1);
  });
});
