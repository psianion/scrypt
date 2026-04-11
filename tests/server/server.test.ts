// tests/server/server.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/server/index";

let vaultPath: string;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(async () => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-srv-test-"));
  for (const dir of ["notes/inbox", "journal", "tasks", "templates", "skills", "plugins", "data", "assets", ".scrypt/trash"]) {
    mkdirSync(join(vaultPath, dir), { recursive: true });
  }

  const app = createApp({ vaultPath });
  server = Bun.serve({
    port: 0,
    fetch: app.fetch,
    websocket: app.websocket,
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop();
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("server", () => {
  test("starts and responds to requests", async () => {
    const res = await fetch(`${baseUrl}/api/notes`);
    expect(res.status).toBe(200);
  });

  test("returns 404 for unknown API routes", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("serves index.html for SPA fallback routes", async () => {
    // Write a fake index.html
    await Bun.write(join(vaultPath, ".scrypt", "public", "index.html"), "<html><body>SPA</body></html>");

    const app = createApp({ vaultPath, staticDir: join(vaultPath, ".scrypt", "public") });
    const srv = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
    const res = await fetch(`http://localhost:${srv.port}/some/route`);
    const text = await res.text();
    expect(text).toContain("SPA");
    srv.stop();
  });
});
