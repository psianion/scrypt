// src/server/git-autocommit.ts
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const GITIGNORE_CONTENT = `
.scrypt/scrypt.db
.scrypt/scrypt.db-shm
.scrypt/scrypt.db-wal
.scrypt/trash/
.DS_Store
`.trimStart();

export async function initRepo(vaultPath: string): Promise<void> {
  const gitDir = join(vaultPath, ".git");
  if (!existsSync(gitDir)) {
    await $`git -C ${vaultPath} init -q`.quiet();
    await $`git -C ${vaultPath} config user.email "scrypt@local"`.quiet();
    await $`git -C ${vaultPath} config user.name "Scrypt"`.quiet();
  }
  const giPath = join(vaultPath, ".gitignore");
  if (!existsSync(giPath)) {
    await Bun.write(giPath, GITIGNORE_CONTENT);
  }
}

interface CommitResult {
  sha: string;
  fileCount: number;
  timestamp: string;
}

export async function commitPending(
  vaultPath: string,
): Promise<CommitResult | null> {
  try {
    const status = await $`git -C ${vaultPath} status --porcelain`.quiet().text();
    if (status.trim() === "") return null;
    const fileCount = status.trim().split("\n").length;
    const timestamp = new Date().toISOString();
    await $`git -C ${vaultPath} add -A`.quiet();
    await $`git -C ${vaultPath} commit -m ${`scrypt snapshot ${timestamp}`}`.quiet();
    const sha = (await $`git -C ${vaultPath} rev-parse --short HEAD`.quiet().text()).trim();
    return { sha, fileCount, timestamp };
  } catch (err) {
    console.error("[git-autocommit] commit failed:", err);
    return null;
  }
}

export interface AutocommitLoop {
  stop: () => void;
}

export function startAutocommitLoop(opts: {
  vaultPath: string;
  intervalSeconds: number;
  onCommit?: (r: CommitResult) => void;
}): AutocommitLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    const result = await commitPending(opts.vaultPath);
    if (result && opts.onCommit) opts.onCommit(result);
    if (!stopped) {
      timer = setTimeout(tick, opts.intervalSeconds * 1000);
    }
  };

  timer = setTimeout(tick, opts.intervalSeconds * 1000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
