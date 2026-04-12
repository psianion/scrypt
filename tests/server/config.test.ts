import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type ScryptConfig } from "../../src/server/config";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SCRYPT_") || k === "NODE_ENV") delete process.env[k];
  }
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  test("returns defaults when no env vars set", () => {
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.port).toBe(3777);
    expect(cfg.vaultPath).toBe("/tmp/v");
    expect(cfg.gitAutocommit).toBe(false);
    expect(cfg.gitAutocommitInterval).toBe(900);
    expect(cfg.trashRetentionDays).toBe(30);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.isProduction).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  test("reads SCRYPT_AUTH_TOKEN", () => {
    process.env.SCRYPT_AUTH_TOKEN = "secret-123";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.authToken).toBe("secret-123");
  });

  test("reads SCRYPT_PORT as number", () => {
    process.env.SCRYPT_PORT = "4000";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.port).toBe(4000);
  });

  test("reads SCRYPT_GIT_AUTOCOMMIT=1 as true", () => {
    process.env.SCRYPT_GIT_AUTOCOMMIT = "1";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.gitAutocommit).toBe(true);
  });

  test("reads NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.SCRYPT_AUTH_TOKEN = "x";
    const cfg = loadConfig({ vaultPath: "/tmp/v" });
    expect(cfg.isProduction).toBe(true);
  });

  test("throws in production when SCRYPT_AUTH_TOKEN is missing", () => {
    process.env.NODE_ENV = "production";
    expect(() => loadConfig({ vaultPath: "/tmp/v" })).toThrow(
      /SCRYPT_AUTH_TOKEN/,
    );
  });

  test("does not throw in dev when SCRYPT_AUTH_TOKEN is missing", () => {
    expect(() => loadConfig({ vaultPath: "/tmp/v" })).not.toThrow();
  });
});
