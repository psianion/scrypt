import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRepo, commitPending } from "../../src/server/git-autocommit";
import { $ } from "bun";

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-git-"));
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("initRepo", () => {
  test("initializes a git repo if none exists", async () => {
    await initRepo(vaultPath);
    expect(existsSync(join(vaultPath, ".git"))).toBe(true);
  });

  test("is idempotent — running twice does not error", async () => {
    await initRepo(vaultPath);
    await initRepo(vaultPath);
    expect(existsSync(join(vaultPath, ".git"))).toBe(true);
  });

  test("writes a .gitignore excluding .scrypt/scrypt.db*", async () => {
    await initRepo(vaultPath);
    const gi = await Bun.file(join(vaultPath, ".gitignore")).text();
    expect(gi).toContain(".scrypt/scrypt.db");
  });
});

describe("commitPending", () => {
  test("returns null when there are no changes", async () => {
    await initRepo(vaultPath);
    writeFileSync(join(vaultPath, "note.md"), "initial");
    await $`git -C ${vaultPath} add -A`.quiet();
    await $`git -C ${vaultPath} -c user.email=s@s -c user.name=s commit -m initial`.quiet();

    const result = await commitPending(vaultPath);
    expect(result).toBeNull();
  });

  test("commits pending changes and returns the new sha", async () => {
    await initRepo(vaultPath);
    writeFileSync(join(vaultPath, "a.md"), "one");
    const result = await commitPending(vaultPath);
    expect(result).not.toBeNull();
    expect(result!.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(result!.fileCount).toBeGreaterThanOrEqual(1);
  });
});
