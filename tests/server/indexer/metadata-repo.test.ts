// tests/server/indexer/metadata-repo.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { applyWave9Migration } from "../../../src/server/migrations/wave9";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";

describe("MetadataRepo", () => {
  let db: Database;
  let repo: MetadataRepo;
  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    applyWave9Migration(db);
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

  test("upsert persists doc_type and summary", () => {
    repo.upsert("a.md", { doc_type: "plan", summary: "paragraph summary" });
    const m = repo.get("a.md");
    expect(m?.doc_type).toBe("plan");
    expect(m?.summary).toBe("paragraph summary");
  });

  test("partial update of doc_type preserves summary and vice versa", () => {
    repo.upsert("a.md", { doc_type: "research", summary: "initial" });
    repo.upsert("a.md", { doc_type: "spec" });
    let m = repo.get("a.md");
    expect(m?.doc_type).toBe("spec");
    expect(m?.summary).toBe("initial");

    repo.upsert("a.md", { summary: "updated" });
    m = repo.get("a.md");
    expect(m?.doc_type).toBe("spec");
    expect(m?.summary).toBe("updated");
  });

  test("partial update of doc_type does not clobber auto_tags/entities/themes", () => {
    repo.upsert("a.md", {
      auto_tags: ["a"],
      entities: [{ name: "E", kind: "person" }],
      themes: ["t"],
    });
    repo.upsert("a.md", { doc_type: "journal" });
    const m = repo.get("a.md");
    expect(m?.auto_tags).toEqual(["a"]);
    expect(m?.entities).toEqual([{ name: "E", kind: "person" }]);
    expect(m?.themes).toEqual(["t"]);
    expect(m?.doc_type).toBe("journal");
  });
});
