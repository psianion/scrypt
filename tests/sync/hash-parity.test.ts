import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { FileManager } from "../../src/server/file-manager";
import { Indexer } from "../../src/server/indexer";
import { computeContentHash } from "../../src/server/sync/content-hash";

test("indexer-stored content_hash equals the engine's FileManager-based hash", async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), "parity-"));
  mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
  const rel = "note.md";
  writeFileSync(join(vaultDir, rel), "---\ntitle: Parity\n---\nbody text");
  const db = new Database(":memory:");
  initSchema(db);
  const fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
  const indexer = new Indexer(db, fm);
  await indexer.reindexNote(rel, { skipEmbed: true });
  const row = db.query("SELECT content_hash FROM graph_nodes WHERE note_path = ?").get(rel) as { content_hash: string } | null;
  const note = await fm.readNote(rel);
  const engineHash = computeContentHash(note!.frontmatter, note!.content);
  expect(row?.content_hash).toBe(engineHash);
  rmSync(vaultDir, { recursive: true, force: true });
});
