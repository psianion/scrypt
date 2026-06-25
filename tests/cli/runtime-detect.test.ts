import { describe, test, expect } from "bun:test";
import { detectRuntimes, type RuntimeFacts } from "../../src/cli/runtime-detect";

const base: RuntimeFacts = {
  bun: true,
  dockerDaemon: false,
  dockerCompose: false,
  claude: true,
  tailscale: { installed: false, up: false, ip: null },
  platform: "win32",
  arch: "x64",
};

describe("detectRuntimes", () => {
  test("bun only -> recommends native", () => {
    const r = detectRuntimes(base);
    expect(r.available.native).toBe(true);
    expect(r.available.docker).toBe(false);
    expect(r.recommended).toBe("native");
  });

  test("docker available on x64 -> recommends docker + arm64 warning", () => {
    const r = detectRuntimes({ ...base, dockerDaemon: true, dockerCompose: true });
    expect(r.available.docker).toBe(true);
    expect(r.recommended).toBe("docker");
    expect(r.warnings.some((w) => w.includes("arm64"))).toBe(true);
  });

  test("docker on arm64 -> no arm64 warning", () => {
    const r = detectRuntimes({ ...base, dockerDaemon: true, dockerCompose: true, arch: "arm64" });
    expect(r.warnings.some((w) => w.includes("arm64"))).toBe(false);
  });

  test("missing claude -> mcp warning", () => {
    const r = detectRuntimes({ ...base, claude: false });
    expect(r.warnings.some((w) => w.includes("claude"))).toBe(true);
  });

  test("tailscale installed but down -> warning", () => {
    const r = detectRuntimes({ ...base, tailscale: { installed: true, up: false, ip: null } });
    expect(r.warnings.some((w) => w.toLowerCase().includes("tailscale"))).toBe(true);
  });
});
