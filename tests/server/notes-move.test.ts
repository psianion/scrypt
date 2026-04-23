// tests/server/notes-move.test.ts
//
// ingest-v3: verify POST /api/notes/:path/move rewrites path + frontmatter +
// graph_edges + notes row, and rejects invalid inputs / target collisions.
import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, seedEdge } from "../helpers/ctx";
import { moveNoteHandler } from "../../src/server/api/notes-move";
import { stringifyFrontmatter } from "../../src/server/parsers";
import { minimalIngestBlock } from "../helpers/ctx";

// seedNote doesn't write files for API tests (it seeds DB + vault, but the
// helper DOES write the file). Reuse that. We just need the file to exist at
// oldAbs before calling moveNoteHandler.

function writeVaultFile(
  vaultDir: string,
  relPath: string,
  project: string,
  doc_type: string,
  slug: string,
): void {
  const abs = resolve(vaultDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const fm = {
    title: slug,
    slug,
    project,
    doc_type,
    tags: [],
    ingest: minimalIngestBlock(),
  };
  writeFileSync(abs, stringifyFrontmatter(fm, `# ${slug}\n\nbody`), "utf8");
}

test("POST move rewrites path + frontmatter + edges + notes row", async () => {
  const ctx = buildCtx();
  try {
    const oldPath = seedNote(ctx, {
      project: "_inbox",
      doc_type: "research",
      slug: "loose",
    });
    const otherPath = seedNote(ctx, {
      project: "dbtmg",
      doc_type: "plan",
      slug: "p",
    });
    seedEdge(ctx, {
      source: otherPath,
      target: oldPath,
      tier: "mentions",
      reason: "mentions",
    });

    // seedNote already wrote the file — good.
    const req = new Request("http://x/api/notes/move", {
      method: "POST",
      body: JSON.stringify({ project: "dbtmg", doc_type: "research" }),
      headers: { "content-type": "application/json" },
    });
    const res = await moveNoteHandler(req, {
      db: ctx.db as unknown as Database,
      vaultDir: ctx.vaultDir,
      oldPath,
    });
    const body = (await res.json()) as {
      ok: boolean;
      new_path: string;
      old_path: string;
    };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.new_path).toBe("projects/dbtmg/research/loose.md");

    expect(existsSync(resolve(ctx.vaultDir, oldPath))).toBe(false);
    expect(
      existsSync(
        resolve(ctx.vaultDir, "projects/dbtmg/research/loose.md"),
      ),
    ).toBe(true);
    const moved = readFileSync(
      resolve(ctx.vaultDir, "projects/dbtmg/research/loose.md"),
      "utf8",
    );
    expect(moved).toContain("project: dbtmg");
    expect(moved).toContain("doc_type: research");

    const notesRow = ctx.db
      .query(
        `SELECT path, project, doc_type FROM notes WHERE path = ?`,
      )
      .get("projects/dbtmg/research/loose.md") as {
      path: string;
      project: string;
      doc_type: string;
    } | undefined;
    expect(notesRow).toBeDefined();
    expect(notesRow!.project).toBe("dbtmg");
    expect(notesRow!.doc_type).toBe("research");

    const edgeRow = ctx.db
      .query(
        `SELECT target FROM graph_edges WHERE source = ?`,
      )
      .get(otherPath) as { target: string } | undefined;
    expect(edgeRow).toBeDefined();
    expect(edgeRow!.target).toBe("projects/dbtmg/research/loose.md");
  } finally {
    ctx.cleanup();
  }
});

test("move rejects if target exists", async () => {
  const ctx = buildCtx();
  try {
    const oldPath = seedNote(ctx, {
      project: "_inbox",
      doc_type: "research",
      slug: "loose",
    });
    // Seed the target file on disk so the 409 branch trips.
    writeVaultFile(
      ctx.vaultDir,
      "projects/dbtmg/research/loose.md",
      "dbtmg",
      "research",
      "loose",
    );
    const res = await moveNoteHandler(
      new Request("http://x/", {
        method: "POST",
        body: JSON.stringify({ project: "dbtmg", doc_type: "research" }),
      }),
      {
        db: ctx.db as unknown as Database,
        vaultDir: ctx.vaultDir,
        oldPath,
      },
    );
    expect(res.status).toBe(409);
  } finally {
    ctx.cleanup();
  }
});

test("move rejects invalid doc_type", async () => {
  const ctx = buildCtx();
  try {
    const oldPath = seedNote(ctx, {
      project: "_inbox",
      doc_type: "research",
      slug: "x",
    });
    const res = await moveNoteHandler(
      new Request("http://x/", {
        method: "POST",
        body: JSON.stringify({ project: "p", doc_type: "xyzzy" }),
      }),
      {
        db: ctx.db as unknown as Database,
        vaultDir: ctx.vaultDir,
        oldPath,
      },
    );
    expect(res.status).toBe(400);
  } finally {
    ctx.cleanup();
  }
});

test("move rejects invalid project slug", async () => {
  const ctx = buildCtx();
  try {
    const oldPath = seedNote(ctx, {
      project: "_inbox",
      doc_type: "research",
      slug: "x",
    });
    const res = await moveNoteHandler(
      new Request("http://x/", {
        method: "POST",
        body: JSON.stringify({
          project: "NotValid!Slug",
          doc_type: "research",
        }),
      }),
      {
        db: ctx.db as unknown as Database,
        vaultDir: ctx.vaultDir,
        oldPath,
      },
    );
    expect(res.status).toBe(400);
  } finally {
    ctx.cleanup();
  }
});
