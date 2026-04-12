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

describe("GET /api/activity param validation", () => {
  test("rejects limit=-1 with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=-1`);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("limit");
  });

  test("rejects limit=0 with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=0`);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("limit");
  });

  test("rejects limit=abc with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=abc`);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("limit");
  });

  test("clamps limit=99999 to 1000", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?limit=99999`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(1000);
  });

  test("rejects since=notadate with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?since=notadate`);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("since");
  });

  test("rejects until=2026-13-99 with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/activity?until=2026-13-99`);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("until");
  });

  test("rejects since > until with 400", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/activity?since=2026-04-12T10:00:00Z&until=2026-04-11T00:00:00Z`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("since");
  });
});
