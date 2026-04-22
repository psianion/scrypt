// tests/server/batch-ingest.test.ts
//
// ingest-v3: verify batch_ingest writes to projects/<project>/<doc_type>/<slug>.md
// and embeds a fully-populated ingest block in the frontmatter.
import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
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
import { batchIngestTool } from "../../src/server/mcp/tools/batch-ingest";
import type { ToolContext } from "../../src/server/mcp/types";

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

let srcDir: string;
let vaultDir: string;
let ctx: ToolContext;
let db: Database;

beforeEach(() => {
  srcDir = mkdtempSync(join(tmpdir(), "src-"));
  vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
  db = new Database(":memory:");
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
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(vaultDir, { recursive: true, force: true });
});

test("batch_ingest writes to projects/<project>/<doc_type>/<slug>.md with ingest block", async () => {
  writeFileSync(join(srcDir, "alpha.md"), "# Alpha\n\nbody alpha");
  writeFileSync(join(srcDir, "beta.md"), "# Beta\n\nbody beta");
  await batchIngestTool.handler(
    ctx,
    {
      source_dir: srcDir,
      project: "testp",
      doc_type: "research",
      client_tag: "b1",
    },
    "c",
  );
  const a = readFileSync(
    join(vaultDir, "projects/testp/research/alpha.md"),
    "utf8",
  );
  expect(a).toContain("project: testp");
  expect(a).toContain("doc_type: research");
  expect(a).toContain("ingest:");
  // YAML may quote values that contain ':' — match either shape.
  expect(a).toMatch(/source_hash:\s*'?sha256:/);
  expect(a).toContain("tokens: null");
  expect(a).toContain("ingest_version: 1");
  expect(
    existsSync(join(vaultDir, "projects/testp/research/beta.md")),
  ).toBe(true);
});

test("batch_ingest defaults doc_type to 'research' when omitted", async () => {
  writeFileSync(join(srcDir, "loose.md"), "# Loose\n\nbody");
  await batchIngestTool.handler(
    ctx,
    {
      source_dir: srcDir,
      project: "defp",
      client_tag: "b2",
    },
    "c",
  );
  expect(
    existsSync(join(vaultDir, "projects/defp/research/loose.md")),
  ).toBe(true);
});

test("batch_ingest denormalizes project/doc_type on the notes row", async () => {
  writeFileSync(join(srcDir, "gamma.md"), "# G\n\nbody");
  await batchIngestTool.handler(
    ctx,
    {
      source_dir: srcDir,
      project: "colp",
      doc_type: "spec",
      client_tag: "b3",
    },
    "c",
  );
  const row = db
    .query(`SELECT project, doc_type FROM notes WHERE path = ?`)
    .get("projects/colp/spec/gamma.md") as {
    project: string;
    doc_type: string;
  } | undefined;
  expect(row).toBeDefined();
  expect(row!.project).toBe("colp");
  expect(row!.doc_type).toBe("spec");
});
