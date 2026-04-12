// src/server/api/plugins.ts
import { join } from "node:path";
import type { Router } from "../router";
import { PluginLoader } from "../plugins/loader";

export function pluginRoutes(router: Router, vaultPath: string): void {
  const loader = new PluginLoader(join(vaultPath, "plugins"));

  router.get("/api/plugins", async () => {
    await loader.scan();
    return Response.json(
      loader.list().map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        enabled: p.enabled,
      })),
    );
  });

  router.post("/api/plugins/:id/enable", async (_req, params) => {
    await loader.scan();
    const ok = await loader.enable(params.id);
    if (!ok) return Response.json({ error: "Plugin not found" }, { status: 404 });
    return Response.json({ toggled: params.id });
  });
}
