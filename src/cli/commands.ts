// src/cli/commands.ts
//
// Command orchestrators (thin) + the command registry. Each run* returns an exit
// code. Pure logic lives in the sibling modules; this file wires Ctx to them.

import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import type { Ctx } from "./ctx";
import { parseEnv, getEnv, mergeEnv } from "./env-file";
import { generateToken, redactToken } from "./token";
import { detectRuntimes, type Profile, type RuntimeFacts } from "./runtime-detect";
import { planInit, type InitAnswers } from "./init-plan";
import { buildOverrideYaml } from "./compose";
import { waitForHealth, classifyHealth } from "./health";
import { gatherFacts, evaluateDoctor, formatReport, doctorExitCode } from "./doctor";
import { runMcpInstall, MCP_PROBE_BODY } from "./mcp-install";
import {
  buildStartCommand,
  buildDockerDown,
  pidFilePath,
  COMPOSE_OVERRIDE,
} from "./runtime-ops";

const PROFILES: Profile[] = ["native", "docker", "vps"];

function envPathOf(ctx: Ctx): string {
  return join(ctx.cwd, ".env");
}

async function probeHealth(ctx: Ctx, port: number): Promise<boolean> {
  try {
    const r = await ctx.http.request("GET", `http://localhost:${port}/health`);
    return classifyHealth(r);
  } catch {
    return false;
  }
}

async function gatherRuntimeFacts(ctx: Ctx): Promise<RuntimeFacts> {
  const docker = ctx.shell.which("docker");
  const dockerDaemon = docker ? (await ctx.shell.run("docker", ["info"])).code === 0 : false;
  const dockerCompose = docker ? (await ctx.shell.run("docker", ["compose", "version"])).code === 0 : false;
  const claude = Boolean(ctx.shell.which("claude"));
  const tsInstalled = Boolean(ctx.shell.which("tailscale"));
  let tsUp = false;
  let tsIp: string | null = null;
  if (tsInstalled) {
    tsUp = (await ctx.shell.run("tailscale", ["status"])).code === 0;
    const ipRes = await ctx.shell.run("tailscale", ["ip", "-4"]);
    tsIp = ipRes.code === 0 ? ipRes.stdout.trim().split(/\s+/)[0] || null : null;
  }
  return {
    bun: true, // we are running under Bun
    dockerDaemon,
    dockerCompose,
    claude,
    tailscale: { installed: tsInstalled, up: tsUp, ip: tsIp },
    platform: ctx.platform,
    arch: ctx.arch,
  };
}

// ---- init -----------------------------------------------------------------

export async function runInit(ctx: Ctx, argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      profile: { type: "string" },
      vault: { type: "string" },
      port: { type: "string" },
      token: { type: "string" },
      yes: { type: "boolean" },
      "no-start": { type: "boolean" },
      "print-env": { type: "boolean" },
      "rotate-token": { type: "boolean" },
      ingest: { type: "string" },
      hub: { type: "string" },
    },
  });

  const interactive = ctx.isTTY && !values.yes && !values["print-env"];

  // 1. detect
  const facts = await gatherRuntimeFacts(ctx);
  const report = detectRuntimes(facts);
  ctx.log.info(`Detected: bun=${facts.bun} docker=${report.available.docker} claude=${facts.claude} tailscale=${facts.tailscale.up ? "up" : "off"} (${ctx.platform}/${ctx.arch})`);
  for (const w of report.warnings) ctx.log.warn(`  ! ${w}`);

  // 2. profile
  let profile = (values.profile as Profile | undefined) ?? undefined;
  if (!profile) {
    if (interactive) {
      const choice = await ctx.prompt.select("Setup profile:", [
        "native  — run locally with Bun (fast dev)",
        "docker  — run locally in Docker (production-like)",
        "vps     — sync client to a remote hub",
      ], PROFILES.indexOf(report.recommended));
      profile = PROFILES[["native", "docker", "vps"].findIndex((p) => choice.startsWith(p))] ?? report.recommended;
    } else {
      profile = report.recommended;
      ctx.log.info(`No --profile given; using recommended: ${profile}`);
    }
  }
  if (!PROFILES.includes(profile)) {
    ctx.log.error(`unknown profile: ${profile} (expected native|docker|vps)`);
    return 2;
  }

  // 3. vault
  let vault = values.vault as string | undefined;
  if (!vault && interactive) vault = await ctx.prompt.ask("Vault directory", ctx.cwd);
  vault = resolve(vault || ctx.cwd);
  ctx.fs.mkdirp(vault);

  // 4. profile-specific answers
  const answers: InitAnswers = { profile, vaultPath: vault };
  if (profile === "docker") {
    let ingest = values.ingest as string | undefined;
    if (!ingest && interactive) ingest = await ctx.prompt.ask("Ingest source dir (read-only mount)", join(vault, "ingest"));
    answers.ingestDir = resolve(ingest || join(vault, "ingest"));
    ctx.fs.mkdirp(answers.ingestDir);
  }
  if (profile === "vps") {
    let hub = values.hub as string | undefined;
    if (!hub && interactive) hub = await ctx.prompt.ask("Hub URL (e.g. http://100.x.y.z:3777)");
    if (!hub) {
      ctx.log.error("vps profile requires --hub <url> (the remote hub's tailnet URL).");
      return 2;
    }
    answers.hubUrl = hub.replace(/\/$/, "");
  }

  // 5. plan
  const envPath = envPathOf(ctx);
  const existingText = ctx.fs.read(envPath) ?? "";
  const existing = parseEnv(existingText);
  const existingToken = getEnv(existing, "SCRYPT_AUTH_TOKEN")?.trim() || undefined;
  const port = Number(values.port) || Number(getEnv(existing, "SCRYPT_PORT")) || 3777;
  const plan = planInit({
    existing,
    answers,
    existingToken,
    candidateToken: generateToken(ctx.rng),
    forcedToken: values.token as string | undefined,
    rotate: Boolean(values["rotate-token"]),
    noStart: Boolean(values["no-start"]),
    port,
    arch: ctx.arch,
  });

  // dry-run
  if (values["print-env"]) {
    ctx.log.info("\n.env changes (dry-run):");
    for (const d of plan.redactedDiff) ctx.log.info(`  ${d}`);
    for (const w of plan.warnings) ctx.log.warn(`  ! ${w}`);
    return 0;
  }

  // preview + confirm
  ctx.log.info(`\nProfile: ${profile}   Vault: ${vault}   Token: ${plan.tokenAction} (${redactToken(plan.token)})`);
  ctx.log.info(".env changes:");
  for (const d of plan.redactedDiff) ctx.log.info(`  ${d}`);
  for (const w of plan.warnings) ctx.log.warn(`  ! ${w}`);
  if (interactive && plan.changed) {
    const ok = await ctx.prompt.confirm("Write these changes to .env?", true);
    if (!ok) { ctx.log.info("aborted — no changes written."); return 0; }
  }

  // 6. execute steps
  for (const step of plan.steps) {
    if (step.kind === "write-env") {
      if (plan.changed) {
        ctx.fs.write(envPath, plan.envText);
        if (ctx.platform !== "win32") ctx.fs.chmod(envPath, 0o600);
        ctx.log.info(`wrote ${envPath}`);
      } else {
        ctx.log.info(".env already up to date (no changes).");
      }
    } else if (step.kind === "write-override") {
      const overridePath = join(ctx.cwd, COMPOSE_OVERRIDE);
      ctx.fs.write(overridePath, buildOverrideYaml({ ingestDir: step.ingestDir, arch: step.arch }));
      ctx.log.info(`wrote ${overridePath}`);
    } else if (step.kind === "start-runtime") {
      const code = await startRuntime(ctx, step.profile, vault);
      if (code !== 0) return code;
    } else if (step.kind === "health-verify") {
      const ok = await waitForHealth({
        probe: async () => { try { return await ctx.http.request("GET", step.url); } catch { return null; } },
        timeoutMs: profile === "docker" ? 180_000 : 45_000,
        intervalMs: 1500,
        now: ctx.clock.now,
        sleep: ctx.clock.sleep,
      });
      if (ok) ctx.log.info(`Scrypt is up: http://localhost:${port}`);
      else { ctx.log.error(`server did not become healthy at ${step.url} in time — check logs.`); return 1; }
    } else if (step.kind === "probe-hub") {
      await probeHub(ctx, step.url, plan.token);
    }
  }

  // 7. inline doctor (advisory — does not change init's exit code)
  const f = await gatherFacts(ctx, { envPath, overridePath: join(ctx.cwd, COMPOSE_OVERRIDE), cwd: ctx.cwd, profileOverride: profile });
  const findings = evaluateDoctor(f);
  ctx.log.info(formatReport(findings));

  // 8. offer MCP install
  if (facts.claude && profile !== "vps") {
    const doInstall = values.yes ? true : interactive ? await ctx.prompt.confirm("Register the Scrypt MCP server in Claude Code now?", true) : false;
    if (doInstall) {
      const r = await runMcpInstall(ctx, { envPath });
      ctx.log.info((r.ok ? "✓ " : "✗ ") + r.message);
    }
  }

  // 9. summary
  ctx.log.info("\nSetup complete.");
  ctx.log.info(`  profile: ${profile}`);
  ctx.log.info(`  vault:   ${vault}`);
  if (profile !== "vps") ctx.log.info(`  url:     http://localhost:${port}`);
  if (profile === "vps") ctx.log.info(`  hub:     ${answers.hubUrl}`);
  ctx.log.info(`  token:   ${redactToken(plan.token)}`);
  ctx.log.info(profile === "vps" ? "  next:    scrypt sync status" : "  next:    open the URL above, or run `scrypt doctor`");
  return 0;
}

async function startRuntime(ctx: Ctx, profile: Profile, vault: string): Promise<number> {
  if (profile === "docker") {
    const cmd = buildStartCommand("docker", ctx.fs.exists(join(ctx.cwd, COMPOSE_OVERRIDE)))!;
    ctx.log.info(`starting: ${cmd.cmd} ${cmd.args.join(" ")}`);
    const r = await ctx.shell.run(cmd.cmd, cmd.args, { cwd: ctx.cwd });
    if (r.code !== 0) { ctx.log.error(`docker compose up failed: ${r.stderr.trim()}`); return 1; }
    return 0;
  }
  // native: spawn detached so the CLI returns; record pid for `scrypt down`.
  ctx.log.info("starting: bun src/server/index.ts (detached)");
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    cwd: ctx.cwd,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();
  const pidPath = pidFilePath(vault);
  ctx.fs.mkdirp(join(vault, ".scrypt", "cli"));
  ctx.fs.write(pidPath, String(proc.pid));
  return 0;
}

async function probeHub(ctx: Ctx, url: string, token: string): Promise<void> {
  try {
    const r = await ctx.http.request("GET", url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (r.status === 200) ctx.log.info(`hub reachable + token accepted (${url} -> 200)`);
    else if (r.status === 401) ctx.log.error(`hub rejected the token (${url} -> 401) — fix SCRYPT_AUTH_TOKEN to match the hub.`);
    else ctx.log.warn(`hub returned HTTP ${r.status} for ${url}`);
  } catch (e) {
    ctx.log.error(`hub unreachable: ${url} (${String(e)}). Is Tailscale up and the hub running?`);
  }
}

// ---- up / down ------------------------------------------------------------

function inferProfileFromEnv(ctx: Ctx): Profile {
  const env = parseEnv(ctx.fs.read(envPathOf(ctx)) ?? "");
  if (getEnv(env, "SCRYPT_HUB_URL")) return "vps";
  if (ctx.fs.exists(join(ctx.cwd, COMPOSE_OVERRIDE)) || getEnv(env, "SCRYPT_VAULT_DIR")) return "docker";
  return "native";
}

function configuredPort(ctx: Ctx): number {
  return Number(getEnv(parseEnv(ctx.fs.read(envPathOf(ctx)) ?? ""), "SCRYPT_PORT")) || 3777;
}

function configuredVault(ctx: Ctx): string {
  const env = parseEnv(ctx.fs.read(envPathOf(ctx)) ?? "");
  return getEnv(env, "SCRYPT_VAULT_PATH") || getEnv(env, "SCRYPT_VAULT_DIR") || ctx.cwd;
}

export async function runUp(ctx: Ctx, argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: false, options: { profile: { type: "string" } } });
  const profile = (values.profile as Profile) ?? inferProfileFromEnv(ctx);
  if (profile === "vps") { ctx.log.info("vps profile has no local server to start — use `scrypt sync`."); return 0; }
  const port = configuredPort(ctx);
  if (await probeHealth(ctx, port)) { ctx.log.info(`already running: http://localhost:${port}`); return 0; }
  const code = await startRuntime(ctx, profile, configuredVault(ctx));
  if (code !== 0) return code;
  const ok = await waitForHealth({
    probe: async () => { try { return await ctx.http.request("GET", `http://localhost:${port}/health`); } catch { return null; } },
    timeoutMs: profile === "docker" ? 180_000 : 45_000,
    intervalMs: 1500,
    now: ctx.clock.now,
    sleep: ctx.clock.sleep,
  });
  if (ok) { ctx.log.info(`Scrypt is up: http://localhost:${port}`); return 0; }
  ctx.log.error("server did not become healthy in time."); return 1;
}

export async function runDown(ctx: Ctx, argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: false, options: { volumes: { type: "boolean" } } });
  const profile = inferProfileFromEnv(ctx);
  if (profile === "vps") { ctx.log.info("vps profile has no local server."); return 0; }

  if (values.volumes) {
    const confirmed = ctx.isTTY ? await ctx.prompt.confirm("`--volumes` deletes the embed-cache volume, forcing a FULL re-embed of your vault on next start (notes are safe — bind mount). Continue?", false) : true;
    if (!confirmed) { ctx.log.info("aborted."); return 0; }
  }

  if (profile === "docker") {
    const cmd = buildDockerDown(Boolean(values.volumes), ctx.fs.exists(join(ctx.cwd, COMPOSE_OVERRIDE)));
    const r = await ctx.shell.run(cmd.cmd, cmd.args, { cwd: ctx.cwd });
    if (r.code !== 0) { ctx.log.error(`docker compose down failed: ${r.stderr.trim()}`); return 1; }
    ctx.log.info("stopped."); return 0;
  }

  // native: kill tracked pid
  const pidPath = pidFilePath(configuredVault(ctx));
  const pidStr = ctx.fs.read(pidPath);
  if (!pidStr) { ctx.log.info("no tracked native server (nothing to stop)."); return 0; }
  const pid = Number(pidStr.trim());
  if (ctx.platform === "win32") {
    await ctx.shell.run("taskkill", ["/PID", String(pid), "/F", "/T"]);
  } else {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
  ctx.fs.write(pidPath, "");
  ctx.log.info(`stopped native server (pid ${pid}).`);
  return 0;
}

// ---- doctor ---------------------------------------------------------------

export async function runDoctor(ctx: Ctx, argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: false, options: { hub: { type: "string" }, json: { type: "boolean" } } });
  const envPath = envPathOf(ctx);
  const f = await gatherFacts(ctx, {
    envPath,
    overridePath: join(ctx.cwd, COMPOSE_OVERRIDE),
    cwd: ctx.cwd,
    hubOverride: values.hub as string | undefined,
  });
  const findings = evaluateDoctor(f);
  if (values.json) ctx.log.info(JSON.stringify({ findings, exitCode: doctorExitCode(findings) }, null, 2));
  else ctx.log.info(formatReport(findings));
  return doctorExitCode(findings);
}

// ---- mcp ------------------------------------------------------------------

export async function runMcp(ctx: Ctx, argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const { values } = parseArgs({ args: rest, strict: false, options: { name: { type: "string" }, url: { type: "string" }, scope: { type: "string" } } });
  if (sub === "install") {
    const r = await runMcpInstall(ctx, {
      envPath: envPathOf(ctx),
      name: values.name as string | undefined,
      url: values.url as string | undefined,
      scope: values.scope as string | undefined,
    });
    ctx.log.info((r.ok ? "✓ " : "✗ ") + r.message);
    return r.code;
  }
  if (sub === "uninstall") {
    if (!ctx.shell.which("claude")) { ctx.log.error("claude CLI not on PATH."); return 1; }
    const name = (values.name as string) ?? "scrypt";
    const scope = (values.scope as string) ?? "user";
    await ctx.shell.run("claude", ["mcp", "remove", name, "--scope", scope]);
    ctx.log.info(`removed MCP entry '${name}' (if it existed).`);
    return 0;
  }
  ctx.log.error("usage: scrypt mcp <install|uninstall> [--name n] [--url u] [--scope user|project|local]");
  return 2;
}

// ---- token ----------------------------------------------------------------

export async function runToken(ctx: Ctx, argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== "rotate") { ctx.log.error("usage: scrypt token rotate [--yes]"); return 2; }
  const { values } = parseArgs({ args: argv.slice(1), strict: false, options: { yes: { type: "boolean" } } });
  const envPath = envPathOf(ctx);
  const lines = parseEnv(ctx.fs.read(envPath) ?? "");
  const old = getEnv(lines, "SCRYPT_AUTH_TOKEN");
  const next = generateToken(ctx.rng);
  if (ctx.isTTY && !values.yes) {
    const ok = await ctx.prompt.confirm(`Rotate token ${redactToken(old)} -> ${redactToken(next)}?`, false);
    if (!ok) { ctx.log.info("aborted."); return 0; }
  }
  const merged = mergeEnv(lines, { SCRYPT_AUTH_TOKEN: next });
  ctx.fs.write(envPath, merged.text);
  if (ctx.platform !== "win32") ctx.fs.chmod(envPath, 0o600);
  ctx.log.info(`token rotated -> ${redactToken(next)}`);
  ctx.log.info("next: restart the server (`scrypt down && scrypt up`) and re-run `scrypt mcp install`.");
  return 0;
}

// ---- pass-throughs --------------------------------------------------------

async function spawnScript(ctx: Ctx, script: string, argv: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "run", script, ...argv], { cwd: ctx.cwd, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return await proc.exited;
}

export async function runSync(ctx: Ctx, argv: string[]): Promise<number> {
  const env = parseEnv(ctx.fs.read(envPathOf(ctx)) ?? "");
  const hub = getEnv(env, "SCRYPT_HUB_URL");
  if (!hub) { ctx.log.error("SCRYPT_HUB_URL is not set — run `scrypt init --profile vps` first."); return 2; }
  return spawnScript(ctx, "scripts/scrypt-sync.ts", argv);
}

export async function runReindex(ctx: Ctx, argv: string[]): Promise<number> {
  return spawnScript(ctx, "scripts/scrypt-reindex.ts", argv);
}

export async function runMaintenanceCmd(ctx: Ctx): Promise<number> {
  const { runMaintenance } = await import("../server/cli");
  const vaultPath = configuredVault(ctx);
  const retention = Number(getEnv(parseEnv(ctx.fs.read(envPathOf(ctx)) ?? ""), "SCRYPT_TRASH_RETENTION_DAYS")) || 30;
  const r = await runMaintenance({ vaultPath, trashRetentionDays: retention });
  ctx.log.info(JSON.stringify(r, null, 2));
  return 0;
}

// ---- registry -------------------------------------------------------------

export interface Command {
  summary: string;
  run(ctx: Ctx, argv: string[]): Promise<number>;
}

export const commands: Record<string, Command> = {
  init: { summary: "Guided setup wizard (native | docker | vps)", run: runInit },
  up: { summary: "Start the configured runtime and wait for health", run: runUp },
  down: { summary: "Stop the runtime ([--volumes] also drops embed cache)", run: runDown },
  doctor: { summary: "Health + security audit ([--hub url] [--json])", run: runDoctor },
  mcp: { summary: "Register/unregister the Scrypt MCP server in Claude", run: runMcp },
  token: { summary: "token rotate — generate a new auth token", run: runToken },
  sync: { summary: "Push/pull against the hub (forwards to scrypt-sync)", run: runSync },
  reindex: { summary: "Rebuild embeddings (forwards to scrypt-reindex)", run: runReindex },
  maintenance: { summary: "Prune trash, VACUUM, rebuild FTS", run: (ctx) => runMaintenanceCmd(ctx) },
};

export function usage(): string {
  const rows = Object.entries(commands).map(([k, c]) => `  ${k.padEnd(12)} ${c.summary}`);
  return ["scrypt — setup & operations CLI", "", "usage: scrypt <command> [options]", "", "commands:", ...rows, "", "run `scrypt <command> --help` for details", ""].join("\n");
}
