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

describe("IngestRouter.ingest — research_run side effects", () => {
  async function seedThread(slug: string) {
    await ingest.ingest({
      kind: "thread",
      title: slug,
      content: "# Thread body",
      frontmatter: { status: "open", priority: 1, prompt: "initial" },
    });
  }

  test("rejects research_run when frontmatter.thread is missing", async () => {
    await expect(
      ingest.ingest({
        kind: "research_run",
        title: "orphan run",
        content: "# findings",
      }),
    ).rejects.toThrow(/thread/i);
  });

  test("rejects research_run when thread slug does not exist", async () => {
    await expect(
      ingest.ingest({
        kind: "research_run",
        title: "bad thread",
        content: "# findings",
        frontmatter: { thread: "no-such-thread" },
      }),
    ).rejects.toThrow(/unknown thread/i);
  });

  test("creates a research_run note and inserts research_runs row", async () => {
    await seedThread("arm-sve2");
    const res = await ingest.ingest({
      kind: "research_run",
      title: "sve2 survey",
      content: "## Summary\nFound three articles\n\n## Findings\nDetails",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: "2026-04-12T03:14:00.000Z",
        completed_at: "2026-04-12T03:14:48.000Z",
        duration_ms: 48000,
        model: "claude-opus-4-6",
        token_usage: { input: 100, output: 50 },
      },
    });
    expect(res.path).toMatch(/^notes\/research\/\d{4}-\d{2}-\d{2}-\d{4}-sve2-survey\.md$/);
    expect(res.side_effects?.research_run_id).toBeGreaterThan(0);
    expect(res.side_effects?.thread_updated).toBe("notes/threads/arm-sve2.md");

    const row = db
      .query("SELECT * FROM research_runs WHERE id = ?")
      .get(res.side_effects?.research_run_id) as any;
    expect(row.thread_slug).toBe("arm-sve2");
    expect(row.note_path).toBe(res.path);
    expect(row.status).toBe("success");
    expect(row.tokens_in).toBe(100);
  });

  test("updates thread frontmatter — last_run, run_count, modified", async () => {
    await seedThread("arm-sve2");
    const before = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    const beforeFm = parseFrontmatter(before).frontmatter;
    expect(beforeFm.run_count).toBeFalsy();

    await ingest.ingest({
      kind: "research_run",
      title: "run one",
      content: "## Summary\nfirst run",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    });

    const after = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    const afterFm = parseFrontmatter(after).frontmatter;
    expect(afterFm.run_count).toBe(1);
    expect(typeof afterFm.last_run).toBe("string");
  });

  test("appends a ## Runs summary block to the thread", async () => {
    await seedThread("arm-sve2");
    const res = await ingest.ingest({
      kind: "research_run",
      title: "the first run",
      content:
        "## Summary\nThis is the short summary of what was found today.\n\n## Findings\nLong body",
      frontmatter: {
        thread: "arm-sve2",
        status: "success",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    });
    const threadRaw = readFileSync(
      join(vaultPath, "notes/threads/arm-sve2.md"),
      "utf-8",
    );
    expect(threadRaw).toContain("## Runs");
    expect(threadRaw).toContain("[[");
    expect(threadRaw).toContain(
      "This is the short summary of what was found today.",
    );
  });
});
