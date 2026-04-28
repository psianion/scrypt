// src/client/stores/toast.ts
//
// Toast queue — Zustand slice powering <ToastRegion/> and the useToast hook.
// Consumers call the imperative API (useToast().success(...), etc.) which
// enqueues here; the region subscribes and renders the active stack.
import { create } from "zustand";

export type ToastVariant = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  action?: ToastAction;
  /** ms before auto-dismiss. 0 = sticky. Defaults to 4000, errors default to sticky. */
  durationMs: number;
  createdAt: number;
}

interface ToastEnqueueInput {
  variant: ToastVariant;
  title: string;
  message?: string;
  action?: ToastAction;
  durationMs?: number;
}

interface ToastStore {
  toasts: ToastRecord[];
  enqueue: (input: ToastEnqueueInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 4000;
let seq = 0;

function nextId(): string {
  seq += 1;
  return `toast-${Date.now().toString(36)}-${seq}`;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  enqueue: (input) => {
    const id = nextId();
    const durationMs =
      input.durationMs !== undefined
        ? input.durationMs
        : input.variant === "error"
          ? 0
          : DEFAULT_DURATION_MS;
    const record: ToastRecord = {
      id,
      variant: input.variant,
      title: input.title,
      message: input.message,
      action: input.action,
      durationMs,
      createdAt: Date.now(),
    };
    set((state) => ({ toasts: [...state.toasts, record] }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
