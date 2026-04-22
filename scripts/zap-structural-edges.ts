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
    // Tolerate pre-v2 schema: if the `graph_edges.tier` column is missing the
    // server hasn't booted on v2 yet and initSchema will drop the legacy
    // table outright on next start, making this script a no-op anyway.
    const cols = (
      db.query("PRAGMA table_info(graph_edges)").all() as { name: string }[]
    ).map((c) => c.name);
    if (cols.length === 0 || !cols.includes("tier")) {
      console.log(
        JSON.stringify(
          {
            vaultPath,
            dbPath,
            deleted: 0,
            note: "legacy schema — initSchema will drop graph_edges on server boot",
          },
          null,
          2,
        ),
      );
      return;
    }

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
