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

export async function localHashes(fm: FileManager): Promise<Map<string, string>> {
  const metas = await fm.listNotes();
  const map = new Map<string, string>();
  for (const meta of metas) {
    // _index.md is a per-instance derived artifact regenerated locally on every
    // reindex. Its content_hash always differs between instances (fresh `modified`
    // timestamp), so it would perpetually clash. Exclude it from sync entirely.
    if (meta.path === "_index.md" || meta.path.endsWith("/_index.md")) continue;
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
      setBase(deps.db, item.path, hash, raw); // store base_content for 3-way clash merge
      result.pushed.push(item.path);
    } catch (err) {
      result.failed.push({ path: item.path, error: String(err) });
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
      setBase(deps.db, item.path, hash, raw); // store base_content for 3-way clash merge
      result.pulled.push(item.path);
    } catch (err) {
      result.failed.push({ path: item.path, error: String(err) });
    }
  }
  return result;
}

export async function runLocalStatus(
  db: Database,
  fm: FileManager,
): Promise<{ notPushed: string[] }> {
  const local = await localHashes(fm);
  const base = loadBase(db);
  const notPushed: string[] = [];
  for (const [path, hash] of local) {
    if (base.get(path) !== hash) notPushed.push(path); // changed since last sync, or never synced
  }
  return { notPushed };
}

export async function runSync(deps: SyncDeps): Promise<RunResult> {
  const local = await localHashes(deps.fm);
  const remoteManifest = await deps.remote.getManifest();
  const plan = classify(local, remoteManifest, loadBase(deps.db));
  const result: RunResult = { pushed: [], pulled: [], clashes: plan.clashes.map((c) => c.path), skipped: plan.skipped.map((s) => s.path), failed: [] };

  for (const item of plan.toPush) {
    try {
      const raw = await Bun.file(join(deps.vaultPath, item.path)).text();
      await deps.remote.createNote(item.path, raw, `sync-${local.get(item.path)}`);
      setBase(deps.db, item.path, local.get(item.path)!, raw);
      result.pushed.push(item.path);
    } catch (e) { result.failed.push({ path: item.path, error: String(e) }); }
  }
  for (const item of plan.toPull) {
    try {
      const raw = await deps.remote.getNoteContent(item.path);
      await deps.local.createNote(item.path, raw, `sync-${remoteManifest.get(item.path)}`);
      setBase(deps.db, item.path, remoteManifest.get(item.path)!, raw);
      result.pulled.push(item.path);
    } catch (e) { result.failed.push({ path: item.path, error: String(e) }); }
  }
  return result;
}

export async function resolveClash(deps: SyncDeps, path: string, merged: string): Promise<void> {
  await deps.local.createNote(path, merged, `resolve-${Date.now()}`);   // 1. write + reindex locally
  await deps.remote.createNote(path, merged, `resolve-${Date.now()}`);  // 2. push merged to hub
  const note = await deps.fm.readNote(path);                            // 3. canonical local hash
  const hash = note ? computeContentHash(note.frontmatter, note.content) : computeContentHash({}, merged);
  setBase(deps.db, path, hash, merged);                                 // 4. base = merged
}
