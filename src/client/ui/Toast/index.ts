// Public UI barrel — consumers import from `@/client/ui` (via the main barrel).
// The Zustand store (`useToastStore`) stays internal to this module — callers
// should use the `useToast()` hook and `<ToastRegion/>` component instead.
export { Toast, ToastRegion, type ToastProps } from "./Toast";
export { useToast, type ToastApi } from "./useToast";
export type {
  ToastRecord,
  ToastVariant,
  ToastAction,
} from "@/client/stores/toast";
