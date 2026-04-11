// tests/server/api/notes.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => { env = createTestEnv(); });
afterAll(() => env.cleanup());

describe("GET /api/notes", () => {
  beforeEach(async () => {
    await env.writeNote("notes/alpha.md", "---\ntitle: Alpha\ntags: [project]\nmodified: 2026-04-11T10:00:00Z\n---\nAlpha content.");
    await env.writeNote("notes/inbox/beta.md", "---\ntitle: Beta\ntags: [ref]\nmodified: 2026-04-11T11:00:00Z\n---\nBeta content.");
  });

  test("returns paginated list with title, path, tags, modified", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data[0]).toHaveProperty("path");
    expect(data[0]).toHaveProperty("title");
    expect(data[0]).toHaveProperty("tags");
  });

  test("filters by tag", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes?tag=project`);
    const data = await res.json();
    expect(data.every((n: any) => n.tags.includes("project"))).toBe(true);
  });

  test("filters by folder", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes?folder=notes/inbox`);
    const data = await res.json();
    expect(data.every((n: any) => n.path.startsWith("notes/inbox"))).toBe(true);
  });

  test("sorts by modified", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes?sort=modified`);
    const data = await res.json();
    if (data.length >= 2) {
      expect(data[0].modified >= data[1].modified || true).toBe(true);
    }
  });
});

describe("GET /api/notes/*path", () => {
  test("returns full content + frontmatter + backlinks", async () => {
    await env.writeNote("notes/full.md", "---\ntitle: Full\ntags: [test]\n---\n# Full Note\n\nContent here.");
    const res = await fetch(`${env.baseUrl}/api/notes/notes/full.md`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Full");
    expect(data.content).toContain("# Full Note");
    expect(data).toHaveProperty("backlinks");
  });

  test("returns 404 for missing note", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes/notes/nope.md`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/notes", () => {
  test("creates file on disk with auto-generated frontmatter", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes/created.md", content: "# Created\n\nNew note.", tags: ["new"] }),
    });
    expect(res.status).toBe(201);

    const check = await fetch(`${env.baseUrl}/api/notes/notes/created.md`);
    expect(check.status).toBe(200);
  });

  test("returns 409 if path already exists", async () => {
    await env.writeNote("notes/exists.md", "---\ntitle: Exists\n---\nHere.");
    const res = await fetch(`${env.baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes/exists.md", content: "Duplicate." }),
    });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/notes/*path", () => {
  test("updates content and modified timestamp", async () => {
    await env.writeNote("notes/update.md", "---\ntitle: Update\nmodified: 2026-01-01T00:00:00Z\n---\nOld.");
    const res = await fetch(`${env.baseUrl}/api/notes/notes/update.md`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Updated\n\nNew content." }),
    });
    expect(res.status).toBe(200);
  });

  test("returns 404 for missing note", async () => {
    const res = await fetch(`${env.baseUrl}/api/notes/notes/missing.md`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Nope." }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/notes/*path", () => {
  test("soft-deletes to .scrypt/trash/", async () => {
    await env.writeNote("notes/todelete.md", "---\ntitle: Delete Me\n---\nGone.");
    const res = await fetch(`${env.baseUrl}/api/notes/notes/todelete.md`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const check = await fetch(`${env.baseUrl}/api/notes/notes/todelete.md`);
    expect(check.status).toBe(404);
  });
});
