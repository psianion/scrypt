import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  CircleX,
  Info,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useToastStore,
  type ToastAction,
  type ToastRecord,
  type ToastVariant,
} from "@/client/stores/toast";
import "./Toast.css";

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warn: TriangleAlert,
  error: CircleX,
};

const VARIANT_CLASS: Record<ToastVariant, string> = {
  info: "toast-info",
  success: "toast-success",
  warn: "toast-warning",
  error: "toast-error",
};

export interface ToastProps {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  action?: ToastAction;
  onDismiss: (id: string) => void;
  /** Icon override for tests / custom variants. */
  icon?: ReactNode;
}

export function Toast({
  id,
  variant,
  title,
  message,
  action,
  onDismiss,
  icon,
}: ToastProps) {
  const Icon = VARIANT_ICON[variant];
  return (
    <div
      className={`toast ${VARIANT_CLASS[variant]}`}
      role={variant === "error" ? "alert" : "status"}
      data-variant={variant}
      data-testid={`toast-${id}`}
    >
      <span className="toast-icon" aria-hidden="true">
        {icon ?? <Icon size={16} />}
      </span>
      <div className="toast-content">
        <div className="toast-title">{title}</div>
        {message ? <div className="toast-body">{message}</div> : null}
      </div>
      {action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastItemProps {
  record: ToastRecord;
  onDismiss: (id: string) => void;
}

function ToastItem({ record, onDismiss }: ToastItemProps) {
  useEffect(() => {
    if (!record.durationMs || record.durationMs <= 0) return;
    const timer = setTimeout(() => onDismiss(record.id), record.durationMs);
    return () => clearTimeout(timer);
  }, [record.id, record.durationMs, onDismiss]);

  return (
    <Toast
      id={record.id}
      variant={record.variant}
      title={record.title}
      message={record.message}
      action={record.action}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Mount this once near the root of the app (App.tsx). Subscribes to the
 * toast store and renders the active stack bottom-right via portal.
 */
export function ToastRegion() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="toast-container"
      role="region"
      aria-label="Notifications"
      data-testid="toast-region"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} record={t} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
