import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Kbd } from "../Chip";
import "./ContextMenu.css";

export type ContextMenuItemVariant = "default" | "destructive";

export interface ContextMenuItem {
  /** Stable id. Optional — falls back to index for keyboard nav state. */
  id?: string;
  label: string;
  icon?: ReactNode;
  /** Renders inside a <Kbd> on the right. Plain string, e.g. "⌘K". */
  shortcut?: string;
  variant?: ContextMenuItemVariant;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return (entry as ContextMenuSeparator).separator === true;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

type TriggerProps = {
  /** A single React element. We clone it to attach onContextMenu. */
  trigger: ReactElement;
  items: ContextMenuEntry[];
  /** "contextmenu" (right-click) or "click". Default "contextmenu". */
  triggerOn?: "contextmenu" | "click";
  "aria-label"?: string;
};

type ControlledProps = {
  open: boolean;
  position: ContextMenuPosition;
  items: ContextMenuEntry[];
  onClose: () => void;
  "aria-label"?: string;
};

export type ContextMenuProps = TriggerProps | ControlledProps;

function isControlled(props: ContextMenuProps): props is ControlledProps {
  return "open" in props && "position" in props;
}

/* --- Controlled surface — the actual menu panel, portaled to body. --- */

interface MenuPanelProps {
  position: ContextMenuPosition;
  items: ContextMenuEntry[];
  onClose: () => void;
  "aria-label"?: string;
}

function MenuPanel({
  position,
  items,
  onClose,
  "aria-label": ariaLabel,
}: MenuPanelProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const uid = useId();

  // Indices of selectable (non-separator, non-disabled) items.
  const selectable = useMemo(
    () =>
      items
        .map((it, i) => ({ it, i }))
        .filter(
          ({ it }) => !isSeparator(it) && !(it as ContextMenuItem).disabled,
        )
        .map(({ i }) => i),
    [items],
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(
    selectable[0] ?? null,
  );

  // Reset active item whenever items change.
  useEffect(() => {
    setActiveIndex(selectable[0] ?? null);
  }, [selectable]);

  // Clamp panel so it stays on-screen.
  const [coords, setCoords] = useState<ContextMenuPosition>(position);
  useLayoutEffect(() => {
    setCoords(position);
  }, [position.x, position.y]);
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    const nextX = Math.max(4, Math.min(position.x, maxX));
    const nextY = Math.max(4, Math.min(position.y, maxY));
    if (nextX !== coords.x || nextY !== coords.y) {
      setCoords({ x: nextX, y: nextY });
    }
  }, [position.x, position.y, items.length]);

  // Focus the menu on mount (enables keyboard nav without tabbing).
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Close on outside click.
  useEffect(() => {
    function handle(ev: globalThis.MouseEvent) {
      const node = menuRef.current;
      if (!node) return;
      if (ev.target instanceof Node && node.contains(ev.target)) return;
      onClose();
    }
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, [onClose]);

  // Close on scroll / resize — positions would be stale.
  useEffect(() => {
    function handle() {
      onClose();
    }
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [onClose]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      if (selectable.length === 0) return;
      setActiveIndex((curr) => {
        const currPos = curr == null ? -1 : selectable.indexOf(curr);
        const nextPos =
          currPos < 0
            ? dir === 1
              ? 0
              : selectable.length - 1
            : (currPos + dir + selectable.length) % selectable.length;
        return selectable[nextPos];
      });
    },
    [selectable],
  );

  const selectIndex = useCallback(
    (idx: number) => {
      const it = items[idx];
      if (!it || isSeparator(it)) return;
      if (it.disabled) return;
      it.onSelect();
      onClose();
    },
    [items, onClose],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      if (selectable.length) setActiveIndex(selectable[0]);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      if (selectable.length) setActiveIndex(selectable[selectable.length - 1]!);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (activeIndex == null) return;
      e.preventDefault();
      selectIndex(activeIndex);
      return;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel ?? "Context menu"}
      tabIndex={-1}
      className="context-menu"
      style={{ left: coords.x, top: coords.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, idx) => {
        if (isSeparator(entry)) {
          return (
            <div
              key={`sep-${uid}-${idx}`}
              className="context-menu-sep"
              role="separator"
            />
          );
        }
        const item = entry;
        const active = activeIndex === idx;
        const classes = ["context-menu-item"];
        if (item.variant === "destructive") classes.push("danger");
        return (
          <button
            key={item.id ?? `${uid}-${idx}`}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled ? true : undefined}
            disabled={item.disabled}
            data-active={active ? "true" : undefined}
            data-variant={item.variant ?? "default"}
            className={classes.join(" ")}
            onMouseEnter={() => {
              if (!item.disabled) setActiveIndex(idx);
            }}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.preventDefault();
              selectIndex(idx);
            }}
          >
            {item.icon ? (
              <span className="context-menu-item-icon" aria-hidden>
                {item.icon}
              </span>
            ) : null}
            <span className="context-menu-item-label">{item.label}</span>
            {item.shortcut ? (
              <span className="context-menu-item-shortcut">
                <Kbd>{item.shortcut}</Kbd>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/* --- Public component — handles both trigger and controlled forms. --- */

export function ContextMenu(props: ContextMenuProps) {
  // Controlled form: consumer owns open/position.
  if (isControlled(props)) {
    if (!props.open) return null;
    return (
      <MenuPanel
        position={props.position}
        items={props.items}
        onClose={props.onClose}
        aria-label={props["aria-label"]}
      />
    );
  }

  // Trigger form: wrap trigger element, manage state internally.
  const { trigger, items, triggerOn = "contextmenu" } = props;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 });

  const handleTrigger = (ev: MouseEvent<HTMLElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setPosition({ x: ev.clientX, y: ev.clientY });
    setOpen(true);
  };

  const close = useCallback(() => setOpen(false), []);

  const injected: Record<string, unknown> = {};
  if (triggerOn === "contextmenu") {
    injected.onContextMenu = handleTrigger;
  } else {
    injected.onClick = handleTrigger;
  }

  const cloned = isValidElement(trigger)
    ? cloneElement(trigger, injected)
    : trigger;

  return (
    <>
      {cloned}
      {open ? (
        <MenuPanel
          position={position}
          items={items}
          onClose={close}
          aria-label={props["aria-label"]}
        />
      ) : null}
    </>
  );
}
