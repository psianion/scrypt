// src/server/ingest/router.ts
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { ActivityLog } from "../activity";
import { isValidKind, destinationFor, KINDS, type Kind } from "./kinds";
import { slugify } from "../slugger";
import { parseFrontmatter } from "../parsers";
import {
  insertResearchRun,
  appendRunToThread,
  extractRunSummary,
} from "../research";

export interface IngestRequest {
  kind: Kind;
  title: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  replace?: boolean;
}

export interface IngestResult {
  path: string;
  kind: Kind;
  created: boolean;
  side_effects?: {
    thread_updated?: string;
    research_run_id?: number;
  };
}

export interface IngestDeps {
  vaultPath: string;
  db: Database;
  fm: FileManager;
  indexer: Indexer;
  activity: ActivityLog;
}

export class IngestError extends Error {
  constructor(
    message: string,
    public code: "bad_request" | "conflict" | "not_found" | "internal",
    public field?: string,
  ) {
    super(message);
  }
}

export class IngestRouter {
  constructor(private deps: IngestDeps) {}

  async ingest(req: IngestRequest): Promise<IngestResult> {
    if (!req.kind) throw new IngestError("kind is required", "bad_request", "kind");
    if (!isValidKind(req.kind)) {
      throw new IngestError(
        `unknown kind: ${req.kind}. valid: ${KINDS.join(", ")}`,
        "bad_request",
        "kind",
      );
    }
    if (!req.title || req.title.trim() === "") {
      throw new IngestError("title is required", "bad_request", "title");
    }
    if (!req.content || req.content.trim() === "") {
      throw new IngestError("content is required", "bad_request", "content");
    }

    const now = new Date();

    if (req.kind === "journal") {
      return this.ingestJournal(req.content, now);
    }

    const slug = slugify(req.title);

    if (req.kind === "research_run") {
      return this.ingestResearchRun(req, now, slug);
    }

    const relPath = destinationFor(req.kind, slug, now);
    const absPath = join(this.deps.vaultPath, relPath);

    const existed = existsSync(absPath);
    if (existed && !req.replace) {
      throw new IngestError(
        `file already exists: ${relPath}`,
        "conflict",
      );
    }

    const userFm = { ...(req.frontmatter ?? {}) };
    delete (userFm as any).created;
    delete (userFm as any).modified;
    delete (userFm as any).source;

    const fullFm: Record<string, unknown> = {
      ...userFm,
      title: req.title,
      kind: req.kind,
      source: "claude",
    };

    const body = this.stripFrontmatterFromBody(req.content);
    await this.deps.fm.writeNote(relPath, body, fullFm);

    this.deps.activity.record({
      action: existed ? "update" : "create",
      kind: req.kind,
      path: relPath,
      actor: "claude",
      meta: { bytes: body.length },
    });

    return {
      path: relPath,
      kind: req.kind,
      created: !existed,
    };
  }

  private stripFrontmatterFromBody(content: string): string {
    if (!content.startsWith("---\n")) return content;
    const end = content.indexOf("\n---\n", 4);
    if (end === -1) return content;
    return content.slice(end + 5);
  }

  private async ingestResearchRun(
    req: IngestRequest,
    now: Date,
    slug: string,
  ): Promise<IngestResult> {
    const userFm = { ...(req.frontmatter ?? {}) };
    const threadSlug = (userFm as any).thread;
    if (!threadSlug || typeof threadSlug !== "string") {
      throw new IngestError(
        "research_run requires frontmatter.thread",
        "bad_request",
        "thread",
      );
    }

    // Validate thread existence BEFORE any disk write or DB insert.
    // Otherwise a missing thread leaves an orphan note + research_runs row.
    const threadRel = `notes/threads/${threadSlug}.md`;
    const threadRaw = await this.deps.fm.readRaw(threadRel);
    if (threadRaw === null) {
      throw new IngestError(
        `unknown thread: ${threadSlug}`,
        "bad_request",
        "frontmatter.thread",
      );
    }

    const relPath = destinationFor("research_run", slug, now);
    const absPath = join(this.deps.vaultPath, relPath);
    const existed = existsSync(absPath);
    if (existed && !req.replace) {
      throw new IngestError(
        `file already exists: ${relPath}`,
        "conflict",
      );
    }

    delete (userFm as any).created;
    delete (userFm as any).modified;
    delete (userFm as any).source;

    const startedAt =
      typeof (userFm as any).started_at === "string"
        ? (userFm as any).started_at
        : now.toISOString();
    const completedAt =
      typeof (userFm as any).completed_at === "string"
        ? (userFm as any).completed_at
        : now.toISOString();
    const status =
      typeof (userFm as any).status === "string"
        ? ((userFm as any).status as "success" | "partial" | "failed")
        : "success";
    const durationMs =
      typeof (userFm as any).duration_ms === "number"
        ? (userFm as any).duration_ms
        : undefined;
    const model =
      typeof (userFm as any).model === "string"
        ? (userFm as any).model
        : undefined;
    const tokenUsage = (userFm as any).token_usage ?? {};
    const tokensIn =
      typeof tokenUsage?.input === "number" ? tokenUsage.input : undefined;
    const tokensOut =
      typeof tokenUsage?.output === "number" ? tokenUsage.output : undefined;
    const errorMsg =
      typeof (userFm as any).error === "string"
        ? (userFm as any).error
        : undefined;

    const fullFm: Record<string, unknown> = {
      ...userFm,
      title: req.title,
      kind: "research_run",
      thread: threadSlug,
      source: "claude",
    };

    const rawBody = this.stripFrontmatterFromBody(req.content);
    const linkLine = `Links: [[${threadSlug}]]`;
    const body = rawBody.includes(linkLine) ? rawBody : `${linkLine}\n\n${rawBody}`;

    // Write research note via FileManager so mergeServerTimestamps sets created/modified.
    await this.deps.fm.writeNote(relPath, body, fullFm);

    let runId: number | null = null;
    try {
      runId = insertResearchRun(this.deps.db, {
        thread_slug: threadSlug,
        note_path: relPath,
        status,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        error: errorMsg,
      });

      const runNoteFilename = basename(relPath, ".md");
      const summaryText = extractRunSummary(rawBody);
      const threadUpdated = await appendRunToThread({
        fm: this.deps.fm,
        threadSlug,
        runNoteFilename,
        summaryText,
        completedAt,
      });

      // research_run paths embed YYYY-MM-DD-HHMM + slug so collisions are
      // structurally near-impossible; always "create".
      this.deps.activity.record({
        action: "create",
        kind: "research_run",
        path: relPath,
        actor: "claude",
        meta: { bytes: body.length, thread: threadSlug },
      });
      this.deps.activity.record({
        action: "update",
        kind: "thread",
        path: threadUpdated,
        actor: "claude",
        meta: { research_run_id: runId },
      });

      return {
        path: relPath,
        kind: "research_run",
        created: !existed,
        side_effects: {
          thread_updated: threadUpdated,
          research_run_id: runId,
        },
      };
    } catch (err) {
      // Best-effort cleanup: remove the orphan note and DB row so a failed
      // thread update doesn't leave stale state behind.
      try {
        await unlink(absPath);
      } catch {}
      if (runId !== null) {
        try {
          this.deps.db
            .query("DELETE FROM research_runs WHERE id = ?")
            .run(runId);
        } catch {}
      }
      throw err;
    }
  }

  private async ingestJournal(content: string, now: Date): Promise<IngestResult> {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const relPath = `journal/${y}-${m}-${d}.md`;

    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const entryHeading = `## ${hh}:${mm} UTC`;
    const entryBody = this.stripFrontmatterFromBody(content).trim();

    const priorRaw = await this.deps.fm.readRaw(relPath);
    const existed = priorRaw !== null;

    let newBody: string;
    let fm: Record<string, unknown>;
    if (existed) {
      const parsed = parseFrontmatter(priorRaw!);
      fm = { ...parsed.frontmatter };
      newBody =
        parsed.body.trimEnd() + `\n\n${entryHeading}\n\n${entryBody}\n`;
    } else {
      fm = {
        title: `${y}-${m}-${d}`,
        kind: "journal",
        source: "claude",
        tags: ["journal", "daily"],
      };
      newBody = `# ${y}-${m}-${d}\n\n${entryHeading}\n\n${entryBody}\n`;
    }

    await this.deps.fm.writeNote(relPath, newBody, fm);

    this.deps.activity.record({
      action: existed ? "append" : "create",
      kind: "journal",
      path: relPath,
      actor: "claude",
      meta: { bytes: newBody.length },
    });

    return {
      path: relPath,
      kind: "journal",
      created: !existed,
    };
  }
}
