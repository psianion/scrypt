import type { Database } from "bun:sqlite";
import { writeGraphSnapshot } from "./snapshot";

export interface SchedulerOpts {
  debounceMs?: number;
}

export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pendingAfterCurrent = false;
  private readonly debounceMs: number;

  /** Number of successful builds. Exposed for tests. */
  buildCount = 0;

  constructor(
    private db: Database,
    private vaultDir: string,
    opts: SchedulerOpts = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 2000;
  }

  /** Enqueue a rebuild. Coalesces repeated calls within the debounce window. */
  schedule(): void {
    if (this.running) {
      this.pendingAfterCurrent = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Build synchronously, clearing any pending debounce. Awaits the write. */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.running) {
      this.pendingAfterCurrent = true;
      return;
    }
    this.running = true;
    try {
      writeGraphSnapshot(this.db, this.vaultDir);
      this.buildCount += 1;
    } catch (err) {
      console.error("[scrypt] snapshot write failed:", err);
    } finally {
      this.running = false;
      if (this.pendingAfterCurrent) {
        this.pendingAfterCurrent = false;
        // chain one more build, same debounce
        this.schedule();
      }
    }
  }
}
