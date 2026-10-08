import { describe, test, expect } from "bun:test";
import { makeFakeCtx } from "../../src/cli/ctx";
import {
  renderLaunchdPlist, renderSystemdUnit, renderWindowsRegisterScript, renderWindowsUnregisterScript,
  runService, systemdUnitPath, launchdPlistPath, type ServiceSpec,
} from "../../src/cli/service";

const spec: ServiceSpec = { repoDir: "/home/me/scrypt", bunPath: "/home/me/.bun/bin/bun", home: "/home/me" };

describe("renderers", () => {
  test("systemd unit runs bun from the repo so .env is loaded, restarts on failure, and is a user unit", () => {
    const u = renderSystemdUnit(spec);
    expect(u).toContain("WorkingDirectory=/home/me/scrypt");
    expect(u).toContain("ExecStart=/home/me/.bun/bin/bun run src/server/index.ts");
    expect(u).toContain("Restart=on-failure");
    expect(u).toContain("WantedBy=default.target");
    expect(systemdUnitPath(spec)).toBe("/home/me/.config/systemd/user/scrypt.service");
  });

  test("launchd plist runs at load, keeps alive on crashes, and escapes XML", () => {
    const p = renderLaunchdPlist({ ...spec, repoDir: "/Users/a&b/scrypt" });
    expect(p).toContain("<string>/Users/a&amp;b/scrypt</string>");
    expect(p).toContain("<key>RunAtLoad</key><true/>");
    expect(p).toContain("<key>Label</key><string>com.scrypt.server</string>");
    expect(launchdPlistPath(spec)).toBe("/home/me/Library/LaunchAgents/com.scrypt.server.plist");
  });

  test("windows script registers a hidden logon task with the repo as working directory", () => {
    const s = renderWindowsRegisterScript({ repoDir: "C:\\Users\\me\\scrypt", bunPath: "C:\\Users\\me\\.bun\\bin\\bun.exe", home: "C:\\Users\\me" });
    expect(s).toContain("-WorkingDirectory 'C:\\Users\\me\\scrypt'");
    // Inside the single-quoted -Argument literal the path's quotes are doubled
    // exactly once, so the task runs `& 'C:\...\bun.exe' run ...` (a doubled
    // pair at that layer became `& ''C:\...''` and failed with exit 1).
    expect(s).toContain(`-Argument '-NoProfile -WindowStyle Hidden -Command "& ''C:\\Users\\me\\.bun\\bin\\bun.exe'' run src/server/index.ts"'`);
    expect(s).toContain("-WindowStyle Hidden");
    expect(s).toContain("New-ScheduledTaskTrigger -AtLogOn");
    expect(s).toContain("Register-ScheduledTask -TaskName 'scrypt'");
    expect(s).toContain("Start-ScheduledTask -TaskName 'scrypt'");
    expect(renderWindowsUnregisterScript()).toContain("Unregister-ScheduledTask -TaskName 'scrypt'");
  });
});

describe("runService", () => {
  test("linux install writes the unit, reloads, enables --now", async () => {
    const ctx = makeFakeCtx({ platform: "linux" });
    expect(await runService(ctx, ["install"], spec)).toBe(0);
    expect(ctx.recorded.writes["/home/me/.config/systemd/user/scrypt.service"]).toContain("ExecStart=");
    const calls = ctx.recorded.shell.map((s) => [s.cmd, ...s.args].join(" "));
    expect(calls).toContain("systemctl --user daemon-reload");
    expect(calls).toContain("systemctl --user enable --now scrypt");
  });

  test("linux install without systemctl fails with a hint instead of writing anything", async () => {
    const ctx = makeFakeCtx({ platform: "linux", whichResponder: () => null });
    expect(await runService(ctx, ["install"], spec)).toBe(1);
    expect(Object.keys(ctx.recorded.writes)).toHaveLength(0);
  });

  test("darwin install writes the plist and bootstraps it into the user's gui domain", async () => {
    const ctx = makeFakeCtx({ platform: "darwin", shellResponder: (cmd, args) => (cmd === "id" && args[0] === "-u" ? { code: 0, stdout: "501\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }) });
    expect(await runService(ctx, ["install"], spec)).toBe(0);
    expect(ctx.recorded.writes["/home/me/Library/LaunchAgents/com.scrypt.server.plist"]).toContain("com.scrypt.server");
    const calls = ctx.recorded.shell.map((s) => [s.cmd, ...s.args].join(" "));
    expect(calls).toContain("launchctl bootstrap gui/501 /home/me/Library/LaunchAgents/com.scrypt.server.plist");
  });

  test("win32 install runs the register script through powershell; uninstall unregisters", async () => {
    const ctx = makeFakeCtx({ platform: "win32" });
    expect(await runService(ctx, ["install"], spec)).toBe(0);
    const [first] = ctx.recorded.shell;
    expect(first.cmd).toBe("powershell.exe");
    expect(first.args.at(-1)).toContain("Register-ScheduledTask");
    expect(await runService(ctx, ["uninstall"], spec)).toBe(0);
    expect(ctx.recorded.shell.at(-1)!.args.at(-1)).toContain("Unregister-ScheduledTask");
  });

  test("bad subcommand prints usage and exits 2", async () => {
    const ctx = makeFakeCtx({ platform: "linux" });
    expect(await runService(ctx, ["restart"], spec)).toBe(2);
  });
});
