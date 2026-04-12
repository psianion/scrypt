import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../../../src/server/parsers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(() => {
  env = createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

describe("POST /api/ingest", () => {
  test("creates a note kind and returns the path", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note",
        title: "Through API",
        content: "body",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.path).toBe("notes/inbox/through-api.md");
    expect(data.kind).toBe("note");
    expect(data.created).toBe(true);
    expect(existsSync(join(env.vaultPath, data.path))).toBe(true);
  });

  test("returns 400 for unknown kind", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "bogus", title: "X", content: "y" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/unknown kind/i);
  });

  test("returns 400 for missing title", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "note", content: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  test("ignores client-supplied created/modified in frontmatter", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note",
        title: "ts bypass",
        content: "x",
        frontmatter: {
          created: "1999-01-01T00:00:00Z",
          modified: "1999-01-01T00:00:00Z",
        },
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    const raw = readFileSync(join(env.vaultPath, data.path), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.created).not.toBe("1999-01-01T00:00:00Z");
    expect(frontmatter.modified).not.toBe("1999-01-01T00:00:00Z");
    expect(new Date(frontmatter.created as string).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
    expect(new Date(frontmatter.modified as string).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  });

  test("returns 400 for malformed JSON body", async () => {
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 on collision with replace=false", async () => {
    await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "idea",
        title: "Collision test",
        content: "a",
      }),
    });
    const res = await fetch(`${env.baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "idea",
        title: "Collision test",
        content: "b",
      }),
    });
    expect(res.status).toBe(409);
  });
});
