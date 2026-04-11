// tests/server/api/journal.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  env = createTestEnv();
  // Create daily template
  await Bun.write(
    `${env.vaultPath}/templates/daily.md`,
    "---\ntitle: \"{date}\"\ntags: [journal, daily]\n---\n\n# {date}\n\n## Notes\n\n"
  );
});
afterAll(() => env.cleanup());

describe("GET /api/journal/today", () => {
  test("creates note from daily template if missing", async () => {
    const res = await fetch(`${env.baseUrl}/api/journal/today`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content).toContain("## Notes");
  });

  test("returns today's note if it exists", async () => {
    const res = await fetch(`${env.baseUrl}/api/journal/today`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const today = new Date().toISOString().split("T")[0];
    expect(data.path).toBe(`journal/${today}.md`);
  });
});

describe("GET /api/journal/:date", () => {
  test("returns existing journal entry by date", async () => {
    await env.writeNote("journal/2026-03-15.md", "---\ntitle: \"2026-03-15\"\ntags: [journal]\n---\n\n# March 15\n\n");
    const res = await fetch(`${env.baseUrl}/api/journal/2026-03-15`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content).toContain("March 15");
  });

  test("returns 404 for dates without notes", async () => {
    const res = await fetch(`${env.baseUrl}/api/journal/1999-01-01`);
    expect(res.status).toBe(404);
  });
});
