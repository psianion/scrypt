// tests/integration/three-doc-lineage.test.ts
//
// ingest-v3: end-to-end acceptance for the research → spec → plan lineage
// chain within a single project. Exercises create_note + add_edge, asserts
// the denormalized columns, the typed lineage edges, and the cross-project
// lineage rejection path.
import {
  test,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { SectionsRepo } from "../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../src/server/embeddings/chunks-repo";
import {
  EmbeddingService,
  type EngineLike,
} from "../../src/server/embeddings/service";
import { ProgressBus } from "../../src/server/embeddings/progress";
import { Idempotency } from "../../src/server/mcp/idempotency";
import { createNoteTool } from "../../src/server/mcp/tools/create-note";
import { addEdgeTool } from "../../src/server/mcp/tools/add-edge";
import type { ToolContext } from "../../src/server/mcp/types";
import { stringifyFrontmatter } from "../../src/server/parsers";
import { INGEST_VERSION } from "../../src/server/ingest/ingest-block";

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

function minimalIngestBlock(): Record<string, unknown> {
  return {
    original_filename: "x.md",
    original_path: "/abs/x.md",
    source_hash: "sha256:ab",
    source_size: 1,
    source_mtime: "2026-04-22T00:00:00Z",
    ingested_at: "2026-04-22T00:00:00Z",
    tokens: null,
    cost_usd: null,
    model: null,
    ingest_version: INGEST_VERSION,
  };
}

function withFrontmatter(
  fm: Record<string, unknown>,
  body: string,
): string {
  return stringifyFrontmatter(fm, body);
}

let vaultDir: string;
let ctx: ToolContext;

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "vault-e2e-"));
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
  } as unknown as ToolContext;
});

afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

test("research → spec → plan lineage (same project, same thread) produces typed edges", async () => {
  // 1. Research
  await createNoteTool.handler(
    ctx,
    {
      path: "projects/testp/research/findings.md",
      content: withFrontmatter(
        {
          title: "Findings",
          slug: "findings",
          project: "testp",
          doc_type: "research",
          thread: "auth-revamp",
          tags: [],
          ingest: minimalIngestBlock(),
        },
        "body",
      ),
      client_tag: "e2e-1",
    },
    "c",
  );

  // 2. Spec + derives-from research
  await createNoteTool.handler(
    ctx,
    {
      path: "projects/testp/spec/design.md",
      content: withFrontmatter(
        {
          title: "Design",
          slug: "design",
          project: "testp",
          doc_type: "spec",
          thread: "auth-revamp",
          tags: [],
          ingest: minimalIngestBlock(),
        },
        "body",
      ),
      client_tag: "e2e-2",
    },
    "c",
  );
  await addEdgeTool.handler(
    ctx,
    {
      source: "projects/testp/spec/design.md",
      target: "projects/testp/research/findings.md",
      tier: "connected",
      reason: "derives-from",
      client_tag: "ee-1",
    },
    "c",
  );

  // 3. Plan + implements spec
  await createNoteTool.handler(
    ctx,
    {
      path: "projects/testp/plan/rollout.md",
      content: withFrontmatter(
        {
          title: "Rollout",
          slug: "rollout",
          project: "testp",
          doc_type: "plan",
          thread: "auth-revamp",
          tags: [],
          ingest: minimalIngestBlock(),
        },
        "body",
      ),
      client_tag: "e2e-3",
    },
    "c",
  );
  await addEdgeTool.handler(
    ctx,
    {
      source: "projects/testp/plan/rollout.md",
      target: "projects/testp/spec/design.md",
      tier: "connected",
      reason: "implements",
      client_tag: "ee-2",
    },
    "c",
  );

  // 4. Notes table assertions
  const notes = ctx.db
    .query<
      {
        path: string;
        project: string | null;
        doc_type: string | null;
        thread: string | null;
      },
      []
    >(
      `SELECT path, project, doc_type, thread FROM notes ORDER BY path`,
    )
    .all();
  expect(notes.length).toBe(3);
  expect(
    notes.every(
      (n) => n.project === "testp" && n.thread === "auth-revamp",
    ),
  ).toBe(true);
  expect(notes.map((n) => n.doc_type).sort()).toEqual([
    "plan",
    "research",
    "spec",
  ]);

  // 5. Edge table assertions
  const edges = ctx.db
    .query<
      {
        source: string;
        target: string;
        tier: string;
        reason: string | null;
      },
      []
    >(
      `SELECT source, target, tier, reason FROM graph_edges
        WHERE reason IN ('derives-from','implements')`,
    )
    .all();
  expect(edges.length).toBe(2);
  expect(edges.find((e) => e.reason === "derives-from")).toMatchObject({
    source: "projects/testp/spec/design.md",
    target: "projects/testp/research/findings.md",
  });
  expect(edges.find((e) => e.reason === "implements")).toMatchObject({
    source: "projects/testp/plan/rollout.md",
    target: "projects/testp/spec/design.md",
  });

  // 6. Cross-project lineage rejection
  await createNoteTool.handler(
    ctx,
    {
      path: "projects/other/spec/otherspec.md",
      content: withFrontmatter(
        {
          title: "Other",
          slug: "otherspec",
          project: "other",
          doc_type: "spec",
          tags: [],
          ingest: minimalIngestBlock(),
        },
        "body",
      ),
      client_tag: "e2e-4",
    },
    "c",
  );
  await expect(
    addEdgeTool.handler(
      ctx,
      {
        source: "projects/other/spec/otherspec.md",
        target: "projects/testp/research/findings.md",
        tier: "connected",
        reason: "derives-from",
        client_tag: "ee-3",
      },
      "c",
    ),
  ).rejects.toThrow(/share project/);
});
