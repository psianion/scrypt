// tests/server/api/templates.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  env = createTestEnv();
  await Bun.write(
    `${env.vaultPath}/templates/project.md`,
    "---\ntitle: \"{title}\"\ntags: [project]\ncreated: \"{now}\"\n---\n\n# {title}\n\nCreated on {date}.\n"
  );
});
afterAll(() => env.cleanup());

describe("GET /api/templates", () => {
  test("returns list of .md files in templates/", async () => {
    const res = await fetch(`${env.baseUrl}/api/templates`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((t: any) => t.name === "project")).toBe(true);
  });
});

describe("POST /api/templates/apply", () => {
  test("creates note from template with variable substitution", async () => {
    const res = await fetch(`${env.baseUrl}/api/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "project",
        path: "notes/my-project.md",
        variables: { title: "My Project" },
      }),
    });
    expect(res.status).toBe(201);

    const note = await fetch(`${env.baseUrl}/api/notes/notes/my-project.md`);
    const data = await note.json();
    expect(data.content).toContain("# My Project");
  });

  test("substitutes {title}, {date}, {now}", async () => {
    const res = await fetch(`${env.baseUrl}/api/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "project",
        path: "notes/sub-test.md",
        variables: { title: "Sub Test" },
      }),
    });
    expect(res.status).toBe(201);

    const note = await fetch(`${env.baseUrl}/api/notes/notes/sub-test.md`);
    const data = await note.json();
    const today = new Date().toISOString().split("T")[0];
    expect(data.content).toContain(today);
  });

  test("returns 404 for missing template", async () => {
    const res = await fetch(`${env.baseUrl}/api/templates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "nonexistent", path: "notes/x.md" }),
    });
    expect(res.status).toBe(404);
  });
});
