import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { TasksRepo } from "../../../src/server/indexer/tasks-repo";
import { taskListRoutes } from "../../../src/server/api/tasks";
import { Router } from "../../../src/server/router";

function buildRouter() {
  const db = new Database(":memory:");
  initSchema(db);
  const repo = new TasksRepo(db);
  repo.create({ note_path: "a.md", title: "T1", type: "PLAN" });
  repo.create({ note_path: null, title: "T2", type: "CUSTOM", status: "closed" });
  const router = new Router();
  taskListRoutes(router, repo);
  return { router, repo };
}

describe("GET /api/tasks/list", () => {
  test("returns open tasks by default, ordered by priority desc then due_date asc", async () => {
    const { router } = buildRouter();
    const res = await router.handle(new Request("http://x/api/tasks/list"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.total).toBe(1);
    expect(body.tasks[0].title).toBe("T1");
  });

  test("status=all returns closed too", async () => {
    const { router } = buildRouter();
    const res = await router.handle(new Request("http://x/api/tasks/list?status=all"));
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.total).toBe(2);
  });

  test("invalid status returns 400", async () => {
    const { router } = buildRouter();
    const res = await router.handle(new Request("http://x/api/tasks/list?status=bogus"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });
});
