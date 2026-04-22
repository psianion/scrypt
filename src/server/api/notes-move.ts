// src/server/api/notes-move.ts
//
// ingest-v3: move a note between projects/doc_types. Rewrites the path
// segments, updates the project/doc_type frontmatter fields, repoints every
// graph_edges row to the new path, and updates the denormalized notes row.
// Intended to back the UI's "Move to project" / "Promote from _inbox" action.
import type { Database } from "bun:sqlite";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { buildVaultPath, parseVaultPath } from "../path/vault-path";
import { isDocType } from "../vocab/doc-types";
import { isValidProjectSlug } from "../vocab/reserved-projects";
import { parseFrontmatter, stringifyFrontmatter } from "../parsers";

export interface MoveCtx {
  db: Database;
  vaultDir: string;
  oldPath: string;
}

interface MoveBody {
  project?: string;
  doc_type?: string;
}

export async function moveNoteHandler(
  req: Request,
  ctx: MoveCtx,
): Promise<Response> {
  let body: MoveBody;
  try {
    body = (await req.json()) as MoveBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.project || !isValidProjectSlug(body.project)) {
    return Response.json({ error: "invalid project" }, { status: 400 });
  }
  if (!body.doc_type || !isDocType(body.doc_type)) {
    return Response.json({ error: "invalid doc_type" }, { status: 400 });
  }

  const parsed = parseVaultPath(ctx.oldPath);
  if (!parsed) {
    return Response.json(
      { error: "source path not in projects/ layout" },
      { status: 400 },
    );
  }

  const newPath = buildVaultPath(body.project, body.doc_type, parsed.slug);
  if (newPath === ctx.oldPath) {
    return Response.json({ error: "no-op move" }, { status: 400 });
  }

  const oldAbs = resolve(ctx.vaultDir, ctx.oldPath);
  const newAbs = resolve(ctx.vaultDir, newPath);

  if (existsSync(newAbs)) {
    return Response.json({ error: "target exists" }, { status: 409 });
  }
  if (!existsSync(oldAbs)) {
    return Response.json({ error: "source not found" }, { status: 404 });
  }

  const content = readFileSync(oldAbs, "utf8");
  const { frontmatter, body: md } = parseFrontmatter(content);
  frontmatter.project = body.project;
  frontmatter.doc_type = body.doc_type;
  const rewritten = stringifyFrontmatter(frontmatter, md);

  mkdirSync(dirname(newAbs), { recursive: true });
  writeFileSync(newAbs, rewritten, "utf8");
  try {
    unlinkSync(oldAbs);
  } catch {
    // best-effort; if the old file is gone already, continue with DB updates.
  }

  ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE notes SET path = ?, project = ?, doc_type = ? WHERE path = ?`,
      [newPath, body.project!, body.doc_type!, ctx.oldPath],
    );
    ctx.db.run(
      `UPDATE graph_nodes SET id = ?, note_path = ? WHERE id = ?`,
      [newPath, newPath, ctx.oldPath],
    );
    ctx.db.run(`UPDATE graph_edges SET source = ? WHERE source = ?`, [
      newPath,
      ctx.oldPath,
    ]);
    ctx.db.run(`UPDATE graph_edges SET target = ? WHERE target = ?`, [
      newPath,
      ctx.oldPath,
    ]);
  })();

  return Response.json({
    ok: true,
    old_path: ctx.oldPath,
    new_path: newPath,
  });
}
