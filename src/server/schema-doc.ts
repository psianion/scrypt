// src/server/schema-doc.ts
//
// SCHEMA.md is the vault's agent-facing conventions doc: it tells any LLM
// (via MCP `instructions` on initialize, or GET /api/schema) how to maintain
// the vault. It lives at the vault root so the human and the LLM co-evolve
// one copy; the bundled template only seeds it when missing.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router";

export const SCHEMA_FILENAME = "SCHEMA.md";

// src/server/ → repo root → templates/. Shipped in the Docker image via an
// explicit COPY in the Dockerfile.
const BUNDLED_TEMPLATE = join(import.meta.dir, "../../templates/SCHEMA.md");

/** Seed <vault>/SCHEMA.md from the bundled template if it doesn't exist. */
export function ensureSchemaDoc(vaultPath: string): boolean {
  const target = join(vaultPath, SCHEMA_FILENAME);
  if (existsSync(target)) return false;
  if (!existsSync(BUNDLED_TEMPLATE)) return false;
  copyFileSync(BUNDLED_TEMPLATE, target);
  return true;
}

/** Read the vault's SCHEMA.md, or null when absent/unreadable. */
export function readSchemaDoc(vaultPath: string): string | null {
  try {
    return readFileSync(join(vaultPath, SCHEMA_FILENAME), "utf-8");
  } catch {
    return null;
  }
}

export function schemaRoutes(router: Router, vaultPath: string): void {
  router.get("/api/schema", () => {
    const doc = readSchemaDoc(vaultPath);
    if (doc === null) {
      return Response.json(
        { error: `${SCHEMA_FILENAME} not found at vault root` },
        { status: 404 },
      );
    }
    return new Response(doc, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });
}
