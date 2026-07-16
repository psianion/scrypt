// tests/server/schema-doc.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SCHEMA_FILENAME,
  ensureSchemaDoc,
  readSchemaDoc,
  schemaRoutes,
} from "../../src/server/schema-doc";
import { Router } from "../../src/server/router";

let vaultPath: string;

beforeEach(() => {
  vaultPath = mkdtempSync(join(tmpdir(), "scrypt-schema-"));
});

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe("ensureSchemaDoc", () => {
  test("seeds SCHEMA.md from the bundled template when missing", () => {
    expect(ensureSchemaDoc(vaultPath)).toBe(true);
    const seeded = readFileSync(join(vaultPath, SCHEMA_FILENAME), "utf-8");
    expect(seeded).toContain("# Vault Schema");
  });

  test("never overwrites an existing SCHEMA.md", () => {
    writeFileSync(join(vaultPath, SCHEMA_FILENAME), "# mine\n");
    expect(ensureSchemaDoc(vaultPath)).toBe(false);
    expect(readFileSync(join(vaultPath, SCHEMA_FILENAME), "utf-8")).toBe("# mine\n");
  });
});

describe("readSchemaDoc", () => {
  test("returns content when present", () => {
    writeFileSync(join(vaultPath, SCHEMA_FILENAME), "# hello\n");
    expect(readSchemaDoc(vaultPath)).toBe("# hello\n");
  });

  test("returns null when absent", () => {
    expect(existsSync(join(vaultPath, SCHEMA_FILENAME))).toBe(false);
    expect(readSchemaDoc(vaultPath)).toBeNull();
  });
});

describe("GET /api/schema", () => {
  test("serves the doc as markdown", async () => {
    writeFileSync(join(vaultPath, SCHEMA_FILENAME), "# hello\n");
    const router = new Router();
    schemaRoutes(router, vaultPath);
    const res = await router.handle(new Request("http://x/api/schema"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toContain("text/markdown");
    expect(await res!.text()).toBe("# hello\n");
  });

  test("404 when the vault has no SCHEMA.md", async () => {
    const router = new Router();
    schemaRoutes(router, vaultPath);
    const res = await router.handle(new Request("http://x/api/schema"));
    expect(res!.status).toBe(404);
  });
});
