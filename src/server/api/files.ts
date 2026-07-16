// src/server/api/files.ts
import { basename, join, normalize, sep } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Router } from "../router";

export function fileRoutes(router: Router, vaultPath: string): void {
  const assetsDir = join(vaultPath, "assets");

  function safePath(filePath: string): string | null {
    const resolved = normalize(join(assetsDir, filePath));
    if (resolved !== assetsDir && !resolved.startsWith(assetsDir + sep)) return null;
    return resolved;
  }

  router.post("/api/files/upload", async (req) => {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });

    // Multipart filenames are attacker-controlled — take the basename only
    // (strips any "../" traversal segments) and run it through the same
    // containment check as the GET handler below.
    const safeName = basename(file.name);
    const destPath = safePath(safeName);
    if (!safeName || !destPath) {
      return Response.json({ error: "Invalid filename" }, { status: 400 });
    }

    await mkdir(assetsDir, { recursive: true });
    await Bun.write(destPath, file);
    return Response.json({ path: `assets/${safeName}` }, { status: 201 });
  });

  router.get("/api/files/*path", (_req, params) => {
    const filePath = safePath(params.path);
    if (!filePath) return Response.json({ error: "Invalid path" }, { status: 400 });
    if (!existsSync(filePath)) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Bun.file(filePath));
  });
}
