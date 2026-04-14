// scripts/scrypt-reindex.ts
//
// Offline backfill CLI. Run after:
//   - Changing SCRYPT_EMBED_MODEL to a new model
//   - Turning embeddings on for a vault that was previously un-embedded
//   - Debugging a corrupt chunk store
//
// Usage: bun run scrypt-reindex
import { reindexVault } from "../src/server/embeddings/reindex";
import { buildContextFromEnv } from "../src/server/mcp/context-factory";

async function main() {
  const ctx = buildContextFromEnv(null);
  await ctx.engine.prewarm?.();
  const res = await reindexVault({
    vaultDir: ctx.vaultDir,
    db: ctx.db,
    sections: ctx.sections,
    metadata: ctx.metadata,
    embedService: ctx.embedService,
    engine: ctx.engine,
    onProgress: (done, total, p) => {
      console.error(`[${done}/${total}] ${p}`);
    },
  });
  console.error(`done. processed=${res.processed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
