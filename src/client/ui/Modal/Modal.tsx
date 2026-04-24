import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./Modal.css";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: ModalSize;
  /** If false, clicking the backdrop does not close the modal. Default true. */
  dismissOnBackdrop?: boolean;
  /** If false, pressing Escape does not close the modal. Default true. */
  dismissOnEscape?: boolean;
  className?: string;
  /** Accessible label used when no `title` is provided. */
  ariaLabel?: string;
  /** Hide the close (X) button in the top-right corner. */
  hideCloseButton?: boolean;
  /** Footer action row rendered at the bottom of the modal body. */
  footer?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("data-modal-inert"));
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  className,
  ariaLabel,
  hideCloseButton = false,
  footer,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Escape key handler + focus trap via keydown.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const card = cardRef.current;
        if (!card) return;
        const focusable = getFocusable(card);
        if (focusable.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !card.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, dismissOnEscape, onClose]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus management: capture previous focus, move focus into modal, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (card) {
      const focusable = getFocusable(card);
      const target = focusable[0] ?? card;
      target.focus();
    }
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [open]);

  const onBackdropMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dismissOnBackdrop) return;
      if (e.target === e.currentTarget) onClose();
    },
    [dismissOnBackdrop, onClose],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const classes = ["modal", `modal-${size}`];
  if (className) classes.push(className);

  return createPortal(
    <div
      className="modal-overlay"
      data-testid="modal-overlay"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={cardRef}
        className={classes.join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? "modal-title" : undefined}
        tabIndex={-1}
      >
        {(title || !hideCloseButton) && (
          <div className="modal-header">
            {title ? (
              <h2 id="modal-title" className="modal-title">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideCloseButton && (
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-actions">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
