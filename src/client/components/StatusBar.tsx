import { useMemo } from "react";
import { Activity, FolderTree } from "lucide-react";
import { Breadcrumb, type BreadcrumbItem } from "@/client/ui/Breadcrumb";
import { Chip } from "@/client/ui/Chip";
import { useStore } from "../store";
import { useEmbeddingProgress } from "../stores/embeddingProgress";
import "./StatusBar.css";

/**
 * StatusBar — bottom strip of the editor column.
 *
 * Visuals copied verbatim from `docs/pencils/03-navigation-overlays.md
 * §Status Bar & Activity Strip`. Three-slot layout:
 *
 *   [ left: Breadcrumb of currentNote.path ]
 *   [ middle: project filter chip — only when the active note has a project ]
 *   [ right: indexing indicator, sync dot, "Scrypt" brand pill ]
 *
 * ActivityStrip stays a separate component (rendered elsewhere in the layout)
 * per the plan; this status bar only mirrors its idle/active state via a
 * single indicator + dot.
 */
export function StatusBar() {
  const currentNote = useStore((s) => s.currentNote);
  const inFlight = useEmbeddingProgress((s) => s.inFlight);

  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    if (!currentNote?.path) return [];
    const segments = currentNote.path.split("/").filter(Boolean);
    return segments.map((seg) => ({ label: seg }));
  }, [currentNote?.path]);

  const project = currentNote?.project ?? null;
  const indexingCount = Object.keys(inFlight).length;
  const isIdle = indexingCount === 0;

  return (
    <footer className="status-bar" data-testid="status-bar" role="contentinfo">
      <div className="status-bar-slot status-bar-slot--left">
        {breadcrumbItems.length > 0 ? (
          <Breadcrumb
            items={breadcrumbItems}
            aria-label="Note location"
            maxVisible={5}
          />
        ) : (
          <span className="status-bar-empty">No file open</span>
        )}
      </div>

      <div className="status-bar-slot status-bar-slot--middle">
        {project ? (
          <Chip variant="tag" data-testid="status-bar-project">
            <FolderTree size={11} strokeWidth={2} aria-hidden />
            {project}
          </Chip>
        ) : null}
      </div>

      <div className="status-bar-slot status-bar-slot--right">
        <span
          className="status-bar-indicator"
          data-testid="status-bar-activity"
          aria-live="polite"
        >
          <Activity size={11} strokeWidth={2} aria-hidden />
          {isIdle ? "idle" : `indexing ${indexingCount}`}
        </span>
        <span
          className="status-bar-dot"
          data-testid="status-bar-dot"
          aria-hidden
        />
        <span className="status-bar-brand" data-testid="status-bar-brand">
          Scrypt
        </span>
      </div>
    </footer>
  );
}
