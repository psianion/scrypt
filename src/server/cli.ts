// src/server/cli.ts
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createDatabase, initSchema } from "./db";
import { ActivityLog } from "./activity";

export interface MaintenanceOpts {
  vaultPath: string;
  trashRetentionDays: number;
}

export interface MaintenanceResult {
  trashPruned: number;
  vacuumed: boolean;
  ftsRebuilt: boolean;
}

async function pruneTrash(
  vaultPath: string,
  retentionDays: number,
): Promise<number> {
  const trashDir = join(vaultPath, ".scrypt", "trash");
  if (!existsSync(trashDir)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(trashDir);
  let pruned = 0;
  for (const entry of entries) {
    const full = join(trashDir, entry);
    try {
      const s = await stat(full);
      if (s.isFile() && s.mtimeMs < cutoff) {
        await unlink(full);
        pruned++;
      }
    } catch {
      // ignore individual failures
    }
  }
  return pruned;
}

export async function runMaintenance(
  opts: MaintenanceOpts,
): Promise<MaintenanceResult> {
  const result: MaintenanceResult = {
    trashPruned: 0,
    vacuumed: false,
    ftsRebuilt: false,
  };

  result.trashPruned = await pruneTrash(opts.vaultPath, opts.trashRetentionDays);

  const dbPath = join(opts.vaultPath, ".scrypt", "scrypt.db");
  if (existsSync(dbPath)) {
    const db = createDatabase(dbPath);
    try {
      initSchema(db);
      db.run("VACUUM");
      result.vacuumed = true;

      try {
        db.run("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')");
        result.ftsRebuilt = true;
      } catch {
        // table may not exist yet in fresh vaults
      }

      const activity = new ActivityLog(db);
      activity.record({
        action: "update",
        kind: null,
        path: ".scrypt/scrypt.db",
        actor: "system",
        meta: result as unknown as Record<string, unknown>,
      });
    } finally {
      db.close();
    }
  }

  return result;
}

if (import.meta.main) {
  const sub = process.argv[2];
  if (sub !== "maintenance") {
    console.error("usage: bun src/server/cli.ts maintenance");
    process.exit(2);
  }
  const vaultPath = process.env.SCRYPT_VAULT_PATH || process.cwd();
  const retention = Number(process.env.SCRYPT_TRASH_RETENTION_DAYS) || 30;
  runMaintenance({ vaultPath, trashRetentionDays: retention })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error("maintenance failed:", e);
      process.exit(1);
    });
}
