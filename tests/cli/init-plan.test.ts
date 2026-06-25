import { describe, test, expect } from "bun:test";
import { parseEnv, getEnv } from "../../src/cli/env-file";
import { planInit, type PlanInitInput } from "../../src/cli/init-plan";

const STRONG = "0123456789abcdef".repeat(4); // 64 hex, not weak
const CAND = "ff".repeat(32);

function base(overrides: Partial<PlanInitInput>): PlanInitInput {
  return {
    existing: [],
    answers: { profile: "native", vaultPath: "/abs/vault" },
    existingToken: undefined,
    candidateToken: CAND,
    rotate: false,
    noStart: false,
    port: 3777,
    arch: "x64",
    ...overrides,
  };
}

describe("planInit token resolution", () => {
  test("generates a token when none exists", () => {
    const p = planInit(base({}));
    expect(p.tokenAction).toBe("generated");
    expect(p.token).toBe(CAND);
  });

  test("keeps a strong existing token (idempotent)", () => {
    const p = planInit(base({ existing: parseEnv(`SCRYPT_AUTH_TOKEN=${STRONG}`), existingToken: STRONG }));
    expect(p.tokenAction).toBe("kept");
    expect(p.token).toBe(STRONG);
  });

  test("replaces a weak/placeholder token", () => {
    const p = planInit(base({ existing: parseEnv("SCRYPT_AUTH_TOKEN=change-me"), existingToken: "change-me" }));
    expect(p.tokenAction).toBe("generated");
    expect(p.token).toBe(CAND);
    expect(p.warnings.some((w) => w.includes("weak"))).toBe(true);
  });

  test("--rotate-token forces a new token even if strong", () => {
    const p = planInit(base({ existing: parseEnv(`SCRYPT_AUTH_TOKEN=${STRONG}`), existingToken: STRONG, rotate: true }));
    expect(p.tokenAction).toBe("rotated");
    expect(p.token).toBe(CAND);
  });

  test("--token wins", () => {
    const p = planInit(base({ forcedToken: "explicit-token-value-1234567890ab" }));
    expect(p.token).toBe("explicit-token-value-1234567890ab");
  });
});

describe("planInit per-profile keys", () => {
  test("native writes VAULT_PATH + token, no BIND_ADDR, no NODE_ENV", () => {
    const p = planInit(base({ answers: { profile: "native", vaultPath: "/v" } }));
    expect(p.envUpdates.SCRYPT_VAULT_PATH).toBe("/v");
    expect(p.envUpdates.SCRYPT_AUTH_TOKEN).toBe(CAND);
    expect(p.envUpdates.SCRYPT_BIND_ADDR).toBeUndefined();
    expect(p.envUpdates.NODE_ENV).toBeUndefined();
    expect(p.warnings.some((w) => w.includes("binds ALL interfaces"))).toBe(true);
  });

  test("native comments out a stray NODE_ENV=production", () => {
    const p = planInit(base({ existing: parseEnv("NODE_ENV=production"), answers: { profile: "native", vaultPath: "/v" } }));
    expect(getEnv(parseEnv(p.envText), "NODE_ENV")).toBeUndefined();
    expect(p.envText).toContain("# NODE_ENV=production");
    expect(p.warnings.some((w) => w.includes("NODE_ENV"))).toBe(true);
  });

  test("docker requires token + writes VAULT_DIR/INGEST_DIR/BIND_ADDR", () => {
    const p = planInit(base({ answers: { profile: "docker", vaultPath: "/v", ingestDir: "/ing" } }));
    expect(p.envUpdates.SCRYPT_AUTH_TOKEN).toBe(CAND);
    expect(p.envUpdates.SCRYPT_VAULT_DIR).toBe("/v");
    expect(p.envUpdates.SCRYPT_INGEST_DIR).toBe("/ing");
    expect(p.envUpdates.SCRYPT_BIND_ADDR).toBe("127.0.0.1");
  });

  test("vps writes HUB_URL + token + VAULT_PATH, no server-only keys", () => {
    const p = planInit(base({ answers: { profile: "vps", vaultPath: "/v", hubUrl: "http://100.1.2.3:3777" } }));
    expect(p.envUpdates.SCRYPT_HUB_URL).toBe("http://100.1.2.3:3777");
    expect(p.envUpdates.SCRYPT_VAULT_PATH).toBe("/v");
    expect(p.envUpdates.SCRYPT_BIND_ADDR).toBeUndefined();
  });
});

describe("planInit steps + idempotency", () => {
  test("native start: write-env, start-runtime, health-verify", () => {
    const p = planInit(base({}));
    expect(p.steps.map((s) => s.kind)).toEqual(["write-env", "start-runtime", "health-verify"]);
  });

  test("docker adds write-override step", () => {
    const p = planInit(base({ answers: { profile: "docker", vaultPath: "/v", ingestDir: "/ing" } }));
    expect(p.steps.some((s) => s.kind === "write-override")).toBe(true);
  });

  test("vps uses probe-hub, never starts a local server", () => {
    const p = planInit(base({ answers: { profile: "vps", vaultPath: "/v", hubUrl: "http://h:3777" } }));
    const kinds = p.steps.map((s) => s.kind);
    expect(kinds).toContain("probe-hub");
    expect(kinds).not.toContain("start-runtime");
  });

  test("--no-start omits start/verify steps", () => {
    const p = planInit(base({ noStart: true }));
    expect(p.steps.map((s) => s.kind)).toEqual(["write-env"]);
  });

  test("re-run with same strong token -> changed=false (zero churn)", () => {
    const existing = parseEnv(`SCRYPT_VAULT_PATH=/v\nSCRYPT_AUTH_TOKEN=${STRONG}\n`);
    const p = planInit(base({ existing, existingToken: STRONG, answers: { profile: "native", vaultPath: "/v" } }));
    expect(p.changed).toBe(false);
  });

  test("token is redacted in the diff", () => {
    const p = planInit(base({}));
    const tokenLine = p.redactedDiff.find((d) => d.startsWith("SCRYPT_AUTH_TOKEN="));
    expect(tokenLine).toContain("****");
    expect(tokenLine).not.toContain(CAND);
  });
});
