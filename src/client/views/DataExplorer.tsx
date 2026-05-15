import { useEffect, useState } from "react";
import { api } from "../api";
import { CsvEmbed } from "./CsvEmbed";

export function DataExplorer() {
  const [files, setFiles] = useState<{ file: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.data.list().then(setFiles).catch(() => {});
  }, []);

  return (
    <div data-testid="data-explorer" className="flex h-full">
      <div className="w-48 border-r border-[var(--border)] p-3 overflow-y-auto">
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Data Files
        </div>
        {files.map((f) => (
          <button
            key={f.file}
            onClick={() => setSelected(f.file)}
            className={`block w-full text-left px-2 py-1 text-sm rounded ${
              selected === f.file
                ? "bg-[var(--surface-hover)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {f.file}
          </button>
        ))}
      </div>
      <div className="flex-1 p-4 overflow-auto">
        {selected ? (
          <CsvEmbed file={selected} />
        ) : (
          <div className="text-[var(--text-muted)]">Select a file to preview.</div>
        )}
      </div>
    </div>
  );
}
