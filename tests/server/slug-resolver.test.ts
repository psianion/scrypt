import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { resolveSlug } from "../../src/server/slug-resolver";

let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  initSchema(db);
  const insert = db.query(
    "INSERT INTO link_index (slug, path, title) VALUES (?, ?, ?)",
  );
  insert.run("foo-bar", "notes/inbox/foo-bar.md", "Foo Bar Note");
  insert.run("notes/inbox/foo-bar", "notes/inbox/foo-bar.md", "Foo Bar Note");
  insert.run("foo-bar-note", "notes/inbox/foo-bar.md", "Foo Bar Note");
  insert.run("baz", "dnd/research/baz.md", "Baz");
  insert.run("dnd/research/baz", "dnd/research/baz.md", "Baz");
});
afterAll(() => db.close());

describe("resolveSlug", () => {
  test("exact basename match", () => {
    expect(resolveSlug("foo-bar", db)).toEqual({
      path: "notes/inbox/foo-bar.md",
      title: "Foo Bar Note",
    });
  });

  test("case-insensitive match", () => {
    expect(resolveSlug("FOO-BAR", db)?.path).toBe("notes/inbox/foo-bar.md");
  });

  test("full-path slug match", () => {
    expect(resolveSlug("notes/inbox/foo-bar", db)?.path).toBe(
      "notes/inbox/foo-bar.md",
    );
  });

  test("title-slug match", () => {
    expect(resolveSlug("foo-bar-note", db)?.path).toBe(
      "notes/inbox/foo-bar.md",
    );
  });

  test("resolves across folders without path prefix", () => {
    expect(resolveSlug("baz", db)?.path).toBe("dnd/research/baz.md");
  });

  test("unresolved returns null", () => {
    expect(resolveSlug("nonexistent", db)).toBeNull();
  });

  test("fuzzy path-suffix match for [[inbox/foo-bar]]", () => {
    expect(resolveSlug("inbox/foo-bar", db)?.path).toBe(
      "notes/inbox/foo-bar.md",
    );
  });
});
