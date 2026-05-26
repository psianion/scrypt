// scripts/scrypt-sync.ts
//
// Usage:
//   bun run scripts/scrypt-sync.ts <status|push|pull> --hub <url> [--vault <path>] [--local <url>]
// Env fallbacks: SCRYPT_VAULT_PATH, SCRYPT_HUB_URL, SCRYPT_LOCAL_URL,
//   SCRYPT_DB_PATH, SCRYPT_AUTH_TOKEN.
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { FileManager } from "../src/server/file-manager";
import { HubClient } from "../src/server/sync/hub-client";
import { runStatus, runPush, runPull, type SyncDeps, type RunResult } from "../src/server/sync/engine";
import type { SyncPlan } from "../src/server/sync/classify";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function printPlan(plan: SyncPlan) {
  console.log(`in sync: ${plan.inSync.length}`);
  console.log(`to push: ${plan.toPush.length}  ${plan.toPush.map((i) => i.path).join(", ")}`);
  console.log(`to pull: ${plan.toPull.length}  ${plan.toPull.map((i) => i.path).join(", ")}`);
  console.log(`skipped: ${plan.skipped.length}  ${plan.skipped.map((i) => `${i.path}(${i.reason})`).join(", ")}`);
  if (plan.clashes.length) {
    console.log(`CLASHES (resolve manually): ${plan.clashes.map((i) => i.path).join(", ")}`);
  }
}

function printResult(verb: string, r: RunResult) {
  console.log(`${verb}ed: ${r.pushed.length + r.pulled.length}`);
  if (r.clashes.length) console.log(`CLASHES skipped: ${r.clashes.join(", ")}`);
  if (r.skipped.length) console.log(`skipped: ${r.skipped.join(", ")}`);
  if (r.failed.length) {
    console.log(`FAILED: ${r.failed.length}`);
    for (const f of r.failed) console.log(`  ${f.path}: ${f.error}`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || !["status", "push", "pull"].includes(cmd)) {
    console.error("usage: scrypt-sync <status|push|pull> --hub <url> [--vault <path>] [--local <url>]");
    process.exit(2);
  }
  const vaultPath = flag("vault") ?? process.env.SCRYPT_VAULT_PATH;
  const hubUrl = flag("hub") ?? process.env.SCRYPT_HUB_URL;
  const localUrl = flag("local") ?? process.env.SCRYPT_LOCAL_URL ?? "http://localhost:3777";
  const token = process.env.SCRYPT_AUTH_TOKEN;
  if (!vaultPath) {
    console.error("missing --vault or SCRYPT_VAULT_PATH");
    process.exit(2);
  }
  if (!hubUrl) {
    console.error("missing --hub or SCRYPT_HUB_URL");
    process.exit(2);
  }

  const dbPath = flag("db") ?? process.env.SCRYPT_DB_PATH ?? join(vaultPath, "scrypt.db");
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA busy_timeout = 5000");
  db.run(`CREATE TABLE IF NOT EXISTS sync_state (
    note_path TEXT PRIMARY KEY, base_hash TEXT NOT NULL, synced_at INTEGER NOT NULL)`);

  const fm = new FileManager(vaultPath, dirname(dbPath));
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath,
    remote: new HubClient(hubUrl, token),
    local: new HubClient(localUrl), // localhost → no token needed
  };

  try {
    if (cmd === "status") {
      printPlan(await runStatus(deps));
    } else if (cmd === "push") {
      const r = await runPush(deps);
      printResult("push", r);
      if (r.failed.length) process.exit(1);
    } else {
      const r = await runPull(deps);
      printResult("pull", r);
      if (r.failed.length) process.exit(1);
    }
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
}

main();
