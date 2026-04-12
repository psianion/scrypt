import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync } from "node:fs";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  mkdirSync(`${env.vaultPath}/assets`, { recursive: true });
  await Bun.write(`${env.vaultPath}/assets/logo.png`, "fake-png-data");
});
afterAll(() => env.cleanup());

describe("POST /api/files/upload", () => {
  test("uploads asset file", async () => {
    const formData = new FormData();
    formData.append("file", new Blob(["test-data"], { type: "text/plain" }), "test.txt");
    const res = await fetch(`${env.baseUrl}/api/files/upload`, {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.path).toContain("test.txt");
  });
});

describe("GET /api/files/*path", () => {
  test("serves asset file", async () => {
    const res = await fetch(`${env.baseUrl}/api/files/logo.png`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("fake-png-data");
  });

  test("returns 404 for missing asset", async () => {
    const res = await fetch(`${env.baseUrl}/api/files/nope.jpg`);
    expect(res.status).toBe(404);
  });

  test("rejects paths outside assets/ directory", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/files/${encodeURIComponent("../notes/secret.md")}`,
    );
    expect(res.status).toBe(400);
  });
});
