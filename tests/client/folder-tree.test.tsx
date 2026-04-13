import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { buildTree, type FolderNode } from "../../src/client/components/FolderTree.helpers";
import { FolderTree } from "../../src/client/components/FolderTree";

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

let originalFetch: typeof globalThis.fetch;
const mockFetch = (async (url: string) => {
  if (url.startsWith("/api/notes")) {
    return new Response(
      JSON.stringify([
        { path: "dnd/research/a.md", title: "A Note", tags: [] },
        { path: "dnd/research/b.md", title: "B Note", tags: [] },
        { path: "dnd/plans/c.md", title: "C Plan", tags: [] },
        { path: "scrypt-dev/specs/d.md", title: "D Spec", tags: [] },
      ]),
    );
  }
  return new Response("[]");
}) as any;

describe("FolderTree render", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    localStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
  });

  test("renders nested folders and notes after fetch", async () => {
    render(
      <BrowserRouter>
        <FolderTree />
      </BrowserRouter>,
    );
    expect(await screen.findByText("dnd")).toBeDefined();
    expect(screen.getByText("scrypt-dev")).toBeDefined();
  });

  test("folders are collapsed by default; click to expand", async () => {
    render(
      <BrowserRouter>
        <FolderTree />
      </BrowserRouter>,
    );
    await screen.findByText("dnd");
    expect(screen.queryByText("A Note")).toBeNull();
    fireEvent.click(screen.getByText("dnd"));
    fireEvent.click(screen.getByText("research"));
    expect(screen.getByText("A Note")).toBeDefined();
  });

  test("expand state persists in localStorage", async () => {
    const { unmount } = render(
      <BrowserRouter>
        <FolderTree />
      </BrowserRouter>,
    );
    await screen.findByText("dnd");
    fireEvent.click(screen.getByText("dnd"));
    unmount();
    expect(localStorage.getItem("scrypt.sidebar.expanded")).toContain("dnd");
  });

  test("empty vault state shows drop hint", async () => {
    globalThis.fetch = (async () => new Response("[]")) as any;
    render(
      <BrowserRouter>
        <FolderTree />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/drop a markdown file/i)).toBeDefined();
  });
});
