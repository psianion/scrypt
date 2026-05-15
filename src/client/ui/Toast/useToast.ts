// src/client/ui/Toast/useToast.ts
//
// Imperative toast API. Stable reference so callers can destructure safely:
//   const toast = useToast();
//   toast.success("Saved");
//   toast.error("Failed", { action: { label: "Retry", onClick: retry } });
import { useMemo } from "react";
import {
  useToastStore,
  type ToastAction,
  type ToastVariant,
} from "@/client/stores/toast";

interface ToastOptions {
  message?: string;
  action?: ToastAction;
  /** ms before auto-dismiss. 0 = sticky. */
  durationMs?: number;
}

export interface ToastApi {
  info: (title: string, opts?: ToastOptions) => string;
  success: (title: string, opts?: ToastOptions) => string;
  warn: (title: string, opts?: ToastOptions) => string;
  error: (title: string, opts?: ToastOptions) => string;
  show: (variant: ToastVariant, title: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export function useToast(): ToastApi {
  const enqueue = useToastStore((s) => s.enqueue);
  const dismiss = useToastStore((s) => s.dismiss);
  const clear = useToastStore((s) => s.clear);

  return useMemo<ToastApi>(() => {
    const show = (variant: ToastVariant, title: string, opts?: ToastOptions) =>
      enqueue({
        variant,
        title,
        message: opts?.message,
        action: opts?.action,
        durationMs: opts?.durationMs,
      });
    return {
      info: (title, opts) => show("info", title, opts),
      success: (title, opts) => show("success", title, opts),
      warn: (title, opts) => show("warn", title, opts),
      error: (title, opts) => show("error", title, opts),
      show,
      dismiss,
      clear,
    };
  }, [enqueue, dismiss, clear]);
}
