// tests/server/mcp/tools/lint-vault.test.ts
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { initSchema } from "../../../../src/server/db";
import { lintVaultTool } from "../../../../src/server/mcp/tools/lint-vault";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import type { ToolContext } from "../../../../src/server/mcp/types";

const DAY_MS = 86_400_000;

describe("lint_vault", () => {
  let ctx: ToolContext;
  let db: Database;
  let vaultDir: string;

  function addNote(
    path: string,
    opts: {
      title?: string;
      project?: string | null;
      doc_type?: string | null;
      created?: string | null;
    } = {},
  ): void {
    const title = opts.title ?? path;
    db.query(
      `INSERT INTO notes (path, title, project, doc_type, created, modified)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      path,
      title,
      opts.project ?? null,
      opts.doc_type ?? null,
      opts.created ?? null,
      opts.created ?? null,
    );
    db.query(
      `INSERT INTO graph_nodes (id, kind, note_path, label) VALUES (?, 'note', ?, ?)`,
    ).run(path, path, title);
    // Mirror the indexer's link_index rows (basename + title slug).
    const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
    const titleSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const ins = db.query(
      `INSERT OR IGNORE INTO link_index (slug, path, title) VALUES (?, ?, ?)`,
    );
    ins.run(basename, path, title);
    if (titleSlug && titleSlug !== basename) ins.run(titleSlug, path, title);
  }

  function addEdge(source: string, target: string, tier = "mentions", reason: string | null = null): void {
    db.query(
      `INSERT INTO graph_edges (source, target, tier, reason) VALUES (?, ?, ?, ?)`,
    ).run(source, target, tier, reason);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-lint-"));
    ctx = {
      db,
      sections: new SectionsRepo(db),
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings: new ChunkEmbeddingsRepo(db),
      embedService: {} as unknown as ToolContext["embedService"],
      engine: { model: "x", batchSize: 1, async embedBatch() { return []; } },
      bus: new ProgressBus(),
      idempotency: new Idempotency(db),
      userId: null,
      vaultDir,
      scheduleGraphRebuild: () => {},
    };
  });

  afterEach(() => {
    db.close();
    rmSync(vaultDir, { recursive: true, force: true });
  });

  test("empty vault yields zero findings everywhere", async () => {
    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.generated_at).toBeString();
    for (const key of [
      "orphans",
      "broken_links",
      "entities_without_pages",
      "superseded_still_cited",
      "stale_inbox",
    ] as const) {
      expect(r.counts[key]).toBe(0);
      expect(r[key]).toEqual([]);
      expect(r.truncated[key]).toBe(false);
    }
  });

  test("orphans: edge-less notes flagged; journal/sessionlog and _index.md excluded", async () => {
    addNote("projects/p/research/lonely.md", { title: "Lonely", doc_type: "research" });
    addNote("projects/p/journal/day.md", { doc_type: "journal" });
    addNote("projects/p/sessionlog/log.md", { doc_type: "sessionlog" });
    addNote("projects/p/_index.md");
    addNote("projects/p/spec/linked.md", { doc_type: "spec" });
    addNote("projects/p/plan/other.md", { doc_type: "plan" });
    addEdge("projects/p/spec/linked.md", "projects/p/plan/other.md");

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.orphans).toBe(1);
    expect(r.orphans[0]).toEqual({
      path: "projects/p/research/lonely.md",
      title: "Lonely",
      doc_type: "research",
    });
  });

  test("broken_links: edges whose target is no existing note", async () => {
    addNote("projects/p/research/a.md");
    addNote("projects/p/research/b.md");
    addEdge("projects/p/research/a.md", "projects/p/research/b.md"); // fine
    addEdge("projects/p/research/a.md", "projects/p/research/gone.md", "mentions", "reference");

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.broken_links).toBe(1);
    expect(r.broken_links[0]).toMatchObject({
      source: "projects/p/research/a.md",
      target: "projects/p/research/gone.md",
    });
  });

  test("entities_without_pages: >=3 mentions and no matching title/slug", async () => {
    for (const n of ["a", "b", "c"]) addNote(`projects/p/research/${n}.md`);
    addNote("projects/p/guide/existing-page.md", { title: "Existing Page" });
    for (const n of ["a", "b", "c"]) {
      ctx.metadata.upsert(`projects/p/research/${n}.md`, {
        entities: [
          { name: "Kalman Filter", kind: "concept" },
          { name: "Existing Page", kind: "concept" }, // has a page → excluded
        ],
      });
    }
    // Only 2 mentions → below threshold.
    ctx.metadata.upsert("projects/p/research/a.md", {
      entities: [
        { name: "Kalman Filter", kind: "concept" },
        { name: "Rare Thing", kind: "concept" },
      ],
    });
    ctx.metadata.upsert("projects/p/research/b.md", {
      entities: [
        { name: "Kalman Filter", kind: "concept" },
        { name: "Rare Thing", kind: "concept" },
      ],
    });

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.entities_without_pages).toBe(1);
    expect(r.entities_without_pages[0]).toEqual({
      entity: "Kalman Filter",
      mention_count: 3,
      sample_paths: [
        "projects/p/research/a.md",
        "projects/p/research/b.md",
        "projects/p/research/c.md",
      ],
    });
  });

  test("superseded_still_cited: only when a third party still points at the old note", async () => {
    addNote("projects/p/spec/old.md");
    addNote("projects/p/spec/new.md");
    addNote("projects/p/plan/citer.md");
    addNote("projects/p/spec/old2.md");
    addNote("projects/p/spec/new2.md");
    addEdge("projects/p/spec/new.md", "projects/p/spec/old.md", "connected", "supersedes");
    addEdge("projects/p/plan/citer.md", "projects/p/spec/old.md", "mentions", "cites");
    // old2 is superseded but nobody else cites it → not flagged.
    addEdge("projects/p/spec/new2.md", "projects/p/spec/old2.md", "connected", "supersedes");

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.superseded_still_cited).toBe(1);
    expect(r.superseded_still_cited[0]).toEqual({
      path: "projects/p/spec/old.md",
      superseders: ["projects/p/spec/new.md"],
      citing_paths: ["projects/p/plan/citer.md"],
    });
  });

  test("stale_inbox: DB-timestamp fallback and inbox_max_age_days input", async () => {
    const old = new Date(Date.now() - 30 * DAY_MS).toISOString();
    addNote("projects/_inbox/research/old.md", {
      title: "Old",
      project: "_inbox",
      created: old,
    });
    addNote("projects/_inbox/research/fresh.md", {
      project: "_inbox",
      created: new Date().toISOString(),
    });

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.stale_inbox).toBe(1);
    expect(r.stale_inbox[0].path).toBe("projects/_inbox/research/old.md");
    expect(r.stale_inbox[0].age_days).toBeGreaterThanOrEqual(29);

    const relaxed = await lintVaultTool.handler(ctx, { inbox_max_age_days: 60 }, "c");
    expect(relaxed.counts.stale_inbox).toBe(0);
  });

  test("stale_inbox: ingest.ingested_at frontmatter wins over fresh created", async () => {
    const path = "projects/_inbox/research/ingested.md";
    addNote(path, { project: "_inbox", created: new Date().toISOString() });
    const ingestedAt = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const full = join(vaultDir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      `---\ntitle: Ingested\ncreated: ${new Date().toISOString()}\ningest:\n  ingested_at: ${ingestedAt}\n---\nbody\n`,
    );

    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.stale_inbox).toBe(1);
    expect(r.stale_inbox[0].age_days).toBe(10);
  });

  test("lists cap at 50 with truncated flag; counts stay full", async () => {
    for (let i = 0; i < 60; i++) {
      addNote(`projects/p/research/orphan-${String(i).padStart(2, "0")}.md`);
    }
    const r = await lintVaultTool.handler(ctx, {}, "c");
    expect(r.counts.orphans).toBe(60);
    expect(r.orphans.length).toBe(50);
    expect(r.truncated.orphans).toBe(true);
  });
});
