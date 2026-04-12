// tests/server/server.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(() => {
  env = createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

describe("server", () => {
  test("starts and responds to requests", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes`);
    expect(res.status).toBe(200);
  });

  test("returns 404 for unknown API routes", async () => {
    const res = await fetch(`${env.baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("serves index.html for SPA fallback routes", async () => {
    const res = await fetch(`${env.baseUrl}/some/route`);
    const text = await res.text();
    expect(text).toContain("Scrypt");
  });
});
