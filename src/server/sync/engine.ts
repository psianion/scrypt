// src/server/sync/engine.ts
//
// Orchestrates status/push/pull. Local hashes are computed from disk via
// FileManager (identical to the indexer's hash). Remote hashes come from
// the hub manifest. Push sends raw local bytes to the hub; pull sends raw
// hub bytes to the LOCAL server (so pulled notes get indexed+embedded).
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { FileManager } from "../file-manager";
import { computeContentHash } from "./content-hash";
import { classify, type SyncPlan } from "./classify";
import { loadBase, setBase } from "./state";
import type { HubClient } from "./hub-client";

export interface SyncDeps {
  db: Database;
  fm: FileManager;
  vaultPath: string;
  remote: HubClient;
  local: HubClient;
}

export interface RunResult {
  pushed: string[];
  pulled: string[];
  clashes: string[];
  skipped: string[];
  failed: { path: string; error: string }[];
}

async function localHashes(fm: FileManager): Promise<Map<string, string>> {
  const metas = await fm.listNotes();
  const map = new Map<string, string>();
  for (const meta of metas) {
    const note = await fm.readNote(meta.path);
    if (note) {
      map.set(meta.path, computeContentHash(note.frontmatter, note.content));
    }
  }
  return map;
}

async function buildPlan(
  deps: SyncDeps,
): Promise<{ plan: SyncPlan; local: Map<string, string>; remote: Map<string, string> }> {
  const local = await localHashes(deps.fm);
  const remote = await deps.remote.getManifest();
  const base = loadBase(deps.db);
  return { plan: classify(local, remote, base), local, remote };
}

export async function runStatus(deps: SyncDeps): Promise<SyncPlan> {
  return (await buildPlan(deps)).plan;
}

export async function runPush(deps: SyncDeps): Promise<RunResult> {
  const { plan, local } = await buildPlan(deps);
  const result: RunResult = {
    pushed: [],
    pulled: [],
    clashes: plan.clashes.map((c) => c.path),
    skipped: plan.skipped.map((s) => s.path),
    failed: [],
  };
  for (const item of plan.toPush) {
    try {
      const raw = await Bun.file(join(deps.vaultPath, item.path)).text();
      const hash = local.get(item.path)!;
      await deps.remote.createNote(item.path, raw, `sync-${hash}`);
      setBase(deps.db, item.path, hash);
      result.pushed.push(item.path);
    } catch (err) {
      result.failed.push({ path: item.path, error: String(err) });
    }
  }
  if (result.pushed.length > 0) {
    try {
      await deps.remote.rescanSimilarity(`sync-rescan-${Date.now()}`);
    } catch (err) {
      console.warn(`[sync] post-push rescan_similarity failed (non-fatal): ${String(err)}`);
    }
  }
  return result;
}

export async function runPull(deps: SyncDeps): Promise<RunResult> {
  const { plan, remote } = await buildPlan(deps);
  const result: RunResult = {
    pushed: [],
    pulled: [],
    clashes: plan.clashes.map((c) => c.path),
    skipped: plan.skipped.map((s) => s.path),
    failed: [],
  };
  for (const item of plan.toPull) {
    try {
      const raw = await deps.remote.getNoteContent(item.path);
      const hash = remote.get(item.path)!;
      await deps.local.createNote(item.path, raw, `sync-${hash}`);
      setBase(deps.db, item.path, hash);
      result.pulled.push(item.path);
    } catch (err) {
      result.failed.push({ path: item.path, error: String(err) });
    }
  }
  if (result.pulled.length > 0) {
    try {
      await deps.local.rescanSimilarity(`sync-rescan-${Date.now()}`);
    } catch (err) {
      console.warn(`[sync] post-pull rescan_similarity failed (non-fatal): ${String(err)}`);
    }
  }
  return result;
}
