// scripts/scrypt-sync.ts
//
// Usage:
//   bun run scripts/scrypt-sync.ts <status|push|pull> --hub <url> [--vault <path>] [--local <url>]
// Env fallbacks: SCRYPT_VAULT_PATH, SCRYPT_HUB_URL, SCRYPT_LOCAL_URL,
//   SCRYPT_DB_PATH, SCRYPT_AUTH_TOKEN.
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { createDatabase, initSchema } from "../src/server/db";
import { FileManager } from "../src/server/file-manager";
import { HubClient } from "../src/server/sync/hub-client";
import { runStatus, runPush, runPull, type SyncDeps, type RunResult } from "../src/server/sync/engine";
import type { SyncPlan } from "../src/server/sync/classify";

const USAGE = `scrypt-sync — git-style push/pull of your markdown vault to/from a hub.

Usage:
  bun run scripts/scrypt-sync.ts <command> [options]

Commands:
  status   Show the sync plan without making changes (in sync / to push / to pull / clashes).
  push     Push local changes to the hub (additive; clashes are skipped, never overwritten).
  pull     Pull hub changes into the local vault (clashes are skipped, resolve in-app).

Options:
  --vault <path>   Vault directory (env: SCRYPT_VAULT_PATH)
  --hub <url>      Hub base URL (env: SCRYPT_HUB_URL)
  --local <url>    Local server URL (env: SCRYPT_LOCAL_URL, default http://localhost:3777)
  --db <path>      sync_state DB path (env: SCRYPT_DB_PATH, default <vault>/.scrypt/scrypt.db)
  -h, --help       Show this help and exit.

Env fallbacks:
  SCRYPT_VAULT_PATH   default vault path
  SCRYPT_HUB_URL      default hub URL
  SCRYPT_LOCAL_URL    default local server URL (http://localhost:3777)
  SCRYPT_DB_PATH      default sync_state DB path (<vault>/.scrypt/scrypt.db)
  SCRYPT_AUTH_TOKEN   bearer token for the remote hub (localhost needs none)

Exit codes:
  0 success   1 push/pull had failures or threw   2 bad usage`;

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
  if (cmd === "--help" || cmd === "-h" || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!cmd || !["status", "push", "pull"].includes(cmd)) {
    console.error(USAGE);
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

  // Default to the SAME DB the server uses (<vault>/.scrypt/scrypt.db) so the
  // CLI and the in-app server share one sync_state and never drift. An explicit
  // --db / SCRYPT_DB_PATH override is honoured as-is.
  const dbPath = flag("db") ?? process.env.SCRYPT_DB_PATH ?? join(vaultPath, ".scrypt", "scrypt.db");
  const scryptPath = dirname(dbPath);
  mkdirSync(scryptPath, { recursive: true });
  // Route schema creation through the canonical initSchema() so the CLI's
  // sync_state (incl. base_content) can NEVER diverge from the server's.
  const db = createDatabase(dbPath);
  db.run("PRAGMA busy_timeout = 5000");
  initSchema(db);

  const fm = new FileManager(vaultPath, scryptPath);
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
