// src/client/components/SplitPane.tsx
import { useState, useCallback, Children, type ReactNode } from "react";

export function SplitPane({ children }: { children: ReactNode }) {
  const [splitRatio, setSplitRatio] = useState(50);
  const childArray = Children.toArray(children);

  const onMouseDown = useCallback(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ratio = (e.clientX / window.innerWidth) * 100;
      setSplitRatio(Math.max(20, Math.min(80, ratio)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  if (childArray.length < 2) return <div data-testid="split-pane">{children}</div>;

  return (
    <div data-testid="split-pane" className="flex h-full w-full">
      <div style={{ width: `${splitRatio}%` }} className="overflow-auto">{childArray[0]}</div>
      <div
        data-testid="split-divider"
        className="w-1 bg-[var(--border)] cursor-col-resize hover:bg-[var(--text-muted)] flex-shrink-0"
        onMouseDown={onMouseDown}
      />
      <div style={{ width: `${100 - splitRatio}%` }} className="overflow-auto">{childArray[1]}</div>
    </div>
  );
}
