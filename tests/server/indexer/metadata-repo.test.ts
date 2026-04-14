// tests/server/indexer/metadata-repo.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";

describe("MetadataRepo", () => {
  let db: Database;
  let repo: MetadataRepo;
  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    repo = new MetadataRepo(db);
  });

  test("upsert merges partial updates", () => {
    repo.upsert("a.md", { description: "first" });
    repo.upsert("a.md", { auto_tags: ["x", "y"] });
    const m = repo.get("a.md");
    expect(m?.description).toBe("first");
    expect(m?.auto_tags).toEqual(["x", "y"]);
  });

  test("get returns null for unknown note", () => {
    expect(repo.get("nope.md")).toBeNull();
  });

  test("upsert overwrites existing field when provided", () => {
    repo.upsert("a.md", { description: "first" });
    repo.upsert("a.md", { description: "second" });
    expect(repo.get("a.md")?.description).toBe("second");
  });

  test("upsert stores entities and themes as JSON", () => {
    repo.upsert("a.md", {
      entities: [{ name: "Tesla", kind: "org" }],
      themes: ["ml", "rl"],
    });
    const m = repo.get("a.md");
    expect(m?.entities).toEqual([{ name: "Tesla", kind: "org" }]);
    expect(m?.themes).toEqual(["ml", "rl"]);
  });
});
