import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  __resetSnapshotCache,
  fetchSnapshot,
  __getSnapshotState,
} from "../../../src/client/graph/useGraphSnapshot";
import type { GraphSnapshot } from "../../../src/server/graph/snapshot";

const sampleSnap: GraphSnapshot = {
  generated_at: 1,
  nodes: [],
  edges: [],
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetSnapshotCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useGraphSnapshot fetchSnapshot", () => {
  test("sends If-None-Match on second call after a 200 with ETag", async () => {
    let callCount = 0;
    const seenHeaders: Array<string | null> = [];
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      callCount++;
      const ifNoneMatch =
        (init?.headers && (init.headers as Record<string, string>)["If-None-Match"]) ??
        null;
      seenHeaders.push(ifNoneMatch);
      if (callCount === 1) {
        return new Response(JSON.stringify(sampleSnap), {
          status: 200,
          headers: { ETag: '"abc123"', "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 304, headers: { ETag: '"abc123"' } });
    }) as any;

    const first = await fetchSnapshot(true);
    expect(first.generated_at).toBe(1);
    expect(seenHeaders[0]).toBeNull();
    expect(__getSnapshotState().etag).toBe('"abc123"');

    const second = await fetchSnapshot(true);
    expect(second).toBe(first);
    expect(seenHeaders[1]).toBe('"abc123"');
    expect(callCount).toBe(2);
  });

  test("304 reuses cached body without re-parsing JSON", async () => {
    let parsedCount = 0;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        const body = JSON.stringify(sampleSnap);
        const res = new Response(body, {
          status: 200,
          headers: { ETag: '"v1"', "Content-Type": "application/json" },
        });
        const origJson = res.json.bind(res);
        (res as any).json = async () => {
          parsedCount++;
          return origJson();
        };
        return res;
      }
      const r = new Response(null, { status: 304, headers: { ETag: '"v1"' } });
      (r as any).json = async () => {
        parsedCount++;
        return {};
      };
      return r;
    }) as any;

    const a = await fetchSnapshot(true);
    const b = await fetchSnapshot(true);
    expect(a).toBe(b);
    expect(parsedCount).toBe(1);
  });

  test("populates lastError on fetch failure and exposes staleSince when prior cache existed", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify(sampleSnap), {
          status: 200,
          headers: { ETag: '"e1"' },
        });
      }
      throw new Error("network down");
    }) as any;

    await fetchSnapshot(true);
    expect(__getSnapshotState().lastError).toBeNull();
    expect(__getSnapshotState().staleSince).toBeNull();

    await expect(fetchSnapshot(true)).rejects.toThrow("network down");
    const s = __getSnapshotState();
    expect(s.lastError).toBeInstanceOf(Error);
    expect(s.lastError?.message).toBe("network down");
    expect(s.staleSince).not.toBeNull();
    // cache preserved
    expect(s.cache?.snap.generated_at).toBe(1);
  });
});
