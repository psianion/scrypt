// src/cli/mcp-install.ts
//
// Cross-platform reimplementation of scripts/install-scrypt-mcp.sh. Pure helpers
// (arg builder, probe body, URL derivation) are unit-tested; runMcpInstall is the
// thin orchestrator. All shell-outs use argv arrays (no quoting bugs on
// PowerShell or bash).

import type { Ctx } from "./ctx";
import { parseEnv, getEnv } from "./env-file";
import { redactToken } from "./token";

export const MCP_PROBE_BODY = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" });

export interface McpAddOpts {
  name: string;
  url: string;
  scope: string;
  token?: string;
}

/** argv for `claude mcp add`. The Authorization header is a discrete argv
 *  element (only when a token exists) so no shell interpolation is needed. */
export function buildMcpAddArgs(opts: McpAddOpts): string[] {
  const args = ["mcp", "add", "--transport", "http", opts.name, opts.url, "--scope", opts.scope];
  if (opts.token) args.push("--header", `Authorization: Bearer ${opts.token}`);
  return args;
}

/** Derive the MCP URL from the configured port (critique L5 — don't hardcode 3777). */
export function mcpUrlFromPort(port: number): string {
  return `http://localhost:${port}/mcp`;
}

export interface McpInstallOpts {
  name?: string;
  url?: string;
  scope?: string;
  envPath: string;
}

export interface McpInstallResult {
  ok: boolean;
  code: number;
  message: string;
}

export async function runMcpInstall(ctx: Ctx, opts: McpInstallOpts): Promise<McpInstallResult> {
  const name = opts.name ?? "scrypt";
  const scope = opts.scope ?? "user";

  // Read token + port from .env to derive the URL and probe header.
  const envText = ctx.fs.read(opts.envPath) ?? "";
  const lines = parseEnv(envText);
  const token = getEnv(lines, "SCRYPT_AUTH_TOKEN")?.trim() || undefined;
  const port = Number(getEnv(lines, "SCRYPT_PORT")) || 3777;
  const url = opts.url ?? mcpUrlFromPort(port);

  // 1. claude present?
  if (!ctx.shell.which("claude")) {
    return { ok: false, code: 1, message: "claude CLI not on PATH — install Claude Code, then re-run `scrypt mcp install`." };
  }

  // 2. reachability probe (must be 200 before registering)
  ctx.log.info(`>> reachability check: POST ${url}`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let status = 0;
  try {
    const res = await ctx.http.request("POST", url, { headers, body: MCP_PROBE_BODY });
    status = res.status;
  } catch (e) {
    return { ok: false, code: 1, message: `server unreachable at ${url} (${String(e)}). Start it with \`scrypt up\` first.` };
  }
  if (status !== 200) {
    const hint = token ? `checked with Authorization: Bearer ${redactToken(token)}` : "no SCRYPT_AUTH_TOKEN found for the probe";
    return { ok: false, code: 1, message: `POST ${url} returned HTTP ${status} (${hint}). Is the server running and the token correct?` };
  }
  ctx.log.info(`   ok — POST ${url} -> 200`);

  // 3. idempotent remove
  ctx.log.info(`>> removing any existing '${name}' entry (--scope ${scope})`);
  await ctx.shell.run("claude", ["mcp", "remove", name, "--scope", scope]); // ignore failure

  // 4. add
  ctx.log.info(`>> adding '${name}' -> ${url} (--scope ${scope})${token ? ` with Authorization: Bearer ${redactToken(token)}` : " (no token)"}`);
  const add = await ctx.shell.run("claude", buildMcpAddArgs({ name, url, scope, token }));
  if (add.code !== 0) {
    return { ok: false, code: 1, message: `\`claude mcp add\` failed (exit ${add.code}): ${add.stderr.trim() || add.stdout.trim()}` };
  }

  // 5. verify (advisory only — output format is not contractually stable)
  await ctx.shell.run("claude", ["mcp", "get", name]);

  return { ok: true, code: 0, message: `installed '${name}'. The Scrypt tools should appear in a fresh Claude Code session.` };
}
