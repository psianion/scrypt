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

// Minimal stub for Bun.serve's second arg. createApp only calls it for /ws.
const fakeServer = {
  upgrade: () => false,
} as any;

async function callFetch(url: string, init?: RequestInit): Promise<Response> {
  const result = app.fetch(new Request(url, init), fakeServer);
  return await result;
}

describe("createApp > auth wiring", () => {
  test("production: /api/* without Authorization returns 401", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/api/notes");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  test("production: /api/* with correct Bearer token is not 401", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/api/notes", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).not.toBe(401);
  });

  test("production: static asset path bypasses auth (not 401)", async () => {
    makeApp({ isProduction: true, authToken: "secret" });
    const res = await callFetch("http://example.com/assets/foo.js");
    expect(res.status).not.toBe(401);
  });

  test("dev: localhost /api/* without Authorization is not 401", async () => {
    makeApp({ isProduction: false, authToken: "secret" });
    const res = await callFetch("http://127.0.0.1/api/notes");
    expect(res.status).not.toBe(401);
  });
});
