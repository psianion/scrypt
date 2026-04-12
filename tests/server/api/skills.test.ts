import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await Bun.write(
    `${env.vaultPath}/skills/summarize.md`,
    `---
name: summarize
description: Summarize a note
input:
  note_path: The path to the note
output: A summary paragraph
---

Given the note at {note_path}, write a 2-sentence summary.`,
  );
});
afterAll(() => env.cleanup());

describe("GET /api/skills", () => {
  test("returns list of .md files in skills/", async () => {
    const res = await fetch(`${env.baseUrl}/api/skills`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((s: any) => s.name === "summarize")).toBe(true);
  });
});

describe("GET /api/skills/:name", () => {
  test("returns parsed skill frontmatter + body", async () => {
    const res = await fetch(`${env.baseUrl}/api/skills/summarize`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("summarize");
    expect(data.body).toContain("2-sentence summary");
  });

  test("returns 404 for missing skill", async () => {
    const res = await fetch(`${env.baseUrl}/api/skills/nope`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/skills", () => {
  test("creates a new skill file", async () => {
    const res = await fetch(`${env.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "expand",
        description: "Expand a topic",
        input: { topic: "The topic" },
        output: "Expanded content",
        body: "Expand on {topic} in detail.",
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/skills/:name", () => {
  test("removes skill file", async () => {
    await fetch(`${env.baseUrl}/api/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "temp",
        description: "Temp",
        input: {},
        output: "",
        body: "Temp.",
      }),
    });
    const res = await fetch(`${env.baseUrl}/api/skills/temp`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});
