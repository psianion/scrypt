// src/server/file-manager.ts
import { watch, type FSWatcher } from "node:fs";
import { mkdir, rename, readdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { parseFrontmatter, stringifyFrontmatter, mergeServerTimestamps } from "./parsers";
import type { Note, NoteMeta, FileEvent, IngestBlock } from "../shared/types";

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string") return v.length > 0 ? v : null;
  // YAML parses ISO-8601 timestamps as Date objects; serialise back to ISO
  // so API consumers see a stable string shape regardless of YAML flavour.
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

function ingestFromFrontmatter(fm: Record<string, unknown>): IngestBlock | null {
  const raw = fm.ingest;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    original_filename: stringOrNull(r.original_filename),
    original_path: stringOrNull(r.original_path),
    source_mtime: stringOrNull(r.source_mtime),
    ingested_at: stringOrNull(r.ingested_at),
    model: stringOrNull(r.model),
    source_hash: stringOrNull(r.source_hash),
    source_size: typeof r.source_size === "number" ? r.source_size : null,
    tokens: typeof r.tokens === "number" ? r.tokens : null,
    cost_usd: typeof r.cost_usd === "number" ? r.cost_usd : null,
    ingest_version: typeof r.ingest_version === "number"
      ? String(r.ingest_version)
      : stringOrNull(r.ingest_version),
  };
}

export class FileManager {
  private watcher: FSWatcher | null = null;

  constructor(
    private vaultPath: string,
    private scryptPath: string
  ) {}

  async readNote(path: string): Promise<Note | null> {
    const fullPath = join(this.vaultPath, path);
    const file = Bun.file(fullPath);
    if (!(await file.exists())) return null;

    const raw = await file.text();
    const { frontmatter, body, meta } = parseFrontmatter(raw);

    return {
      path,
      title: String(frontmatter.title || path.split("/").pop()?.replace(".md", "") || ""),
      tags: meta.tags,
      created: String(frontmatter.created || ""),
      modified: String(frontmatter.modified || ""),
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [],
      domain: meta.domain,
      subdomain: meta.subdomain,
      identifierTags: meta.identifierTags,
      topicTags: meta.topicTags,
      // ingest-v3: surface denormalised fields at top level so clients don't
      // have to dig into `frontmatter.*`. Frontmatter stays populated for
      // backwards-compatible callers.
      project: stringOrNull(frontmatter.project),
      doc_type: stringOrNull(frontmatter.doc_type),
      thread: stringOrNull(frontmatter.thread),
      slug: stringOrNull(frontmatter.slug),
      ingest: ingestFromFrontmatter(frontmatter),
      content: body,
      frontmatter,
    };
  }

  async readRaw(path: string): Promise<string | null> {
    const absPath = join(this.vaultPath, path);
    const file = Bun.file(absPath);
    if (!(await file.exists())) return null;
    return await file.text();
  }

  async writeNote(
    path: string,
    content: string,
    frontmatter?: Record<string, unknown>
  ): Promise<void> {
    const fullPath = join(this.vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });

    let existingCreated: string | null = null;
    const priorRaw = await this.readRaw(path);
    if (priorRaw !== null) {
      const { frontmatter: priorFm } = parseFrontmatter(priorRaw);
      const priorCreated = priorFm.created;
      if (typeof priorCreated === "string" && priorCreated.length > 0) {
        existingCreated = priorCreated;
      }
    }

    const fm = mergeServerTimestamps(frontmatter ?? {}, { existingCreated });

    const raw = stringifyFrontmatter(fm, content);
    await Bun.write(fullPath, raw);
  }

  async deleteNote(path: string): Promise<void> {
    const fullPath = join(this.vaultPath, path);
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}`);
    }

    const timestamp = Date.now();
    const filename = path.replace(/\//g, "__");
    const trashPath = join(this.scryptPath, "trash", `${timestamp}__${filename}`);
    await mkdir(dirname(trashPath), { recursive: true });
    await rename(fullPath, trashPath);
  }

  async listNotes(folder?: string): Promise<NoteMeta[]> {
    const searchDir = folder
      ? join(this.vaultPath, folder)
      : this.vaultPath;

    const notes: NoteMeta[] = [];
    await this.walkDir(searchDir, async (filePath) => {
      if (!filePath.endsWith(".md")) return;
      const relPath = relative(this.vaultPath, filePath);
      if (relPath.startsWith(".scrypt")) return;

      const note = await this.readNote(relPath);
      if (note) {
        const { content, frontmatter, ...meta } = note;
        notes.push(meta);
      }
    });

    return notes;
  }

  watchFiles(callback: (event: FileEvent) => void): void {
    this.watcher = watch(
      this.vaultPath,
      { recursive: true },
      async (_eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;
        if (filename.startsWith(".scrypt")) return;

        const fullPath = join(this.vaultPath, filename);
        const exists = await Bun.file(fullPath).exists();

        if (_eventType === "rename") {
          callback({ type: exists ? "create" : "delete", path: filename });
        } else {
          callback({ type: "modify", path: filename });
        }
      }
    );
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private async walkDir(
    dir: string,
    fn: (path: string) => Promise<void>
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await this.walkDir(full, fn);
      } else {
        await fn(full);
      }
    }
  }
}
