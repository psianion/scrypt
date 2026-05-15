import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../ContextMenu";
import "./Breadcrumb.css";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: ReactNode;
  /** Optional click handler. If provided and no href, item becomes a <button>. */
  onClick?: () => void;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Separator element rendered between items. Default: lucide ChevronRight @ 12px. */
  separator?: ReactNode;
  /**
   * When true and items.length > maxVisible, collapse the middle into
   * a `…` trigger that reveals hidden items in a ContextMenu.
   * Default true.
   */
  collapse?: boolean;
  /** Threshold for collapse. Default 5. */
  maxVisible?: number;
  className?: string;
  "aria-label"?: string;
}

type RenderedEntry =
  | { kind: "item"; index: number; item: BreadcrumbItem; isLast: boolean }
  | { kind: "ellipsis"; hidden: BreadcrumbItem[] };

function computeEntries(
  items: BreadcrumbItem[],
  collapse: boolean,
  maxVisible: number,
): RenderedEntry[] {
  if (!collapse || items.length <= maxVisible) {
    return items.map((item, i) => ({
      kind: "item",
      index: i,
      item,
      isLast: i === items.length - 1,
    }));
  }
  // Always keep the first item and the last two. Everything else collapses.
  const keepHead = 1;
  const keepTail = 2;
  const hidden = items.slice(keepHead, items.length - keepTail);
  const head = items.slice(0, keepHead).map<RenderedEntry>((item, i) => ({
    kind: "item",
    index: i,
    item,
    isLast: false,
  }));
  const tail = items
    .slice(items.length - keepTail)
    .map<RenderedEntry>((item, i) => ({
      kind: "item",
      index: items.length - keepTail + i,
      item,
      isLast: i === keepTail - 1,
    }));
  return [...head, { kind: "ellipsis", hidden }, ...tail];
}

export function Breadcrumb({
  items,
  separator,
  collapse = true,
  maxVisible = 5,
  className,
  "aria-label": ariaLabel = "Breadcrumb",
}: BreadcrumbProps) {
  const entries = useMemo(
    () => computeEntries(items, collapse, maxVisible),
    [items, collapse, maxVisible],
  );

  const sep = separator ?? (
    <ChevronRight size={12} aria-hidden="true" />
  );

  const classes = ["breadcrumb"];
  if (className) classes.push(className);

  return (
    <nav aria-label={ariaLabel} className={classes.join(" ")}>
      {entries.map((entry, i) => {
        const withSep = i < entries.length - 1;
        if (entry.kind === "ellipsis") {
          return (
            <BreadcrumbEllipsis
              key={`ellipsis-${i}`}
              hidden={entry.hidden}
              sep={withSep ? sep : null}
            />
          );
        }
        const { item, isLast, index } = entry;
        return (
          <BreadcrumbSlot
            key={`item-${index}`}
            item={item}
            isLast={isLast}
            sep={withSep ? sep : null}
          />
        );
      })}
    </nav>
  );
}

interface SlotProps {
  item: BreadcrumbItem;
  isLast: boolean;
  sep: ReactNode;
}

function BreadcrumbSlot({ item, isLast, sep }: SlotProps) {
  const content = (
    <>
      {item.icon ? (
        <span className="breadcrumb-item-icon" aria-hidden>
          {item.icon}
        </span>
      ) : null}
      <span>{item.label}</span>
    </>
  );

  let node: ReactNode;
  if (isLast) {
    node = (
      <span
        className="breadcrumb-item"
        aria-current="page"
        title={item.label}
      >
        {content}
      </span>
    );
  } else if (item.href) {
    node = (
      <a
        href={item.href}
        className="breadcrumb-item"
        data-interactive="true"
        title={item.label}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          if (item.onClick) {
            // Let caller own navigation (e.g. react-router) — block default nav.
            e.preventDefault();
            item.onClick();
          }
        }}
      >
        {content}
      </a>
    );
  } else if (item.onClick) {
    node = (
      <button
        type="button"
        className="breadcrumb-item"
        data-interactive="true"
        title={item.label}
        onClick={item.onClick}
      >
        {content}
      </button>
    );
  } else {
    node = (
      <span className="breadcrumb-item" title={item.label}>
        {content}
      </span>
    );
  }

  return (
    <>
      {node}
      {sep ? (
        <span className="breadcrumb-sep" aria-hidden>
          {sep}
        </span>
      ) : null}
    </>
  );
}

interface EllipsisProps {
  hidden: BreadcrumbItem[];
  sep: ReactNode;
}

function BreadcrumbEllipsis({ hidden, sep }: EllipsisProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const menuItems = useMemo<ContextMenuEntry[]>(
    () =>
      hidden.map((h, idx) => ({
        id: `bc-hidden-${idx}`,
        label: h.label,
        icon: h.icon,
        onSelect: () => {
          if (h.onClick) {
            h.onClick();
          } else if (h.href) {
            window.location.assign(h.href);
          }
        },
      })),
    [hidden],
  );

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({ x: rect.left, y: rect.bottom + 4 });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className="breadcrumb-item breadcrumb-ellipsis"
        data-interactive="true"
        aria-label={`Show ${hidden.length} hidden breadcrumb items`}
        aria-haspopup="menu"
        aria-expanded={open ? true : undefined}
        onClick={onClick}
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {sep ? (
        <span className="breadcrumb-sep" aria-hidden>
          {sep}
        </span>
      ) : null}
      <ContextMenu
        open={open}
        position={position}
        items={menuItems}
        onClose={() => setOpen(false)}
        aria-label="Hidden breadcrumb items"
      />
    </>
  );
}
