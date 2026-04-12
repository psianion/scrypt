import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.writeNote(
    "notes/task-note.md",
    "---\ntitle: Task Note\ntags: [project]\n---\n\n- [ ] Buy milk\n- [x] Read book\n- [ ] Write code",
  );
  await Bun.sleep(300);
  await env.app.indexer.fullReindex();
});
afterAll(() => env.cleanup());

describe("GET /api/tasks", () => {
  test("returns all tasks across all notes", async () => {
    const res = await fetch(`${env.baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  test("includes source note path and line number", async () => {
    const res = await fetch(`${env.baseUrl}/api/tasks`);
    const data = await res.json();
    expect(data[0].notePath).toBe("notes/task-note.md");
    expect(data[0].line).toBeGreaterThan(0);
  });

  test("filters by done=false", async () => {
    const res = await fetch(`${env.baseUrl}/api/tasks?done=false`);
    const data = await res.json();
    expect(data.every((t: any) => !t.done)).toBe(true);
  });

  test("filters by board", async () => {
    const all = await (await fetch(`${env.baseUrl}/api/tasks`)).json();
    await fetch(`${env.baseUrl}/api/tasks/${all[0].id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: "in-progress" }),
    });
    const res = await fetch(`${env.baseUrl}/api/tasks?board=in-progress`);
    const data = await res.json();
    expect(data.every((t: any) => t.board === "in-progress")).toBe(true);
  });

  test("filters by source note tag", async () => {
    const res = await fetch(`${env.baseUrl}/api/tasks?tag=project`);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PUT /api/tasks/:id", () => {
  test("toggles done state", async () => {
    const list = await (await fetch(`${env.baseUrl}/api/tasks`)).json();
    const task = list[0];
    const res = await fetch(`${env.baseUrl}/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    expect(res.status).toBe(200);
  });

  test("updates board assignment", async () => {
    const list = await (await fetch(`${env.baseUrl}/api/tasks`)).json();
    const task = list[0];
    const res = await fetch(`${env.baseUrl}/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: "in-progress" }),
    });
    expect(res.status).toBe(200);
  });

  test("updates priority", async () => {
    const list = await (await fetch(`${env.baseUrl}/api/tasks`)).json();
    const task = list[0];
    const res = await fetch(`${env.baseUrl}/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: 2 }),
    });
    expect(res.status).toBe(200);
  });
});
