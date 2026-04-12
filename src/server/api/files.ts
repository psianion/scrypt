// src/server/api/files.ts
import { join, normalize } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Router } from "../router";

export function fileRoutes(router: Router, vaultPath: string): void {
  const assetsDir = join(vaultPath, "assets");

  function safePath(filePath: string): string | null {
    const resolved = normalize(join(assetsDir, filePath));
    if (!resolved.startsWith(assetsDir)) return null;
    return resolved;
  }

  router.post("/api/files/upload", async (req) => {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

    await mkdir(assetsDir, { recursive: true });
    const destPath = join(assetsDir, file.name);
    await Bun.write(destPath, file);
    return Response.json({ path: `assets/${file.name}` }, { status: 201 });
  });

  router.get("/api/files/*path", (_req, params) => {
    const filePath = safePath(params.path);
    if (!filePath) return Response.json({ error: "Invalid path" }, { status: 400 });
    if (!existsSync(filePath)) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Bun.file(filePath));
  });
}
