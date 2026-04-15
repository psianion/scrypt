// src/server/embeddings/recovery.ts
//
// Boot self-heal: walk the vault, parse each .md, fire-and-forget the
// existing EmbedderLike.embedNote() for every file. EmbeddingService's
// hasFreshChunk fast-path inside the worker makes already-embedded
// notes effectively free; only newly-added or hash-changed notes
// actually do real work.
//
// Yields to the event loop between IPC bursts so that recovery doesn't
// starve incoming HTTP traffic during boot.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { parseStructural } from "../indexer/structural-parse";
import type { EmbedderLike } from "./service";

export interface RecoveryOptions {
  vaultDir: string;
  client: EmbedderLike;
  log: (line: string) => void;
  // Yield to the event loop after this many enqueues so the API can
  // come up immediately even on a vault with thousands of files.
  yieldEvery?: number;
}

export interface RecoverySummary {
  total: number;
  failed: number;
}

function walkMarkdown(
  dir: string,
  acc: string[] = [],
  base = dir,
): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkMarkdown(abs, acc, base);
    } else if (entry.endsWith(".md")) {
      acc.push(relative(base, abs));
    }
  }
  return acc;
}

export async function recoverPendingEmbeds(
  opts: RecoveryOptions,
): Promise<RecoverySummary> {
  const yieldEvery = opts.yieldEvery ?? 50;
  let total = 0;
  let failed = 0;

  const paths = walkMarkdown(opts.vaultDir);
  for (const relPath of paths) {
    total += 1;
    try {
      const content = readFileSync(join(opts.vaultDir, relPath), "utf8");
      const parsed = parseStructural(relPath, content);
      opts.client.embedNote(parsed, randomUUID()).catch((err) => {
        failed += 1;
        opts.log(`embed-recover-fail ${relPath}: ${(err as Error).message}`);
      });
    } catch (err) {
      failed += 1;
      opts.log(
        `embed-recover-parse-fail ${relPath}: ${(err as Error).message}`,
      );
    }

    if (total % yieldEvery === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  // Wait one tick so any synchronous catches above have a chance to run
  // before we return the summary (the test asserts against it).
  await new Promise((r) => setImmediate(r));
  opts.log(`embed-recover: enqueued ${total} notes (${failed} failed)`);
  return { total, failed };
}
