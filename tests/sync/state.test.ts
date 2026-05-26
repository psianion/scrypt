import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { loadBase, setBase, clearBase } from "../../src/server/sync/state";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

test("loadBase is empty initially", () => {
  expect(loadBase(db).size).toBe(0);
});

test("setBase then loadBase returns the hash", () => {
  setBase(db, "a/b.md", "deadbeef");
  expect(loadBase(db).get("a/b.md")).toBe("deadbeef");
});

test("setBase upserts (no duplicate rows)", () => {
  setBase(db, "a/b.md", "h1");
  setBase(db, "a/b.md", "h2");
  const map = loadBase(db);
  expect(map.size).toBe(1);
  expect(map.get("a/b.md")).toBe("h2");
});

test("clearBase removes the row", () => {
  setBase(db, "a/b.md", "h1");
  clearBase(db, "a/b.md");
  expect(loadBase(db).has("a/b.md")).toBe(false);
});
