import { useEffect, useState } from "react";

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

interface Config {
  editor: { fontSize: number; tabSize: number; autoSaveDelay: number };
  vault: { trashRetentionDays: number };
}

export function Settings() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [config, setConfig] = useState<Config>({
    editor: { fontSize: 14, tabSize: 2, autoSaveDelay: 2000 },
    vault: { trashRetentionDays: 30 },
  });

  useEffect(() => {
    fetch("/api/plugins")
      .then((r) => r.json())
      .then(setPlugins)
      .catch(() => {});
  }, []);

  async function togglePlugin(id: string) {
    await fetch(`/api/plugins/${id}/enable`, { method: "POST" });
    setPlugins((ps) =>
      ps.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  }

  return (
    <div data-testid="settings" className="p-6 max-w-xl">
      <h2 className="text-lg text-[var(--text)] mb-4">Settings</h2>

      <section className="mb-6">
        <h3 className="text-sm text-[var(--text-muted)] uppercase tracking-wide mb-2">
          Editor
        </h3>
        <label className="flex items-center justify-between py-1 text-sm">
          <span className="text-[var(--text-muted)]">Font size</span>
          <input
            type="number"
            value={config.editor.fontSize}
            onChange={(e) =>
              setConfig({
                ...config,
                editor: { ...config.editor, fontSize: +e.target.value },
              })
            }
            className="w-16 px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)] text-sm"
          />
        </label>
        <label className="flex items-center justify-between py-1 text-sm">
          <span className="text-[var(--text-muted)]">Tab size</span>
          <input
            type="number"
            value={config.editor.tabSize}
            onChange={(e) =>
              setConfig({
                ...config,
                editor: { ...config.editor, tabSize: +e.target.value },
              })
            }
            className="w-16 px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)] text-sm"
          />
        </label>
        <label className="flex items-center justify-between py-1 text-sm">
          <span className="text-[var(--text-muted)]">
            Auto-save delay (ms)
          </span>
          <input
            type="number"
            value={config.editor.autoSaveDelay}
            onChange={(e) =>
              setConfig({
                ...config,
                editor: { ...config.editor, autoSaveDelay: +e.target.value },
              })
            }
            className="w-20 px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)] text-sm"
          />
        </label>
      </section>

      <section className="mb-6">
        <h3 className="text-sm text-[var(--text-muted)] uppercase tracking-wide mb-2">
          Vault
        </h3>
        <label className="flex items-center justify-between py-1 text-sm">
          <span className="text-[var(--text-muted)]">
            Trash retention (days)
          </span>
          <input
            type="number"
            value={config.vault.trashRetentionDays}
            onChange={(e) =>
              setConfig({
                ...config,
                vault: {
                  ...config.vault,
                  trashRetentionDays: +e.target.value,
                },
              })
            }
            className="w-16 px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)] text-sm"
          />
        </label>
      </section>

      <section>
        <h3 className="text-sm text-[var(--text-muted)] uppercase tracking-wide mb-2">
          Plugins
        </h3>
        {plugins.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-1.5">
            <div>
              <div className="text-sm text-[var(--text)]">{p.name}</div>
              <div className="text-xs text-[var(--text-muted)]">v{p.version}</div>
            </div>
            <button
              onClick={() => togglePlugin(p.id)}
              className={`px-3 py-0.5 text-xs rounded ${
                p.enabled
                  ? "bg-[var(--text-muted)] text-[var(--bg)]"
                  : "bg-[var(--surface-hover)] text-[var(--text-muted)]"
              }`}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        ))}
        {plugins.length === 0 && (
          <div className="text-sm text-[var(--text-muted)]">
            No plugins installed.
          </div>
        )}
      </section>
    </div>
  );
}
