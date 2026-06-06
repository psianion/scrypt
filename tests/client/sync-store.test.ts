import { test, expect, afterEach } from "bun:test";
import { api } from "../../src/client/api";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("api.sync.status hits /api/sync/status and returns the parsed body", async () => {
  let calledUrl = "";
  globalThis.fetch = (async (url: string) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ ok: true, counts: { push: 1, pull: 0, clash: 0 }, notPushed: ["a.md"], clashes: [], toPull: [], removedOnHub: [], checkedAt: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  const body = await api.sync.status();
  expect(calledUrl).toContain("/api/sync/status");
  expect(body.ok).toBe(true);
});

test("api.sync.resolve POSTs path + content", async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_url: string, i?: RequestInit) => { init = i; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  await api.sync.resolve("projects/p/notes/v.md", "merged");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual({ path: "projects/p/notes/v.md", content: "merged" });
});

import { useSyncStatus, syncDotState } from "../../src/client/stores/syncStatus";

test("syncDotState: clash beats not_pushed beats in_sync", () => {
  const np = new Set(["a.md", "b.md"]);
  const cl = new Set(["b.md"]);
  expect(syncDotState("b.md", np, cl)).toBe("clash");      // in both → clash wins
  expect(syncDotState("a.md", np, cl)).toBe("not_pushed");
  expect(syncDotState("c.md", np, cl)).toBe("in_sync");
});

test("refreshLocal populates notPushed from api.sync.localStatus", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ notPushed: ["a.md"] }), { status: 200 })) as unknown as typeof fetch;
  await useSyncStatus.getState().refreshLocal();
  expect([...useSyncStatus.getState().notPushed]).toEqual(["a.md"]);
});

test("refreshHub on hub_unreachable sets hubReachable false and keeps last clashes", async () => {
  useSyncStatus.setState({ clashes: new Set(["x.md"]), hubReachable: true });
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "hub_unreachable" }), { status: 200 })) as unknown as typeof fetch;
  await useSyncStatus.getState().refreshHub();
  expect(useSyncStatus.getState().hubReachable).toBe(false);
  expect([...useSyncStatus.getState().clashes]).toEqual(["x.md"]); // preserved
});

import { useSyncStatus as store2 } from "../../src/client/stores/syncStatus";

test("refreshLocal is callable and updates the store (used by Editor post-save + App load)", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ notPushed: ["z.md"] }), { status: 200 })) as unknown as typeof fetch;
  await store2.getState().refreshLocal();
  expect([...store2.getState().notPushed]).toContain("z.md");
});
