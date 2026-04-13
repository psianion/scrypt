import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMaintenance } from "../../src/server/cli";

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-maint-"));
  mkdirSync(join(vaultPath, ".scrypt", "trash"), { recursive: true });
});
afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("runMaintenance", () => {
  test("prunes trash files older than the threshold", async () => {
    const oldFile = join(vaultPath, ".scrypt", "trash", "old.md");
    const newFile = join(vaultPath, ".scrypt", "trash", "new.md");
    writeFileSync(oldFile, "old");
    writeFileSync(newFile, "new");
    // Backdate oldFile by 60 days via utimesSync (portable; Bun's shell touch
    // does not support -t).
    const pastSec = (Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(oldFile, pastSec, pastSec);

    const result = await runMaintenance({
      vaultPath,
      trashRetentionDays: 30,
    });

    expect(result.trashPruned).toBe(1);
    expect(Bun.file(oldFile).size > 0).toBe(false);
  });

  test("returns counts for every step", async () => {
    const result = await runMaintenance({
      vaultPath,
      trashRetentionDays: 30,
    });
    expect(result).toHaveProperty("trashPruned");
    expect(result).toHaveProperty("vacuumed");
    expect(result).toHaveProperty("ftsRebuilt");
  });
});
