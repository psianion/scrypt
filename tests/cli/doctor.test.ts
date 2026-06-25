import { describe, test, expect } from "bun:test";
import { evaluateDoctor, doctorExitCode, type DoctorFacts } from "../../src/cli/doctor";

const STRONG = "0123456789abcdef".repeat(4);

function facts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    profile: "native",
    port: 3777,
    envExists: true,
    envToken: STRONG,
    bindAddr: "127.0.0.1",
    nodeEnvProduction: false,
    healthLocal: true,
    mcpLocal: true,
    offBoxReachable: false,
    routableIp: "192.168.1.5",
    dockerProfile: false,
    dockerDaemon: null,
    archPinIssue: false,
    overrideExists: false,
    ingestDir: undefined,
    vaultPath: "/v",
    stdioVaultDir: undefined,
    stdioDbPath: undefined,
    claudePresent: true,
    mcpRegistered: true,
    tailscale: { installed: false, up: false, ip: null },
    envGitIgnored: true,
    gitAutocommitRaw: undefined,
    hubUrl: undefined,
    hubTokenValid: null,
    ...overrides,
  };
}

function find(fs: ReturnType<typeof evaluateDoctor>, id: string) {
  return fs.find((f) => f.id === id);
}

describe("doctor evaluators", () => {
  test("exposed (production) without token -> CRITICAL", () => {
    const out = evaluateDoctor(facts({ nodeEnvProduction: true, envToken: undefined }));
    expect(find(out, "exposed-no-token")?.severity).toBe("CRITICAL");
    expect(doctorExitCode(out)).toBe(1);
  });

  test("non-loopback bind triggers exposure rule", () => {
    const out = evaluateDoctor(facts({ bindAddr: "0.0.0.0", envToken: undefined }));
    expect(find(out, "exposed-no-token")?.severity).toBe("CRITICAL");
  });

  test("native reachable off-box -> native-offbox + host-spoof CRITICAL", () => {
    const out = evaluateDoctor(facts({ offBoxReachable: true, envToken: undefined }));
    expect(find(out, "native-offbox")?.severity).toBe("CRITICAL");
    expect(find(out, "host-spoof")?.severity).toBe("CRITICAL");
  });

  test("native reachable off-box WITH token -> native-offbox HIGH (still spoofable CRITICAL)", () => {
    const out = evaluateDoctor(facts({ offBoxReachable: true }));
    expect(find(out, "native-offbox")?.severity).toBe("HIGH");
    expect(find(out, "host-spoof")?.severity).toBe("CRITICAL");
  });

  test("weak token -> HIGH", () => {
    const out = evaluateDoctor(facts({ envToken: "change-me" }));
    expect(find(out, "weak-token")?.severity).toBe("HIGH");
  });

  test("docker arm64 pin on x64 without override -> HIGH; with override -> INFO pass", () => {
    const pinned = evaluateDoctor(facts({ profile: "docker", dockerProfile: true, dockerDaemon: true, archPinIssue: true, overrideExists: false }));
    expect(find(pinned, "docker-arch-pin")?.severity).toBe("HIGH");
    const fixed = evaluateDoctor(facts({ profile: "docker", dockerProfile: true, dockerDaemon: true, archPinIssue: true, overrideExists: true }));
    expect(find(fixed, "docker-arch-pin")?.passed).toBe(true);
  });

  test("docker daemon down -> HIGH", () => {
    const out = evaluateDoctor(facts({ profile: "docker", dockerProfile: true, dockerDaemon: false }));
    expect(find(out, "docker-daemon")?.severity).toBe("HIGH");
  });

  test("explicit divergent stdio db -> HIGH", () => {
    const out = evaluateDoctor(facts({ stdioDbPath: "./other.db" }));
    expect(find(out, "db-divergence")?.severity).toBe("HIGH");
  });

  test(".env tracked in git -> CRITICAL", () => {
    const out = evaluateDoctor(facts({ envGitIgnored: false }));
    expect(find(out, "env-tracked")?.severity).toBe("CRITICAL");
  });

  test("hub token rejected -> HIGH", () => {
    const out = evaluateDoctor(facts({ hubUrl: "http://h", hubTokenValid: false }));
    expect(find(out, "hub-token")?.severity).toBe("HIGH");
  });

  test("clean native loopback setup -> exit 0", () => {
    const out = evaluateDoctor(facts());
    expect(doctorExitCode(out)).toBe(0);
  });

  test("vps profile -> tailscale down is HIGH", () => {
    const out = evaluateDoctor(facts({ profile: "vps", healthLocal: false, tailscale: { installed: true, up: false, ip: null } }));
    expect(find(out, "tailscale")?.severity).toBe("HIGH");
  });
});
