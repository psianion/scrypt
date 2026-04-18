// tests/server/mcp/tools/create-note.test.ts
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import {
  EmbeddingService,
  type EngineLike,
} from "../../../../src/server/embeddings/service";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { createNoteTool } from "../../../../src/server/mcp/tools/create-note";
import type { ToolContext } from "../../../../src/server/mcp/types";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

const SAMPLE = `---
title: Hello
---

## Alpha

alpha body

## Beta

beta body
`;

describe("create_note tool", () => {
  let vaultDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-vault-"));
    const db = new Database(":memory:");
    initSchema(db);
    const sections = new SectionsRepo(db);
    const metadata = new MetadataRepo(db);
    const embeddings = new ChunkEmbeddingsRepo(db);
    const bus = new ProgressBus();
    const engine = new FakeEngine();
    const embedService = new EmbeddingService({
      engine,
      repo: embeddings,
      bus,
      chunkOpts: { maxTokens: 450, overlapTokens: 50 },
    });
    ctx = {
      db,
      sections,
      metadata,
      tasks: new TasksRepo(db),
      embeddings,
      embedService,
      engine,
      bus,
      idempotency: new Idempotency(db),
      userId: "u1",
      vaultDir,
      scheduleGraphRebuild: () => {},
    };
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  test("writes the file and returns structural result", async () => {
    const res = await createNoteTool.handler(
      ctx,
      {
        path: "notes/hello.md",
        content: SAMPLE,
        client_tag: "tag-1",
      },
      "corr-1",
    );

    expect(res.note_path).toBe("notes/hello.md");
    expect(res.sections.length).toBe(2);
    expect(res.chunks_total).toBe(2);
    expect(res.chunks_embedded).toBe(2);
    expect(res.embedded).toBe(true);

    const onDisk = readFileSync(join(vaultDir, "notes/hello.md"), "utf8");
    expect(onDisk).toBe(SAMPLE);

    const sectRows = ctx.sections.listByNote("notes/hello.md");
    expect(sectRows.map((r) => r.heading_slug)).toEqual(["alpha", "beta"]);

    // graph_nodes mirror exists
    const nodes = ctx.db
      .query<{ id: string; label: string; kind: string }, []>(
        `SELECT id, label, kind FROM graph_nodes WHERE id = 'notes/hello.md'`,
      )
      .all();
    expect(nodes.length).toBe(1);
    expect(nodes[0].label).toBe("Hello");
  });

  test("rejects paths that escape the vault", async () => {
    let caught: unknown = null;
    try {
      await createNoteTool.handler(
        ctx,
        {
          path: "../etc/passwd",
          content: "bad",
          client_tag: "tag-2",
        },
        "corr-2",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("rejects paths that don't end in .md", async () => {
    let caught: unknown = null;
    try {
      await createNoteTool.handler(
        ctx,
        { path: "foo.txt", content: "x", client_tag: "tag-3" },
        "corr-3",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("idempotent by client_tag", async () => {
    const r1 = await createNoteTool.handler(
      ctx,
      { path: "n.md", content: SAMPLE, client_tag: "dup" },
      "corr-1",
    );
    const r2 = await createNoteTool.handler(
      ctx,
      { path: "n.md", content: SAMPLE, client_tag: "dup" },
      "corr-2",
    );
    expect(r2).toEqual(r1);
    expect(ctx.embeddings.countByModel("fake")).toBe(2);
  });

  test("re-calling with edited content prunes stale chunks", async () => {
    await createNoteTool.handler(
      ctx,
      { path: "n.md", content: SAMPLE, client_tag: "t1" },
      "c1",
    );
    const edited = `---
title: Hello
---

## Alpha

alpha only
`;
    await createNoteTool.handler(
      ctx,
      { path: "n.md", content: edited, client_tag: "t2" },
      "c2",
    );
    const rows = ctx.embeddings.listByNote("n.md", "fake");
    expect(rows.length).toBe(1);
    expect(rows[0].chunk_id).toBe("n_md:alpha");
  });

  test("wikilinks land as graph_edges with relation='wikilink'", async () => {
    const content = `---
title: A
---

See [[b]] and [[c]].
`;
    const res = await createNoteTool.handler(
      ctx,
      { path: "a.md", content, client_tag: "link-1" },
      "corr-x",
    );
    expect(res.edges_created).toBe(2);
    const edges = ctx.db
      .query<{ source: string; target: string; relation: string }, []>(
        `SELECT source, target, relation FROM graph_edges ORDER BY target`,
      )
      .all();
    expect(edges.map((e) => e.target)).toEqual(["b", "c"]);
    expect(edges.every((e) => e.relation === "wikilink")).toBe(true);
  });
});
