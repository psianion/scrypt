import { useStore } from "../store";

export function StatusBar() {
  const currentNote = useStore((s) => s.currentNote);

  return (
    <footer
      data-testid="status-bar"
      className="flex items-center justify-between px-3 py-1 text-xs text-[var(--text-muted)] border-t border-[var(--border)] bg-[var(--bg-secondary)]"
    >
      <span>{currentNote?.path || "No file open"}</span>
      <span>Scrypt</span>
    </footer>
  );
}
