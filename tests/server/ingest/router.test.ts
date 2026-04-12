import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../../src/server/db";
import { FileManager } from "../../../src/server/file-manager";
import { Indexer } from "../../../src/server/indexer";
import { ActivityLog } from "../../../src/server/activity";
import { IngestRouter } from "../../../src/server/ingest/router";
import { parseFrontmatter } from "../../../src/server/parsers";
import type { Database } from "bun:sqlite";

let vaultPath: string;
let db: Database;
let fm: FileManager;
let indexer: Indexer;
let activity: ActivityLog;
let ingest: IngestRouter;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-ingest-"));
  db = createDatabase(":memory:");
  initSchema(db);
  fm = new FileManager(vaultPath, join(vaultPath, ".scrypt"));
  indexer = new Indexer(db, fm);
  activity = new ActivityLog(db);
  ingest = new IngestRouter({ vaultPath, db, fm, indexer, activity });
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("IngestRouter.ingest — basic", () => {
  test("creates a note kind at notes/inbox/{slug}.md", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "Quick capture",
      content: "# Quick capture\n\nsomething to triage later",
    });
    expect(res.created).toBe(true);
    expect(res.path).toBe("notes/inbox/quick-capture.md");
    expect(res.kind).toBe("note");
    expect(existsSync(join(vaultPath, res.path))).toBe(true);
  });

  test("injects kind, created, modified, source into frontmatter", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "Test",
      content: "body",
    });
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.kind).toBe("note");
    expect(frontmatter.source).toBe("claude");
    expect(frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(frontmatter.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("ignores client-set created, modified, source", async () => {
    const res = await ingest.ingest({
      kind: "note",
      title: "T",
      content: "x",
      frontmatter: {
        created: "1999-01-01T00:00:00.000Z",
        modified: "1999-01-01T00:00:00.000Z",
        source: "evil",
      },
    });
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.created).not.toBe("1999-01-01T00:00:00.000Z");
    expect(frontmatter.source).toBe("claude");
  });

  test("400-like error on unknown kind", async () => {
    await expect(
      ingest.ingest({ kind: "bogus" as any, title: "X", content: "y" }),
    ).rejects.toThrow(/unknown kind/i);
  });

  test("error on missing title", async () => {
    await expect(
      ingest.ingest({ kind: "note", title: "", content: "y" }),
    ).rejects.toThrow(/title/i);
  });

  test("error on missing content", async () => {
    await expect(
      ingest.ingest({ kind: "note", title: "X", content: "" }),
    ).rejects.toThrow(/content/i);
  });

  test("409-like error on collision with replace=false", async () => {
    await ingest.ingest({
      kind: "idea",
      title: "Neat idea",
      content: "a",
    });
    await expect(
      ingest.ingest({
        kind: "idea",
        title: "Neat idea",
        content: "b",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test("overwrites on replace=true", async () => {
    await ingest.ingest({ kind: "idea", title: "Neat idea", content: "a" });
    const res = await ingest.ingest({
      kind: "idea",
      title: "Neat idea",
      content: "b",
      replace: true,
    });
    expect(res.created).toBe(false);
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    expect(raw).toContain("b");
  });

  test("auto-increments slug when title collides but replace=false and distinct content", async () => {
    await ingest.ingest({ kind: "idea", title: "Dup", content: "a" });
    await expect(
      ingest.ingest({ kind: "idea", title: "Dup", content: "b" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("emits a create activity_log row", async () => {
    await ingest.ingest({ kind: "note", title: "Log me", content: "x" });
    const rows = activity.query({ kind: "note" });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].actor).toBe("claude");
    expect(rows[0].path).toBe("notes/inbox/log-me.md");
  });
});

describe("IngestRouter.ingest — journal kind", () => {
  test("creates today's journal file on first write", async () => {
    const res = await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "First entry of the day",
    });
    expect(res.path).toMatch(/^journal\/\d{4}-\d{2}-\d{2}\.md$/);
    const raw = readFileSync(join(vaultPath, res.path), "utf-8");
    expect(raw).toContain("First entry of the day");
  });

  test("appends to existing journal file under a timestamp heading", async () => {
    await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "Morning thought",
    });
    const res2 = await ingest.ingest({
      kind: "journal",
      title: "unused",
      content: "Afternoon thought",
    });
    const raw = readFileSync(join(vaultPath, res2.path), "utf-8");
    expect(raw).toContain("Morning thought");
    expect(raw).toContain("Afternoon thought");
    expect(raw).toMatch(/##\s+\d{2}:\d{2}\s+UTC/);
    expect(res2.created).toBe(false);
  });

  test("emits append activity log row for journal appends", async () => {
    await ingest.ingest({
      kind: "journal",
      title: "u",
      content: "first",
    });
    await ingest.ingest({
      kind: "journal",
      title: "u",
      content: "second",
    });
    const rows = activity.query({ kind: "journal" });
    expect(rows.some((r) => r.action === "create")).toBe(true);
    expect(rows.some((r) => r.action === "append")).toBe(true);
  });
});
