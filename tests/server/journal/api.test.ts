// tests/server/journal/api.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../../src/server/db";
import { FileManager } from "../../../src/server/file-manager";
import { Indexer } from "../../../src/server/indexer";
import { TasksRepo } from "../../../src/server/indexer/tasks-repo";
import { Router } from "../../../src/server/router";
import { journalRoutes } from "../../../src/server/api/journal";

export function setup() {
  const vault = mkdtempSync(join(tmpdir(), "scrypt-jr-"));
  mkdirSync(join(vault, ".scrypt", "trash"), { recursive: true });
  mkdirSync(join(vault, "journal"), { recursive: true });

  const db = createDatabase(join(vault, ".scrypt", "test.db"));
  initSchema(db);
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const indexer = new Indexer(db, fm);
  const tasks = new TasksRepo(db);
  const router = new Router();
  // no engine/embeddings in tests => related is [] (intended; no wave8 here)
  journalRoutes(router, fm, indexer, tasks, db);
  return { router, vault, db, fm, indexer, tasks };
}

test("POST then GET returns the entry in the day bundle", async () => {
  const { router } = setup();
  const post = await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "wrote about the necromancer" }),
    }),
  )!;
  expect(post.status).toBe(200);

  const get = await router.handle(
    new Request("http://x/api/journal/2026-06-09"),
  )!;
  const bundle = await get.json();
  expect(bundle.date).toBe("2026-06-09");
  expect(bundle.entries.length).toBe(1);
  expect(bundle.entries[0].body).toBe("wrote about the necromancer");
  expect(Array.isArray(bundle.tasks_due)).toBe(true);
});

test("PATCH edits an entry's body; DELETE removes it", async () => {
  const { router } = setup();
  await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "first" }),
    }),
  )!;
  const afterPost = await (await router.handle(
    new Request("http://x/api/journal/2026-06-09"),
  )!).json();
  const id = afterPost.entries[0].id;

  const patch = await router.handle(
    new Request(`http://x/api/journal/2026-06-09/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: "edited" }),
    }),
  )!;
  const afterPatch = await patch.json();
  expect(afterPatch.entries[0].body).toBe("edited");

  const del = await router.handle(
    new Request(`http://x/api/journal/2026-06-09/entries/${id}`, {
      method: "DELETE",
    }),
  )!;
  const afterDel = await del.json();
  expect(afterDel.entries.length).toBe(0);
});

test("tasks due on the day appear in tasks_due", async () => {
  const { router, tasks } = setup();
  tasks.create({
    title: "do laundry",
    type: "CUSTOM",
    due_date: "2026-06-09",
    note_path: "journal/2026-06-09.md",
  });
  tasks.create({
    title: "other day",
    type: "CUSTOM",
    due_date: "2026-06-10",
  });
  const get = await router.handle(
    new Request("http://x/api/journal/2026-06-09"),
  )!;
  const bundle = await get.json();
  expect(bundle.tasks_due.map((t: any) => t.title)).toEqual(["do laundry"]);
});

test("a completed task due that day stays in tasks_due (not filtered out)", async () => {
  const { router, tasks } = setup();
  const t = tasks.create({
    title: "finish report",
    type: "CUSTOM",
    due_date: "2026-06-09",
    note_path: "journal/2026-06-09.md",
  });
  tasks.update(t.id, { status: "closed" });
  const get = await router.handle(
    new Request("http://x/api/journal/2026-06-09"),
  )!;
  const bundle = await get.json();
  const found = bundle.tasks_due.find((x: any) => x.title === "finish report");
  expect(found).toBeDefined();
  expect(found.status).toBe("closed");
});

test("GET /api/journal/:date/tasks returns tasks due that day, any status", async () => {
  const { router, tasks } = setup();
  const open = tasks.create({
    title: "due today",
    type: "CUSTOM",
    due_date: "2026-06-09",
  });
  const closed = tasks.create({
    title: "done today",
    type: "CUSTOM",
    due_date: "2026-06-09",
  });
  tasks.update(closed.id, { status: "closed" });
  tasks.create({ title: "other day", type: "CUSTOM", due_date: "2026-06-10" });

  const res = await router.handle(
    new Request("http://x/api/journal/2026-06-09/tasks"),
  )!;
  expect(res.status).toBe(200);
  const list = await res.json();
  expect(list.map((t: any) => t.id).sort()).toEqual(
    [open.id, closed.id].sort(),
  );

  const bad = await router.handle(
    new Request("http://x/api/journal/nope/tasks"),
  )!;
  expect(bad.status).toBe(400);
});

test("rejects an invalid date key", async () => {
  const { router } = setup();
  const res = await router.handle(
    new Request("http://x/api/journal/not-a-date"),
  )!;
  expect(res.status).toBe(400);
});
