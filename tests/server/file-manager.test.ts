// tests/server/file-manager.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileManager } from "../../src/server/file-manager";

let vaultPath: string;
let scryptPath: string;
let fm: FileManager;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-fm-test-"));
  scryptPath = join(vaultPath, ".scrypt");
  mkdirSync(join(scryptPath, "trash"), { recursive: true });
  mkdirSync(join(vaultPath, "notes", "inbox"), { recursive: true });
  fm = new FileManager(vaultPath, scryptPath);
});

afterEach(() => {
  fm.stopWatching();
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("readNote", () => {
  test("returns content + parsed frontmatter for a .md file", async () => {
    const content = `---\ntitle: Test\ntags: [a]\n---\n\n# Test\n\nBody.`;
    await Bun.write(join(vaultPath, "notes/test.md"), content);

    const note = await fm.readNote("notes/test.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Test");
    expect(note!.tags).toEqual(["a"]);
    expect(note!.content).toContain("# Test");
  });

  test("returns null for non-existent path", async () => {
    const note = await fm.readNote("notes/nope.md");
    expect(note).toBeNull();
  });
});

describe("readRaw", () => {
  test("returns raw file content including frontmatter", async () => {
    await Bun.write(
      join(vaultPath, "notes/raw.md"),
      "---\ntitle: Raw\n---\n\n# Raw body",
    );
    const content = await fm.readRaw("notes/raw.md");
    expect(content).toContain("---");
    expect(content).toContain("# Raw body");
  });

  test("returns null for missing file", async () => {
    const content = await fm.readRaw("notes/does-not-exist.md");
    expect(content).toBeNull();
  });
});

describe("writeNote", () => {
  test("creates file with frontmatter + content", async () => {
    await fm.writeNote("notes/new.md", "# New\n\nContent.", {
      title: "New",
      tags: ["test"],
    });

    const raw = readFileSync(join(vaultPath, "notes/new.md"), "utf-8");
    expect(raw).toContain("title: New");
    expect(raw).toContain("# New");
  });

  test("updates modified timestamp in frontmatter", async () => {
    await fm.writeNote("notes/ts.md", "Body.", {
      title: "Ts",
      created: "2026-01-01T00:00:00Z",
      modified: "2026-01-01T00:00:00Z",
    });

    const note = await fm.readNote("notes/ts.md");
    expect(note!.modified).not.toBe("2026-01-01T00:00:00Z");
  });

  test("creates parent directories if needed", async () => {
    await fm.writeNote("notes/deep/nested/note.md", "Content.", {
      title: "Deep",
    });
    expect(existsSync(join(vaultPath, "notes/deep/nested/note.md"))).toBe(true);
  });

  test("preserves created across updates", async () => {
    await fm.writeNote("notes/keep.md", "Body.", { title: "Keep" });
    const first = await fm.readNote("notes/keep.md");
    const originalCreated = first!.created;
    expect(originalCreated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await Bun.sleep(5);
    await fm.writeNote("notes/keep.md", "Body v2.", { title: "Keep" });
    const second = await fm.readNote("notes/keep.md");
    expect(second!.created).toBe(originalCreated);
  });

  test("ignores client-supplied created on new note", async () => {
    const before = Date.now();
    await fm.writeNote("notes/new-ignore.md", "Body.", {
      title: "Ignore",
      created: "2020-01-01T00:00:00.000Z",
    });
    const note = await fm.readNote("notes/new-ignore.md");
    expect(note!.created).not.toBe("2020-01-01T00:00:00.000Z");
    const createdMs = new Date(note!.created).getTime();
    expect(createdMs).toBeGreaterThanOrEqual(before);
  });

  test("ignores client-supplied modified", async () => {
    const before = Date.now();
    await fm.writeNote("notes/mod.md", "Body.", {
      title: "Mod",
      modified: "1999-12-31T00:00:00.000Z",
    });
    const note = await fm.readNote("notes/mod.md");
    expect(note!.modified).not.toBe("1999-12-31T00:00:00.000Z");
    const modifiedMs = new Date(note!.modified).getTime();
    expect(modifiedMs).toBeGreaterThanOrEqual(before);
  });

  test("always bumps modified on update", async () => {
    await fm.writeNote("notes/bump.md", "Body.", { title: "Bump" });
    const first = await fm.readNote("notes/bump.md");
    const firstModified = first!.modified;

    await Bun.sleep(5);
    await fm.writeNote("notes/bump.md", "Body 2.", { title: "Bump" });
    const second = await fm.readNote("notes/bump.md");
    expect(new Date(second!.modified).getTime()).toBeGreaterThan(
      new Date(firstModified).getTime(),
    );
  });
});

describe("deleteNote", () => {
  test("moves file to .scrypt/trash/ with timestamp prefix", async () => {
    await Bun.write(join(vaultPath, "notes/del.md"), "---\ntitle: Del\n---\nContent.");
    await fm.deleteNote("notes/del.md");

    expect(existsSync(join(vaultPath, "notes/del.md"))).toBe(false);
    const trashFiles = new Bun.Glob("*.md").scanSync(join(scryptPath, "trash"));
    const files = Array.from(trashFiles);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test("throws for non-existent file", async () => {
    await expect(fm.deleteNote("notes/nope.md")).rejects.toThrow();
  });
});

describe("listNotes", () => {
  test("returns all .md files recursively with metadata", async () => {
    await Bun.write(
      join(vaultPath, "notes/a.md"),
      "---\ntitle: A\ntags: [x]\n---\nContent A."
    );
    await Bun.write(
      join(vaultPath, "notes/inbox/b.md"),
      "---\ntitle: B\ntags: []\n---\nContent B."
    );

    const notes = await fm.listNotes();
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.find((n) => n.path === "notes/a.md")).toBeDefined();
    expect(notes.find((n) => n.path === "notes/inbox/b.md")).toBeDefined();
  });

  test("filters by folder", async () => {
    await Bun.write(join(vaultPath, "notes/a.md"), "---\ntitle: A\n---\nA.");
    await Bun.write(join(vaultPath, "notes/inbox/b.md"), "---\ntitle: B\n---\nB.");

    const notes = await fm.listNotes("notes/inbox");
    expect(notes.every((n) => n.path.startsWith("notes/inbox"))).toBe(true);
  });
});

describe("watchFiles", () => {
  test("emits create event when new .md file appears", async () => {
    const events: { type: string; path: string }[] = [];
    fm.watchFiles((e) => events.push(e));

    await Bun.sleep(100);
    await Bun.write(join(vaultPath, "notes/watch-new.md"), "---\ntitle: W\n---\nNew.");
    await Bun.sleep(500);

    expect(events.some((e) => e.type === "create" && e.path.includes("watch-new.md"))).toBe(true);
  });

  test("emits modify event when .md content changes", async () => {
    await Bun.write(join(vaultPath, "notes/watch-mod.md"), "Original.");
    const events: { type: string; path: string }[] = [];
    fm.watchFiles((e) => events.push(e));

    await Bun.sleep(100);
    await Bun.write(join(vaultPath, "notes/watch-mod.md"), "Modified.");
    await Bun.sleep(500);

    expect(events.some((e) => e.path.includes("watch-mod.md"))).toBe(true);
  });

  test("ignores non-.md files and .scrypt/ directory", async () => {
    const events: { type: string; path: string }[] = [];
    fm.watchFiles((e) => events.push(e));

    await Bun.sleep(100);
    await Bun.write(join(vaultPath, "notes/ignore.txt"), "Not markdown.");
    await Bun.write(join(scryptPath, "internal.md"), "Internal.");
    await Bun.sleep(500);

    expect(events.every((e) => e.path.endsWith(".md") && !e.path.includes(".scrypt"))).toBe(true);
  });
});
