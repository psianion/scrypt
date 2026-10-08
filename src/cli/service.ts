// src/cli/service.ts
//
// `scrypt service install|uninstall|status` — keep the native server running
// across logins and reboots without Docker. One mechanism per platform:
//   linux   systemd --user unit        ~/.config/systemd/user/scrypt.service
//   darwin  launchd agent              ~/Library/LaunchAgents/com.scrypt.server.plist
//   win32   Scheduled Task at logon    task "scrypt" (hidden PowerShell window)
// The renderers are pure so the exact files/commands are unit-tested; the
// thin runner at the bottom is the only part that touches the system.
import { join, posix } from "node:path";
import type { Ctx } from "./ctx";

export interface ServiceSpec {
  /** Repo checkout — the server is started from here so `.env` is picked up. */
  repoDir: string;
  /** Absolute path of the bun binary to run (`process.execPath`). */
  bunPath: string;
  home: string;
}

export const SERVICE_NAME = "scrypt";
export const LAUNCHD_LABEL = "com.scrypt.server";

export function systemdUnitPath(spec: ServiceSpec): string {
  return posix.join(spec.home, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

export function renderSystemdUnit(spec: ServiceSpec): string {
  return `[Unit]
Description=scrypt — second-brain server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${spec.repoDir}
ExecStart=${spec.bunPath} run src/server/index.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

export function launchdPlistPath(spec: ServiceSpec): string {
  return posix.join(spec.home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLaunchdPlist(spec: ServiceSpec): string {
  const logDir = posix.join(spec.home, "Library", "Logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(spec.bunPath)}</string>
    <string>run</string>
    <string>src/server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(spec.repoDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(posix.join(logDir, "scrypt.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(posix.join(logDir, "scrypt.err.log"))}</string>
</dict>
</plist>
`;
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** PowerShell that registers (or replaces) the logon task. The task runs a
 *  hidden PowerShell that cd's into the repo and execs bun, because
 *  schtasks.exe cannot set a working directory and Bun needs `.env` from it. */
export function renderWindowsRegisterScript(spec: ServiceSpec): string {
  // `inner` is what the task will run; psQuote() below turns it into one
  // PowerShell literal, doubling the path's quotes exactly once.
  const inner = `-NoProfile -WindowStyle Hidden -Command "& ${psQuote(spec.bunPath)} run src/server/index.ts"`;
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(inner)} -WorkingDirectory ${psQuote(spec.repoDir)}`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME`,
    `$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable`,
    `Register-ScheduledTask -TaskName ${psQuote(SERVICE_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${psQuote(SERVICE_NAME)}`,
  ].join("; ");
}

export function renderWindowsUnregisterScript(): string {
  return [
    `Stop-ScheduledTask -TaskName ${psQuote(SERVICE_NAME)} -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskName ${psQuote(SERVICE_NAME)} -Confirm:$false -ErrorAction SilentlyContinue`,
  ].join("; ");
}

export function usageService(): string {
  return "usage: scrypt service <install|uninstall|status>\n  keeps the native server running across logins/reboots (systemd --user, launchd, or a Scheduled Task)";
}

async function uid(ctx: Ctx): Promise<string> {
  const r = await ctx.shell.run("id", ["-u"]);
  return r.stdout.trim() || "501";
}

export async function runService(ctx: Ctx, argv: string[], spec: ServiceSpec): Promise<number> {
  const sub = argv[0];
  if (sub !== "install" && sub !== "uninstall" && sub !== "status") { ctx.log.error(usageService()); return 2; }

  if (ctx.platform === "linux") {
    const unit = systemdUnitPath(spec);
    if (sub === "install") {
      if (!ctx.shell.which("systemctl")) { ctx.log.error("systemctl not found — start the server with `scrypt up` instead."); return 1; }
      ctx.fs.mkdirp(posix.join(spec.home, ".config", "systemd", "user"));
      ctx.fs.write(unit, renderSystemdUnit(spec));
      await ctx.shell.run("systemctl", ["--user", "daemon-reload"]);
      const r = await ctx.shell.run("systemctl", ["--user", "enable", "--now", SERVICE_NAME]);
      if (r.code !== 0) { ctx.log.error(`systemctl enable failed: ${r.stderr.trim()}`); return 1; }
      ctx.log.info(`installed ${unit} and started it. Survive logout with: loginctl enable-linger "$USER"`);
      return 0;
    }
    if (sub === "uninstall") {
      await ctx.shell.run("systemctl", ["--user", "disable", "--now", SERVICE_NAME]);
      ctx.fs.write(unit, "");
      ctx.log.info("service disabled and stopped.");
      return 0;
    }
    const r = await ctx.shell.run("systemctl", ["--user", "is-active", SERVICE_NAME]);
    ctx.log.info(`${SERVICE_NAME}: ${r.stdout.trim() || r.stderr.trim() || "unknown"}`);
    return r.code;
  }

  if (ctx.platform === "darwin") {
    const plist = launchdPlistPath(spec);
    const domain = `gui/${await uid(ctx)}`;
    if (sub === "install") {
      ctx.fs.mkdirp(posix.join(spec.home, "Library", "LaunchAgents"));
      ctx.fs.write(plist, renderLaunchdPlist(spec));
      await ctx.shell.run("launchctl", ["bootout", domain, plist]); // replace if present
      const r = await ctx.shell.run("launchctl", ["bootstrap", domain, plist]);
      if (r.code !== 0) { ctx.log.error(`launchctl bootstrap failed: ${r.stderr.trim()}`); return 1; }
      ctx.log.info(`installed ${plist} and started it (runs at login).`);
      return 0;
    }
    if (sub === "uninstall") {
      await ctx.shell.run("launchctl", ["bootout", domain, plist]);
      ctx.fs.write(plist, "");
      ctx.log.info("launch agent removed.");
      return 0;
    }
    const r = await ctx.shell.run("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`]);
    ctx.log.info(r.code === 0 ? `${LAUNCHD_LABEL}: loaded` : `${LAUNCHD_LABEL}: not loaded`);
    return r.code;
  }

  if (ctx.platform === "win32") {
    const ps = (script: string) => ctx.shell.run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    if (sub === "install") {
      const r = await ps(renderWindowsRegisterScript(spec));
      if (r.code !== 0) { ctx.log.error(`could not register the scheduled task: ${r.stderr.trim() || r.stdout.trim()}`); return 1; }
      ctx.log.info(`registered Scheduled Task '${SERVICE_NAME}' (runs hidden at logon) and started it.`);
      return 0;
    }
    if (sub === "uninstall") {
      await ps(renderWindowsUnregisterScript());
      ctx.log.info("scheduled task removed.");
      return 0;
    }
    const r = await ctx.shell.run("schtasks.exe", ["/Query", "/TN", SERVICE_NAME, "/FO", "LIST"]);
    ctx.log.info(r.code === 0 ? r.stdout.trim() : `${SERVICE_NAME}: not registered`);
    return r.code;
  }

  ctx.log.error(`no service mechanism for platform ${ctx.platform} — use \`scrypt up\`.`);
  return 1;
}
