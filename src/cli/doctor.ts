// src/cli/doctor.ts
//
// Health + security audit. The evaluators are PURE (facts -> findings) and carry
// the load-bearing security knowledge verified in the server source:
//   - config.ts:45  exposure rule (NODE_ENV=production OR non-loopback bind)
//   - index.ts:338  Bun.serve has no hostname -> native binds all interfaces
//   - auth.ts       loopback trust keyed on the real socket peer address
//                   (server.requestIP), not the spoofable Host header
//   - DB path hardcoded <vault>/.scrypt/scrypt.db (ignores SCRYPT_DB_PATH)
// gatherFacts() is the thin impure layer that probes the running server + tools.

import { join } from "node:path";
import { networkInterfaces } from "node:os";
import type { Ctx } from "./ctx";
import { parseEnv, getEnv } from "./env-file";
import { isWeakToken } from "./token";
import { MCP_PROBE_BODY } from "./mcp-install";
import type { Profile } from "./runtime-detect";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  remedy: string;
  passed: boolean;
}

const LOOPBACK_BINDS = new Set(["127.0.0.1", "localhost", "::1", ""]);
const MAC_INGEST_DEFAULT = "/Users/admin/Desktop/Files";

export interface DoctorFacts {
  profile: Profile | "unknown";
  port: number;
  envExists: boolean;
  envToken: string | undefined;
  bindAddr: string;
  nodeEnvProduction: boolean;
  healthLocal: boolean;
  mcpLocal: boolean | null;
  offBoxReachable: boolean | null;
  routableIp: string | null;
  dockerProfile: boolean;
  dockerDaemon: boolean | null;
  /** docker profile on a non-arm64 host (the committed compose pins arm64). */
  archPinIssue: boolean;
  overrideExists: boolean;
  ingestDir: string | undefined;
  vaultPath: string;
  stdioVaultDir: string | undefined;
  stdioDbPath: string | undefined;
  claudePresent: boolean;
  mcpRegistered: boolean | null;
  tailscale: { installed: boolean; up: boolean; ip: string | null };
  envGitIgnored: boolean | null;
  gitAutocommitRaw: string | undefined;
  hubUrl: string | undefined;
  hubTokenValid: boolean | null;
}

function isLoopback(addr: string): boolean {
  return LOOPBACK_BINDS.has(addr.trim());
}

/** PURE: classify facts into findings. */
export function evaluateDoctor(f: DoctorFacts): Finding[] {
  const out: Finding[] = [];
  const exposed = f.nodeEnvProduction || !isLoopback(f.bindAddr);

  // 1. liveness
  if (f.profile === "vps") {
    out.push({ id: "liveness", severity: "INFO", title: "No local server (vps/sync profile)", detail: "This machine syncs to a remote hub; no local server expected.", remedy: "", passed: true });
  } else {
    out.push(
      f.healthLocal
        ? { id: "liveness", severity: "INFO", title: "Server is up", detail: `GET localhost:${f.port}/health -> {ok:true}`, remedy: "", passed: true }
        : { id: "liveness", severity: "HIGH", title: "Server not reachable", detail: `GET localhost:${f.port}/health failed.`, remedy: "Run `scrypt up`.", passed: false },
    );
  }

  // 2. MCP HTTP reachable (only meaningful if server should be up)
  if (f.profile !== "vps" && f.healthLocal && f.mcpLocal === false) {
    out.push({ id: "mcp-http", severity: "HIGH", title: "MCP endpoint not responding", detail: `POST localhost:${f.port}/mcp did not return 200.`, remedy: "Check server logs; re-run `scrypt up`.", passed: false });
  }

  // 3. exposed without token -> server THROWS at boot (config.ts:46)
  if (exposed && !f.envToken) {
    out.push({ id: "exposed-no-token", severity: "CRITICAL", title: "Exposed without a token", detail: `NODE_ENV=production or non-loopback SCRYPT_BIND_ADDR (${f.bindAddr}) requires a token; loadConfig() throws without one.`, remedy: "Set SCRYPT_AUTH_TOKEN (run `scrypt token rotate`).", passed: false });
  }

  // 4. native binds all interfaces (index.ts:338) and is reachable off-box.
  // The Host-spoof auth bypass this used to compound with is fixed — checkAuth()
  // now keys loopback trust off the real socket peer address (server.requestIP),
  // not the client-supplied Host header, so a token is still enforced for
  // non-loopback callers. The remaining exposure is purely "more surface area
  // reachable", already priced into severity via whether a token is set.
  if (f.profile === "native" && f.offBoxReachable) {
    out.push({
      id: "native-offbox",
      severity: f.envToken ? "HIGH" : "CRITICAL",
      title: "Native server reachable off-box",
      detail: `Bun.serve has no hostname, so native mode binds all interfaces regardless of SCRYPT_BIND_ADDR. Reachable at ${f.routableIp}:${f.port}. A configured token is still required for non-loopback callers (auth keys off the real socket peer, not Host).`,
      remedy: "Use the docker or vps profile, or firewall the port, to reduce exposed surface.",
      passed: false,
    });
  }

  // 6. weak / placeholder token
  if (f.envToken && isWeakToken(f.envToken)) {
    out.push({ id: "weak-token", severity: "HIGH", title: "Weak or placeholder token", detail: "SCRYPT_AUTH_TOKEN is the placeholder, too short, or low-entropy.", remedy: "Run `scrypt token rotate`.", passed: false });
  }

  // 7. token correctness — only verifiable from a non-loopback caller
  if (f.hubUrl) {
    if (f.hubTokenValid === true) out.push({ id: "hub-token", severity: "INFO", title: "Hub token valid", detail: "GET <hub>/api/sync/manifest returned 200.", remedy: "", passed: true });
    else if (f.hubTokenValid === false) out.push({ id: "hub-token", severity: "HIGH", title: "Hub rejected the token", detail: "GET <hub>/api/sync/manifest returned 401.", remedy: "Fix SCRYPT_AUTH_TOKEN to match the hub.", passed: false });
  } else {
    out.push({ id: "token-unverifiable", severity: "INFO", title: "Token correctness unverifiable locally", detail: "Localhost bypasses auth (loopback), so the token cannot be validated from this machine.", remedy: "Probe via the hub/tailnet (`scrypt doctor --hub <url>`).", passed: true });
  }

  // 8. docker arch / arm64 pin
  if (f.dockerProfile) {
    out.push(
      f.dockerDaemon === false
        ? { id: "docker-daemon", severity: "HIGH", title: "Docker daemon not reachable", detail: "`docker info` failed.", remedy: "Start Docker Desktop.", passed: false }
        : { id: "docker-daemon", severity: "INFO", title: "Docker daemon reachable", detail: "", remedy: "", passed: true },
    );
    if (f.archPinIssue) {
      out.push({ id: "docker-arch-pin", severity: f.overrideExists ? "INFO" : "HIGH", title: "arm64 platform pin on non-arm host", detail: "docker-compose.yml pins linux/arm64; on this host the image won't build without an override.", remedy: "Re-run `scrypt init` to generate docker-compose.override.yml.", passed: f.overrideExists });
    }
    // 9. ingest path sanity
    if (!f.ingestDir || f.ingestDir === MAC_INGEST_DEFAULT) {
      out.push({ id: "ingest-path", severity: "MEDIUM", title: "Ingest mount uses the macOS default", detail: "SCRYPT_INGEST_DIR is unset or the macOS placeholder; the mount will be empty/missing elsewhere.", remedy: "Set SCRYPT_INGEST_DIR to a real local path.", passed: false });
    }
  }

  // 10. stdio/HTTP DB divergence (compare resolved effective paths incl. defaults)
  const httpDb = join(f.vaultPath, ".scrypt", "scrypt.db");
  const stdioVault = f.stdioVaultDir ?? "./vault";
  const stdioDb = f.stdioDbPath ?? "./scrypt.db";
  if (f.stdioVaultDir || f.stdioDbPath) {
    // explicitly configured stdio transport that diverges from HTTP
    if (stdioDb !== httpDb) {
      out.push({ id: "db-divergence", severity: "HIGH", title: "stdio/HTTP databases diverge", detail: `HTTP uses ${httpDb}; stdio uses ${stdioDb} (vault ${stdioVault}). Switching transports = split-brain.`, remedy: "Align SCRYPT_VAULT_DIR/SCRYPT_DB_PATH with the HTTP vault, or prefer the HTTP transport.", passed: false });
    }
  }

  // 11. claude present + mcp registered
  out.push(
    f.claudePresent
      ? { id: "claude", severity: "INFO", title: "Claude CLI present", detail: "", remedy: "", passed: true }
      : { id: "claude", severity: "MEDIUM", title: "Claude CLI not found", detail: "`scrypt mcp install` needs the Claude Code CLI.", remedy: "Install Claude Code.", passed: false },
  );
  if (f.claudePresent && f.mcpRegistered === false) {
    out.push({ id: "mcp-registered", severity: "MEDIUM", title: "Scrypt MCP not registered", detail: "`claude mcp get scrypt` did not find an entry.", remedy: "Run `scrypt mcp install`.", passed: false });
  }

  // 12. tailscale (HIGH only for vps)
  if (f.profile === "vps" || f.hubUrl) {
    if (!f.tailscale.up) out.push({ id: "tailscale", severity: "HIGH", title: "Tailscale not connected", detail: "The vps/sync profile relies on the tailnet to reach the hub.", remedy: "Run `tailscale up`.", passed: false });
    else out.push({ id: "tailscale", severity: "INFO", title: "Tailscale connected", detail: f.tailscale.ip ?? "", remedy: "", passed: true });
  }

  // 13. .env git-tracked
  if (f.envExists && f.envGitIgnored === false) {
    out.push({ id: "env-tracked", severity: "CRITICAL", title: ".env is not gitignored", detail: "Your token may be committed to git history.", remedy: "Add `.env` to .gitignore and rotate the token (`scrypt token rotate`).", passed: false });
  }

  // 14. git-autocommit misconfig (must be exact '1' — config.ts:61)
  if (f.gitAutocommitRaw !== undefined && f.gitAutocommitRaw !== "1" && f.gitAutocommitRaw !== "0" && f.gitAutocommitRaw !== "") {
    out.push({ id: "git-autocommit", severity: "INFO", title: "SCRYPT_GIT_AUTOCOMMIT won't enable", detail: `Value "${f.gitAutocommitRaw}" is not "1"; the loop only enables on exactly "1".`, remedy: "Use SCRYPT_GIT_AUTOCOMMIT=1.", passed: false });
  }

  return out;
}

/** Exit 1 if any unpassed CRITICAL/HIGH finding exists. */
export function doctorExitCode(findings: Finding[]): number {
  return findings.some((x) => !x.passed && (x.severity === "CRITICAL" || x.severity === "HIGH")) ? 1 : 0;
}

const SEV_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
const SEV_ICON: Record<Severity, string> = { CRITICAL: "✖", HIGH: "✖", MEDIUM: "▲", INFO: "•" };

export function formatReport(findings: Finding[]): string {
  const sorted = [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const lines: string[] = ["", "scrypt doctor", "─────────────"];
  for (const f of sorted) {
    const tag = f.passed ? "ok " : SEV_ICON[f.severity];
    lines.push(`${tag} [${f.severity}] ${f.title}`);
    if (f.detail) lines.push(`     ${f.detail}`);
    if (!f.passed && f.remedy) lines.push(`     → ${f.remedy}`);
  }
  const crit = findings.filter((x) => !x.passed && (x.severity === "CRITICAL" || x.severity === "HIGH")).length;
  lines.push("─────────────");
  lines.push(crit === 0 ? "No critical/high issues." : `${crit} critical/high issue(s) need attention.`);
  lines.push("");
  return lines.join("\n");
}

// ---- thin fact gathering --------------------------------------------------

function firstRoutableIpv4(): string | null {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

function inferProfile(env: Record<string, string | undefined>, overrideExists: boolean): Profile | "unknown" {
  if (env.SCRYPT_HUB_URL) return "vps";
  if (overrideExists || env.SCRYPT_VAULT_DIR) return "docker";
  if (env.SCRYPT_VAULT_PATH) return "native";
  return "unknown";
}

export interface GatherOpts {
  envPath: string;
  overridePath: string;
  cwd: string;
  hubOverride?: string;
  profileOverride?: Profile;
}

export async function gatherFacts(ctx: Ctx, opts: GatherOpts): Promise<DoctorFacts> {
  const envText = ctx.fs.read(opts.envPath) ?? "";
  const lines = parseEnv(envText);
  const env: Record<string, string | undefined> = {};
  for (const l of lines) if (l.key) env[l.key] = l.value ?? "";

  const port = Number(env.SCRYPT_PORT) || 3777;
  const token = env.SCRYPT_AUTH_TOKEN?.trim() || undefined;
  const overrideExists = ctx.fs.exists(opts.overridePath);
  const profile = opts.profileOverride ?? inferProfile(env, overrideExists);
  const dockerProfile = profile === "docker";

  // server probes (localhost)
  const probe = async (method: string, url: string, body?: string, headers?: Record<string, string>) => {
    try { return await ctx.http.request(method, url, { body, headers }); } catch { return null; }
  };
  const healthRes = await probe("GET", `http://localhost:${port}/health`);
  const healthLocal = healthRes?.status === 200 && (() => { try { return JSON.parse(healthRes.body)?.ok === true; } catch { return false; } })();

  const mcpHeaders: Record<string, string> = { "content-type": "application/json" };
  if (token) mcpHeaders["Authorization"] = `Bearer ${token}`;
  const mcpRes = healthLocal ? await probe("POST", `http://localhost:${port}/mcp`, MCP_PROBE_BODY, mcpHeaders) : null;
  const mcpLocal = mcpRes ? mcpRes.status === 200 : (healthLocal ? false : null);

  // off-box reachability (native exposure)
  const routableIp = firstRoutableIpv4();
  let offBoxReachable: boolean | null = null;
  if (profile === "native" && routableIp && healthLocal) {
    const r = await probe("GET", `http://${routableIp}:${port}/health`);
    offBoxReachable = r?.status === 200;
  }

  // docker daemon
  let dockerDaemon: boolean | null = null;
  if (dockerProfile) dockerDaemon = (await ctx.shell.run("docker", ["info"])).code === 0;

  // claude + mcp registration
  const claudePresent = Boolean(ctx.shell.which("claude"));
  let mcpRegistered: boolean | null = null;
  if (claudePresent) mcpRegistered = (await ctx.shell.run("claude", ["mcp", "get", "scrypt"])).code === 0;

  // tailscale
  const tsInstalled = Boolean(ctx.shell.which("tailscale"));
  let tsUp = false;
  let tsIp: string | null = null;
  if (tsInstalled) {
    tsUp = (await ctx.shell.run("tailscale", ["status"])).code === 0;
    const ipRes = await ctx.shell.run("tailscale", ["ip", "-4"]);
    tsIp = ipRes.code === 0 ? ipRes.stdout.trim().split(/\s+/)[0] || null : null;
  }

  // .env gitignored. git check-ignore: 0=ignored, 1=NOT ignored, 128=not a git
  // repo (treat as null -> no finding; nothing to leak into git here).
  let envGitIgnored: boolean | null = null;
  if (ctx.fs.exists(opts.envPath)) {
    const r = await ctx.shell.run("git", ["check-ignore", ".env"], { cwd: opts.cwd });
    envGitIgnored = r.code === 0 ? true : r.code === 1 ? false : null;
  }

  // hub token validity (remote probe)
  const hubUrl = opts.hubOverride ?? env.SCRYPT_HUB_URL;
  let hubTokenValid: boolean | null = null;
  if (hubUrl && token) {
    const r = await probe("GET", `${hubUrl.replace(/\/$/, "")}/api/sync/manifest`, undefined, { Authorization: `Bearer ${token}` });
    if (r) hubTokenValid = r.status === 200 ? true : r.status === 401 ? false : null;
  }

  const vaultPath = env.SCRYPT_VAULT_PATH || env.SCRYPT_VAULT_DIR || opts.cwd;

  const arch = ctx.arch;
  return {
    profile,
    port,
    envExists: ctx.fs.exists(opts.envPath),
    envToken: token,
    bindAddr: env.SCRYPT_BIND_ADDR || "127.0.0.1",
    nodeEnvProduction: env.NODE_ENV === "production",
    healthLocal: Boolean(healthLocal),
    mcpLocal,
    offBoxReachable,
    routableIp,
    dockerProfile,
    dockerDaemon,
    archPinIssue: dockerProfile && arch !== "arm64",
    overrideExists,
    ingestDir: env.SCRYPT_INGEST_DIR,
    vaultPath,
    stdioVaultDir: env.SCRYPT_VAULT_DIR,
    stdioDbPath: env.SCRYPT_DB_PATH,
    claudePresent,
    mcpRegistered,
    tailscale: { installed: tsInstalled, up: tsUp, ip: tsIp },
    envGitIgnored,
    gitAutocommitRaw: env.SCRYPT_GIT_AUTOCOMMIT,
    hubUrl,
    hubTokenValid,
  };
}
