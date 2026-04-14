// tests/server/indexer/sections-repo.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { SectionsRepo } from "../../../src/server/indexer/sections-repo";

describe("SectionsRepo", () => {
  let db: Database;
  let repo: SectionsRepo;
  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    repo = new SectionsRepo(db);
  });

  test("replaceNoteSections overwrites prior sections for the same note", () => {
    repo.replaceNoteSections("a.md", [
      {
        id: "a_md:intro",
        headingSlug: "intro",
        headingText: "Intro",
        level: 2,
        startLine: 0,
        endLine: 5,
      },
      {
        id: "a_md:body",
        headingSlug: "body",
        headingText: "Body",
        level: 2,
        startLine: 6,
        endLine: 20,
      },
    ]);
    expect(repo.listByNote("a.md").length).toBe(2);

    repo.replaceNoteSections("a.md", [
      {
        id: "a_md:only",
        headingSlug: "only",
        headingText: "Only",
        level: 2,
        startLine: 0,
        endLine: 10,
      },
    ]);
    const rows = repo.listByNote("a.md");
    expect(rows.length).toBe(1);
    expect(rows[0].heading_slug).toBe("only");
  });

  test("setSummary updates an existing section", () => {
    repo.replaceNoteSections("a.md", [
      {
        id: "a_md:intro",
        headingSlug: "intro",
        headingText: "Intro",
        level: 2,
        startLine: 0,
        endLine: 5,
      },
    ]);
    const changed = repo.setSummary("a_md:intro", "a one-line summary");
    expect(changed).toBe(1);
    const row = repo.getById("a_md:intro");
    expect(row?.summary).toBe("a one-line summary");
  });

  test("setSummary returns 0 when the section doesn't exist", () => {
    expect(repo.setSummary("missing", "...")).toBe(0);
  });
});
