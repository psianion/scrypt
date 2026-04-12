// tests/helpers.ts
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, type AppConfig } from "../src/server/index";

export function createTestEnv() {
  const vaultPath = mkdtempSync(join(tmpdir(), "scrypt-test-"));

  for (const dir of [
    "notes/inbox", "journal", "tasks", "templates", "skills",
    "plugins", "data", "assets", ".scrypt/trash", ".scrypt/public",
  ]) {
    mkdirSync(join(vaultPath, dir), { recursive: true });
  }

  // Write a minimal index.html for SPA tests
  Bun.write(join(vaultPath, ".scrypt", "public", "index.html"), "<html><body>Scrypt</body></html>");

  const app = createApp({ vaultPath, staticDir: join(vaultPath, ".scrypt", "public") });
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  const baseUrl = `http://localhost:${server.port}`;

  return {
    vaultPath,
    baseUrl,
    server,
    app,
    async writeNote(path: string, content: string) {
      const fullPath = join(vaultPath, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      await Bun.write(fullPath, content);
      // Give file watcher time to pick up the change and reindex
      await Bun.sleep(200);
    },
    async cleanup() {
      app.fm.stopWatching();
      // Wait for the startup reindex so no queries run after db.close().
      try {
        await app.ready;
      } catch {}
      server.stop();
      app.db.close();
      rmSync(vaultPath, { recursive: true, force: true });
    },
  };
}
