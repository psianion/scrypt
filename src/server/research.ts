// src/server/research.ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { parseFrontmatter, stringifyFrontmatter } from "./parsers";

export interface ResearchRunRow {
  id: number;
  thread_slug: string;
  note_path: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
}

export interface InsertResearchRun {
  thread_slug: string;
  note_path: string;
  status: "success" | "partial" | "failed";
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
}

export function insertResearchRun(
  db: Database,
  rec: InsertResearchRun,
): number {
  const stmt = db.query(
    `INSERT INTO research_runs
     (thread_slug, note_path, status, started_at, completed_at, duration_ms, model, tokens_in, tokens_out, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    rec.thread_slug,
    rec.note_path,
    rec.status,
    rec.started_at,
    rec.completed_at ?? null,
    rec.duration_ms ?? null,
    rec.model ?? null,
    rec.tokens_in ?? null,
    rec.tokens_out ?? null,
    rec.error ?? null,
  );
  const row = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
  return row.id;
}

export async function appendRunToThread(opts: {
  vaultPath: string;
  threadSlug: string;
  runNoteFilename: string;
  summaryText: string;
  completedAt: string;
}): Promise<string> {
  const threadPath = `notes/threads/${opts.threadSlug}.md`;
  const absPath = join(opts.vaultPath, threadPath);
  if (!existsSync(absPath)) {
    throw new Error(`unknown thread: ${opts.threadSlug}`);
  }

  const raw = await Bun.file(absPath).text();
  const { frontmatter, body } = parseFrontmatter(raw);

  const runCount =
    typeof frontmatter.run_count === "number" ? frontmatter.run_count : 0;
  const newFm: Record<string, unknown> = {
    ...frontmatter,
    last_run: opts.completedAt,
    run_count: runCount + 1,
    modified: new Date().toISOString(),
  };

  const stamp = opts.runNoteFilename.slice(0, 15).replace(
    /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/,
    "$1 $2:$3",
  );
  const summaryBlock =
    `### ${stamp} — [[${opts.runNoteFilename}]]\n${opts.summaryText}\n`;

  const runsHeaderRegex = /\n## Runs\s*\n/;
  let newBody: string;
  if (runsHeaderRegex.test(body)) {
    newBody = body.replace(runsHeaderRegex, (m) => `${m}\n${summaryBlock}\n`);
  } else {
    newBody = `${body.trimEnd()}\n\n## Runs\n\n${summaryBlock}\n`;
  }

  const out = stringifyFrontmatter(newFm, newBody);
  await Bun.write(absPath, out);
  return threadPath;
}

export function extractRunSummary(content: string): string {
  const summaryMatch = content.match(/##\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n?$)/);
  const src = summaryMatch ? summaryMatch[1] : content;
  const normalized = src.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 200);
}
