import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync } from "node:fs";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  const pluginDir = `${env.vaultPath}/plugins/test-plugin`;
  mkdirSync(pluginDir, { recursive: true });
  await Bun.write(
    `${pluginDir}/manifest.json`,
    JSON.stringify({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      entry: "index.js",
    }),
  );
  await Bun.write(
    `${pluginDir}/index.js`,
    "export function onLoad() { return 'loaded'; }",
  );
});
afterAll(() => env.cleanup());

describe("GET /api/plugins", () => {
  test("returns list of plugins with enabled state", async () => {
    const res = await fetch(`${env.baseUrl}/api/plugins`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((p: any) => p.id === "test-plugin")).toBe(true);
  });
});

describe("POST /api/plugins/:id/enable", () => {
  test("toggles plugin enabled state", async () => {
    const res = await fetch(`${env.baseUrl}/api/plugins/test-plugin/enable`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });
});
