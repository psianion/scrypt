import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/server/index";

let vaultPath: string;
let app: ReturnType<typeof createApp>;

function makeApp(opts: { isProduction: boolean; authToken?: string }) {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-app-auth-"));
  for (const dir of [
    "notes/inbox", "journal", "tasks", "templates", "skills",
    "plugins", "data", "assets", ".scrypt/trash", ".scrypt/public",
  ]) {
    mkdirSync(join(vaultPath, dir), { recursive: true });
  }
  Bun.write(
    join(vaultPath, ".scrypt", "public", "index.html"),
    "<html><body>Scrypt</body></html>",
  );
  app = createApp({
    vaultPath,
    staticDir: join(vaultPath, ".scrypt", "public"),
    isProduction: opts.isProduction,
    authToken: opts.authToken,
  });
  return app;
}

async function cleanup() {
  app.fm.stopWatching();
  try {
    await app.ready;
  } catch {}
  app.db.close();
  rmSync(vaultPath, { recursive: true, force: true });
}

afterEach(async () => {
  await cleanup();
});

// Minimal stub for Bun.serve's second arg: upgrade() for /ws and requestIP()
// for the real-socket-peer auth check (auth.ts). checkAuth's loopback trust
// is now keyed on this, NOT the request URL/Host header, so every call site
// below must say explicitly whether it's simulating a loopback or a remote
// caller — there is no default.
function fakeServer(peerAddress: string | null) {
  return {
    upgrade: () => false,
    requestIP: () => (peerAddress ? { address: peerAddress } : null),
  } as any;
}
const LOOPBACK = fakeServer("127.0.0.1");
const REMOTE = fakeServer("203.0.113.5");

async function callFetch(url: string, init: RequestInit | undefined, server: any): Promise<Response> {
  const result = app.fetch(new Request(url, init), server);
  return await result;
}

describe("createApp > auth wiring", () => {
  test("production: /api/* without Authorization returns 401", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/api/notes", undefined, REMOTE);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  test("production: /api/* with correct Bearer token is not 401", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch(
      "http://example.com/api/notes",
      { headers: { Authorization: "Bearer secret" } },
      REMOTE,
    );
    expect(res.status).not.toBe(401);
  });

  test("production: static asset path bypasses auth (not 401)", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/assets/foo.js", undefined, REMOTE);
    expect(res.status).not.toBe(401);
  });

  test("dev: genuine loopback peer /api/* without Authorization is not 401", async () => {
    makeApp({ isProduction: false, authToken: "secret" });
    const res = await callFetch("http://127.0.0.1/api/notes", undefined, LOOPBACK);
    expect(res.status).not.toBe(401);
  });

  test("Host-header spoof does not bypass auth for a real remote peer", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    // Host looks like localhost, but the fake server reports a remote TCP peer.
    const res = await callFetch("http://localhost/api/notes", undefined, REMOTE);
    expect(res.status).toBe(401);
  });

  test("/ws upgrade is rejected for a remote peer without a token", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/ws", undefined, REMOTE);
    expect(res.status).toBe(401);
  });

  test("/ws upgrade proceeds for a genuine loopback peer without a token", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://127.0.0.1/ws", undefined, LOOPBACK);
    // fakeServer.upgrade() always returns false in this stub, so a successful
    // pass through the auth gate surfaces as the "upgrade failed" 400, not 401.
    expect(res.status).not.toBe(401);
  });

  test("POST /mcp from a remote peer without a token returns 401 (not an authenticated 'local' user)", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch(
      "http://example.com/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      REMOTE,
    );
    expect(res.status).toBe(401);
  });

  test("POST /mcp from a genuine loopback peer without a token is authenticated", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch(
      "http://127.0.0.1/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      LOOPBACK,
    );
    expect(res.status).toBe(200);
  });

  test("POST /mcp Host-header spoof does not authenticate a real remote peer", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch(
      "http://localhost/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      REMOTE,
    );
    expect(res.status).toBe(401);
  });

  test("static file serving cannot escape staticDir via path traversal", async () => {
    makeApp({ isProduction: false, authToken: undefined });
    const res = await callFetch(
      "http://127.0.0.1/..%2F..%2F..%2F.env",
      undefined,
      LOOPBACK,
    );
    // Falls through to the SPA index shell / 404 — never the real .env content.
    const text = await res.text();
    expect(text).not.toContain("SCRYPT_AUTH_TOKEN");
  });
});

describe("createApp > auth wiring > Wave 3 routes require auth in production", () => {
  const routes: Array<[string, string, RequestInit | undefined]> = [
    ["POST /api/ingest", "http://example.com/api/ingest", { method: "POST" }],
    ["GET /api/threads", "http://example.com/api/threads", undefined],
    ["GET /api/threads/:slug", "http://example.com/api/threads/x", undefined],
    ["POST /api/research_runs", "http://example.com/api/research_runs", { method: "POST" }],
    ["GET /api/research_runs", "http://example.com/api/research_runs", undefined],
    ["GET /api/memories", "http://example.com/api/memories", undefined],
    ["GET /api/daily_context", "http://example.com/api/daily_context", undefined],
    ["GET /api/activity", "http://example.com/api/activity", undefined],
    ["GET /api/graph", "http://example.com/api/graph", undefined],
    ["GET /api/graph/*path", "http://example.com/api/graph/notes/x.md", undefined],
  ];

  for (const [label, url, init] of routes) {
    test(`${label} returns 401 without Authorization`, async () => {
      makeApp({ isProduction: true, authToken: "secret" });
      const res = await callFetch(url, init, REMOTE);
      expect(res.status).toBe(401);
    });
  }
});
