// scripts/scrypt-mcp.ts
//
// Bun entry point for the stdio MCP transport. Launched by Claude Code
// as a child process via the config at ~/.config/claude-code/config.json.
import { runStdio } from "../src/server/mcp/transports/stdio";
import { ToolRegistry } from "../src/server/mcp/registry";
import { buildContextFromEnv } from "../src/server/mcp/context-factory";
import { registerAllTools } from "../src/server/mcp/tools";

async function main() {
  const registry = new ToolRegistry();
  registerAllTools(registry);
  const ctx = buildContextFromEnv(null);
  if (process.env.SCRYPT_EMBED_PREWARM === "1") {
    await ctx.engine.prewarm?.();
  }
  await runStdio(registry, ctx);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      where: "scrypt-mcp",
      err: String(err),
    }),
  );
  process.exit(1);
});
