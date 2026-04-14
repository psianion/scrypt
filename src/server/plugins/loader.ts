// src/server/plugins/loader.ts
import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { PluginManifest } from "../../shared/types";

interface LoadedPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  module: any | null;
}

export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>();

  constructor(private pluginsDir: string) {}

  async scan(): Promise<void> {
    try {
      const entries = await readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(this.pluginsDir, entry.name, "manifest.json");
        if (!existsSync(manifestPath)) continue;

        const raw = await readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as PluginManifest;
        this.plugins.set(manifest.id, { manifest, enabled: false, module: null });
      }
    } catch {}
  }

  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  async enable(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.enabled = !plugin.enabled;

    if (plugin.enabled && !plugin.module) {
      try {
        const modulePath = join(this.pluginsDir, id, plugin.manifest.entry);
        plugin.module = await import(modulePath);
        plugin.module?.onLoad?.();
      } catch {
        plugin.enabled = false;
        return false;
      }
    } else if (!plugin.enabled && plugin.module) {
      plugin.module?.onUnload?.();
    }

    return true;
  }
}
