import { test, expect } from "bun:test";
import { resolveStaticDir } from "../../src/server/static-dir";

const input = { env: undefined, repoDist: "/repo/dist", vaultDist: "/vault/dist" };

test("an explicit SCRYPT_STATIC_DIR always wins", () => {
  expect(resolveStaticDir({ ...input, env: "/app/dist" }, () => true)).toEqual({ dir: "/app/dist", source: "env" });
  expect(resolveStaticDir({ ...input, env: "/app/dist" }, () => false)).toEqual({ dir: "/app/dist", source: "env" });
});

test("a built repo dist is used when present, so a vault outside the repo gets the UI", () => {
  expect(resolveStaticDir(input, (p) => p === "/repo/dist")).toEqual({ dir: "/repo/dist", source: "repo" });
});

test("falls back to <vault>/dist when nothing is built", () => {
  expect(resolveStaticDir(input, () => false)).toEqual({ dir: "/vault/dist", source: "vault" });
  expect(resolveStaticDir({ ...input, env: "  " }, () => false).source).toBe("vault");
});
