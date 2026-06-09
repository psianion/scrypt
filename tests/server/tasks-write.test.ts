// tests/server/tasks-write.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../src/server/db";
import { TasksRepo } from "../../src/server/indexer/tasks-repo";
import { Router } from "../../src/server/router";
import { taskListRoutes } from "../../src/server/api/tasks";
import type { Database } from "bun:sqlite";

let vault: string;
let db: Database;
let router: Router;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "scrypt-jr-"));
  mkdirSync(join(vault, ".scrypt", "trash"), { recursive: true });
  db = createDatabase(join(vault, ".scrypt", "test.db"));
  initSchema(db);
  const tasks = new TasksRepo(db);
  router = new Router();
  taskListRoutes(router, tasks);
});

afterEach(() => {
  db.close();
  rmSync(vault, { recursive: true, force: true });
});

test("create then update a journal task", async () => {
  const create = await router.handle(
    new Request("http://x/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "do laundry",
        type: "CUSTOM",
        due_date: "2026-06-09",
        note_path: "journal/2026-06-09.md",
        client_tag: "ui-1",
      }),
    }),
  )!;
  expect(create.status).toBe(200);
  const created = await create.json();
  expect(created.title).toBe("do laundry");
  expect(created.type).toBe("CUSTOM");
  expect(created.status).toBe("open");
  expect(created.due_date).toBe("2026-06-09");
  expect(created.note_path).toBe("journal/2026-06-09.md");
  expect(created.client_tag).toBe("ui-1");

  const patch = await router.handle(
    new Request(`http://x/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    }),
  )!;
  expect(patch.status).toBe(200);
  expect((await patch.json()).status).toBe("closed");
});

test("POST rejects a missing title", async () => {
  const res = await router.handle(
    new Request("http://x/api/tasks", {
      method: "POST",
      body: JSON.stringify({ type: "CUSTOM" }),
    }),
  )!;
  expect(res.status).toBe(400);
});

test("POST rejects a missing type", async () => {
  const res = await router.handle(
    new Request("http://x/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "no type" }),
    }),
  )!;
  expect(res.status).toBe(400);
});

test("PATCH on an unknown id returns 404", async () => {
  const res = await router.handle(
    new Request("http://x/api/tasks/9999", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    }),
  )!;
  expect(res.status).toBe(404);
});

test("PATCH rejects a non-numeric id", async () => {
  const res = await router.handle(
    new Request("http://x/api/tasks/abc", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    }),
  )!;
  expect(res.status).toBe(400);
});
