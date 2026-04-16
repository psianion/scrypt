// tests/server/embeddings/recovery.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverPendingEmbeds } from "../../../src/server/embeddings/recovery";
import type { EmbedderLike } from "../../../src/server/embeddings/service";

function tmpVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "scrypt-recover-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

test("recoverPendingEmbeds: enqueues every .md in the vault", async () => {
  const vault = tmpVault({
    "notes/a.md": "# a\nbody",
    "notes/b.md": "# b\nbody",
    "journal/2026-04-14.md": "# day\n",
    ".scrypt/skip.md": "should be ignored",
    "ignore.txt": "should be ignored",
  });
  const calls: string[] = [];
  const fakeClient: EmbedderLike = {
    async embedNote(parsed) {
      calls.push(parsed.notePath);
      return { chunks_total: 0, chunks_embedded: 0, embed_ms: 0 };
    },
  };

  const summary = await recoverPendingEmbeds({
    vaultDir: vault,
    client: fakeClient,
    log: () => {},
  });

  expect(calls.sort()).toEqual([
    "journal/2026-04-14.md",
    "notes/a.md",
    "notes/b.md",
  ]);
  expect(summary.total).toBe(3);
});

test("recoverPendingEmbeds: sequential — never more than 1 call in flight at a time", async () => {
  // Regression for the bulk-load bug: recovery used to fire-and-forget
  // every note at once, which blew past EmbedClient's per-request 60 s
  // timer because queue wait counts against each timer. Here we use a
  // fake client that takes a visible tick to resolve, and assert that
  // recovery never overlaps calls.
  const vault = tmpVault({
    "a.md": "# a\n",
    "b.md": "# b\n",
    "c.md": "# c\n",
    "d.md": "# d\n",
    "e.md": "# e\n",
  });
  let inFlight = 0;
  let maxInFlight = 0;
  const order: string[] = [];
  const fakeClient: EmbedderLike = {
    async embedNote(parsed) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(parsed.notePath);
      // Yield twice so any parallel call would be observable.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return { chunks_total: 0, chunks_embedded: 0, embed_ms: 0 };
    },
  };

  const summary = await recoverPendingEmbeds({
    vaultDir: vault,
    client: fakeClient,
    log: () => {},
  });

  expect(maxInFlight).toBe(1);
  expect(summary.total).toBe(5);
  expect(summary.failed).toBe(0);
  expect(order.length).toBe(5);
});

test("recoverPendingEmbeds: client failure does not abort the walk", async () => {
  const vault = tmpVault({
    "a.md": "# a\n",
    "b.md": "# b\n",
    "c.md": "# c\n",
  });
  let calls = 0;
  const fakeClient: EmbedderLike = {
    async embedNote(parsed) {
      calls += 1;
      if (parsed.notePath === "b.md") throw new Error("transient");
      return { chunks_total: 0, chunks_embedded: 0, embed_ms: 0 };
    },
  };

  const summary = await recoverPendingEmbeds({
    vaultDir: vault,
    client: fakeClient,
    log: () => {},
  });

  expect(calls).toBe(3);
  expect(summary.total).toBe(3);
  expect(summary.failed).toBe(1);
});
