import { test, expect } from "bun:test";
import { join, resolve } from "node:path";
import { resolveMcpEnv } from "../../../src/server/mcp/context-factory";

test("stdio bridge follows the server's layout: vault from SCRYPT_VAULT_PATH, db + cache under <vault>/.scrypt", () => {
  const r = resolveMcpEnv({ SCRYPT_VAULT_PATH: "/data/vault" }, "/repo");
  expect(r.vaultDir).toBe(resolve("/data/vault"));
  expect(r.dbPath).toBe(join(resolve("/data/vault"), ".scrypt", "scrypt.db"));
  expect(r.cacheDir).toBe(join(resolve("/data/vault"), ".scrypt", "embed-cache"));
  expect(r.model).toBe("Xenova/bge-small-en-v1.5");
});

test("SCRYPT_VAULT_DIR still wins for Docker, and explicit db/cache overrides are honoured", () => {
  const r = resolveMcpEnv({ SCRYPT_VAULT_DIR: "/vault", SCRYPT_VAULT_PATH: "/ignored", SCRYPT_DB_PATH: "/x/db.sqlite", SCRYPT_EMBED_CACHE_DIR: "/x/cache" }, "/repo");
  expect(r.vaultDir).toBe(resolve("/vault"));
  expect(r.dbPath).toBe("/x/db.sqlite");
  expect(r.cacheDir).toBe("/x/cache");
});

test("with no env at all the vault is the current directory, never a ./vault folder beside the repo", () => {
  const r = resolveMcpEnv({}, "/here");
  expect(r.vaultDir).toBe(resolve("/here"));
  expect(r.dbPath).toBe(join(resolve("/here"), ".scrypt", "scrypt.db"));
});
