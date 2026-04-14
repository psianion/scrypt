// src/server/research.ts
import type { Database } from "bun:sqlite";
import type { FileManager } from "./file-manager";
import { parseFrontmatter } from "./parsers";

interface ResearchRunRow {
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

interface InsertResearchRun {
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
  fm: FileManager;
  threadSlug: string;
  runNoteFilename: string;
  summaryText: string;
  completedAt: string;
}): Promise<string> {
  const threadPath = `notes/threads/${opts.threadSlug}.md`;
  const raw = await opts.fm.readRaw(threadPath);
  if (raw === null) {
    throw new Error(`unknown thread: ${opts.threadSlug}`);
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  const runCount =
    typeof frontmatter.run_count === "number" ? frontmatter.run_count : 0;
  const newFm: Record<string, unknown> = {
    ...frontmatter,
    last_run: opts.completedAt,
    run_count: runCount + 1,
  };
  // Let FileManager.writeNote + mergeServerTimestamps bump `modified` itself,
  // so a client-supplied completed_at can never become the file's modified.
  delete (newFm as any).modified;

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

  await opts.fm.writeNote(threadPath, newBody, newFm);
  return threadPath;
}

export function extractRunSummary(content: string): string {
  const summaryMatch = content.match(/##\s+Summary\s*\n([\s\S]*?)(?=\n##\s|\n?$)/);
  const src = summaryMatch ? summaryMatch[1] : content;
  const normalized = src.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 200);
}
