import { useEffect } from "react";
import { useStore } from "../store";

/**
 * Mount once in the app shell. Resolves the store's `theme` preference
 * (`dark` | `light` | `auto`) to a concrete `data-theme` on `<html>`.
 * In `auto`, follows `prefers-color-scheme` and updates live on system change.
 */
export function useApplyTheme(): void {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      let effective: "dark" | "light";
      if (theme === "auto") {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        effective = mq.matches ? "dark" : "light";
      } else {
        effective = theme;
      }
      document.documentElement.setAttribute("data-theme", effective);
    };
    apply();
    if (theme === "auto" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
}
