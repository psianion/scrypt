// tests/integration/wave8-scenario.test.ts
//
// End-to-end scenario: seeds a temp vault, builds a full MCP tool
// context, and walks the research flow from the spec's §12 success
// criteria. Uses a FakeEngine so the test stays fast and hermetic;
// real-model relevance is verified manually (plan Task 31 checklist).
import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { ToolRegistry } from "../../src/server/mcp/registry";
import { registerAllTools } from "../../src/server/mcp/tools";
import { reindexVault } from "../../src/server/embeddings/reindex";
import type { ToolContext } from "../../src/server/mcp/types";
import { MCP_ERROR } from "../../src/server/mcp/errors";

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      // A cheap deterministic hash-to-vector so different chunks have
      // different directions. Not semantically meaningful, but enough
      // to exercise the cosine plumbing.
      const v = new Float32Array(8);
      let h = 0;
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      for (let i = 0; i < 8; i++) {
        v[i] = Math.sin(h + i);
      }
      let n = 0;
      for (const x of v) n += x * x;
      const norm = Math.sqrt(n) || 1;
      for (let i = 0; i < 8; i++) v[i] /= norm;
      return v;
    });
  }
}

function seedVault(vaultDir: string): void {
  mkdirSync(join(vaultDir, "rl"), { recursive: true });
  mkdirSync(join(vaultDir, "baking"), { recursive: true });

  writeFileSync(
    join(vaultDir, "rl/actor-critic.md"),
    `---
title: Actor-Critic Methods
---

## Overview

Actor-critic combines policy gradients with value estimation.

## Advantages

Lower variance than REINFORCE.
`,
  );
  writeFileSync(
    join(vaultDir, "rl/policy-gradient.md"),
    `---
title: Policy Gradients
---

## Intro

Direct gradient on policy parameters.

## Math

Log-derivative trick under expectation.
`,
  );
  writeFileSync(
    join(vaultDir, "baking/sourdough.md"),
    `---
title: Sourdough
---

## Starter

Feed flour and water daily.

## Bake

Hot oven, steam early.
`,
  );
}

describe("Wave 8 end-to-end scenario", () => {
  let vaultDir: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  beforeAll(async () => {
    vaultDir = mkdtempSync(join(tmpdir(), "wave8-scenario-"));
    seedVault(vaultDir);

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
      userId: null,
      vaultDir,
      scheduleGraphRebuild: () => {},
    };

    registry = new ToolRegistry();
    registerAllTools(registry);

    await reindexVault({
      vaultDir,
      db,
      sections,
      metadata,
      embedService,
      engine,
    });
  });

  afterAll(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  test("reindex seeds chunk embeddings for every seeded note", () => {
    expect(ctx.embeddings.countByModel("fake")).toBeGreaterThanOrEqual(6);
  });

  test("create_note → update_metadata → add_summary → add_edge → get_note round-trip", async () => {
    const created = (await registry.call(
      "create_note",
      {
        path: "rl/new-paper.md",
        content: `---
title: New RL Paper
---

## Method

A new policy-gradient variant.

## Results

Outperforms baselines on Atari.
`,
        client_tag: "scenario-create",
        allow_nonstandard_path: true,
      },
      ctx,
      "corr-3",
    )) as {
      chunks_total: number;
      chunks_embedded: number;
      sections: { id: string; heading_text: string; level: number }[];
    };

    expect(created.chunks_total).toBe(2);
    expect(created.chunks_embedded).toBe(2);

    await registry.call(
      "update_note_metadata",
      {
        path: "rl/new-paper.md",
        description: "A new PG variant",
        themes: ["reinforcement learning"],
        client_tag: "scenario-meta",
      },
      ctx,
      "corr-4",
    );

    const methodSection = created.sections.find(
      (s) => s.heading_text === "Method",
    )!;
    await registry.call(
      "add_section_summary",
      {
        note_path: "rl/new-paper.md",
        heading_id: methodSection.id,
        summary: "Proposes new policy gradient variant",
        client_tag: "scenario-summary",
      },
      ctx,
      "corr-5",
    );

    await registry.call(
      "add_edge",
      {
        source: "rl/new-paper.md",
        target: "rl/actor-critic.md",
        tier: "mentions",
        reason: "new-paper extends actor-critic",
        client_tag: "scenario-edge",
      },
      ctx,
      "corr-6",
    );

    const note = (await registry.call(
      "get_note",
      { path: "rl/new-paper.md" },
      ctx,
      "corr-7",
    )) as {
      metadata: { description: string };
      sections: { heading_text: string; summary: string | null }[];
      outgoing_edges: { tier: string }[];
    };
    expect(note.metadata.description).toBe("A new PG variant");
    expect(
      note.sections.find((s) => s.heading_text === "Method")?.summary,
    ).toBe("Proposes new policy gradient variant");
    expect(
      note.outgoing_edges.some((e) => e.tier === "mentions"),
    ).toBe(true);
  });

  test("idempotency: same client_tag returns cached response", async () => {
    const input = {
      path: "rl/dup.md",
      content: `---\ntitle: D\n---\n\n## S\n\nbody\n`,
      client_tag: "scenario-dup",
      allow_nonstandard_path: true,
    };
    const r1 = await registry.call("create_note", input, ctx, "corr-a");
    const r2 = await registry.call("create_note", input, ctx, "corr-b");
    expect(r2).toEqual(r1);
  });

  test("find_similar surfaces other notes and self-excludes", async () => {
    const res = (await registry.call(
      "find_similar",
      {
        path: "rl/actor-critic.md",
        limit: 5,
        min_score: -1,
      },
      ctx,
      "corr-sim",
    )) as { results: { path: string }[] };
    const paths = res.results.map((r) => r.path);
    expect(paths).not.toContain("rl/actor-critic.md");
    expect(paths.length).toBeGreaterThan(0);
  });

  test("cluster_graph + get_report produce non-empty markdown", async () => {
    await registry.call("cluster_graph", {}, ctx, "corr-c");
    const r = (await registry.call("get_report", {}, ctx, "corr-d")) as {
      markdown: string;
    };
    expect(r.markdown).toContain("# Scrypt Graph Report");
    expect(r.markdown).toContain("## Hub Nodes");
  });

  test("SCRYPT_EMBED_DISABLE=1 makes semantic_search return EMBED_DISABLED", async () => {
    process.env.SCRYPT_EMBED_DISABLE = "1";
    try {
      let caught: unknown = null;
      try {
        await registry.call(
          "semantic_search",
          { query: "anything" },
          ctx,
          "corr-e",
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: MCP_ERROR.EMBED_DISABLED });
    } finally {
      delete process.env.SCRYPT_EMBED_DISABLE;
    }
  });

  test("walk_graph traverses semantic edges added by the flow", async () => {
    const r = (await registry.call(
      "walk_graph",
      { from: "rl/new-paper.md", depth: 2 },
      ctx,
      "corr-walk",
    )) as { nodes: { id: string }[] };
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain("rl/new-paper.md");
    expect(ids).toContain("rl/actor-critic.md");
  });
});
