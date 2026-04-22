// scripts/zap-structural-edges.ts
//
// One-shot cleanup for graph-v2 (G2). Wikilink edge production was removed:
// no producer now writes (tier='connected', client_tag IS NULL) rows. This
// script deletes any residual rows of that shape from a vault DB so the
// graph reflects the new architecture before reingest.
//
// Usage:
//   bun run scripts/zap-structural-edges.ts [vaultPath]
//   bun run zap:structural [vaultPath]
//
// Default vaultPath: /Users/admin/scrypt-dnd-test
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_VAULT = "/Users/admin/scrypt-dnd-test";

function main(): void {
  const vaultArg = process.argv[2] ?? DEFAULT_VAULT;
  const vaultPath = resolve(vaultArg);
  const dbPath = join(vaultPath, ".scrypt", "scrypt.db");

  if (!existsSync(dbPath)) {
    console.error(`zap: no DB at ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  try {
    const before = (
      db
        .query<{ c: number }, []>(
          `SELECT count(*) as c FROM graph_edges
           WHERE client_tag IS NULL AND tier = 'connected'`,
        )
        .get() ?? { c: 0 }
    ).c;

    db.run(
      `DELETE FROM graph_edges
       WHERE client_tag IS NULL AND tier = 'connected'`,
    );

    console.log(
      JSON.stringify(
        { vaultPath, dbPath, deleted: before },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

main();
