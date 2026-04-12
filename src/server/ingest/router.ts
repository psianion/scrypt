// src/server/ingest/router.ts
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";
import { ActivityLog } from "../activity";
import { isValidKind, destinationFor, KINDS, type Kind } from "./kinds";
import { slugify } from "../slugger";
import { stringifyFrontmatter } from "../parsers";

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
      created: now.toISOString(),
      modified: now.toISOString(),
      source: "claude",
    };

    await mkdir(dirname(absPath), { recursive: true });
    const body = this.stripFrontmatterFromBody(req.content);
    const markdown = stringifyFrontmatter(fullFm, body);
    await Bun.write(absPath, markdown);

    this.deps.activity.record({
      action: existed ? "update" : "create",
      kind: req.kind,
      path: relPath,
      actor: "claude",
      meta: { bytes: markdown.length },
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

  private async ingestJournal(content: string, now: Date): Promise<IngestResult> {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const relPath = `journal/${y}-${m}-${d}.md`;
    const absPath = join(this.deps.vaultPath, relPath);
    const existed = existsSync(absPath);

    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const entryHeading = `## ${hh}:${mm} UTC`;
    const body = this.stripFrontmatterFromBody(content).trim();

    let markdown: string;
    if (existed) {
      const current = await Bun.file(absPath).text();
      markdown = current.trimEnd() + `\n\n${entryHeading}\n\n${body}\n`;
    } else {
      const fm: Record<string, unknown> = {
        title: `${y}-${m}-${d}`,
        kind: "journal",
        created: now.toISOString(),
        modified: now.toISOString(),
        source: "claude",
        tags: ["journal", "daily"],
      };
      markdown = stringifyFrontmatter(
        fm,
        `# ${y}-${m}-${d}\n\n${entryHeading}\n\n${body}\n`,
      );
    }

    await mkdir(dirname(absPath), { recursive: true });
    await Bun.write(absPath, markdown);

    this.deps.activity.record({
      action: existed ? "append" : "create",
      kind: "journal",
      path: relPath,
      actor: "claude",
      meta: { bytes: markdown.length },
    });

    return {
      path: relPath,
      kind: "journal",
      created: !existed,
    };
  }
}
