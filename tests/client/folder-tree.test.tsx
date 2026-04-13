import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { buildTree, type FolderNode } from "../../src/client/components/FolderTree.helpers";

describe("buildTree", () => {
  test("builds nested tree from flat paths", () => {
    const notes = [
      { path: "dnd/research/a.md", title: "A" },
      { path: "dnd/research/b.md", title: "B" },
      { path: "dnd/plans/c.md", title: "C" },
      { path: "scrypt-dev/specs/d.md", title: "D" },
    ] as any[];
    const root = buildTree(notes);
    expect([...root.children.keys()].sort()).toEqual(["dnd", "scrypt-dev"]);
    const dnd = root.children.get("dnd")!;
    expect([...dnd.children.keys()].sort()).toEqual(["plans", "research"]);
    expect(dnd.children.get("research")!.notes.length).toBe(2);
  });

  test("skips reserved top-level folders", () => {
    const notes = [
      { path: "journal/2026-04-13.md", title: "J" },
      { path: "data/foo.csv", title: "D" },
      { path: "assets/x.png", title: "X" },
      { path: ".scrypt/cache.db", title: "S" },
      { path: "dist/bundle.js", title: "B" },
      { path: "dnd/research/a.md", title: "A" },
    ] as any[];
    const root = buildTree(notes);
    expect([...root.children.keys()]).toEqual(["dnd"]);
  });

  test("empty folder nodes are pruned (never created)", () => {
    const notes = [{ path: "dnd/research/a.md", title: "A" }] as any[];
    const root = buildTree(notes);
    expect(root.children.has("scrypt-dev")).toBe(false);
  });

  test("sorts folder children alphabetically and notes by title", () => {
    const notes = [
      { path: "dnd/z.md", title: "Zebra" },
      { path: "dnd/a.md", title: "Apple" },
      { path: "dnd/m.md", title: "Mango" },
    ] as any[];
    const root = buildTree(notes);
    const titles = root.children.get("dnd")!.notes.map((n) => n.title);
    expect(titles).toEqual(["Apple", "Mango", "Zebra"]);
  });
});
