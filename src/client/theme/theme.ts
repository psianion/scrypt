import { useEffect } from "react";
import { useStore } from "../store";

/**
 * Mount once in the app shell. Mirrors the store's `theme` onto
 * `<html data-theme>` so tokens.css's [data-theme="light"] override applies.
 */
export function useApplyTheme(): void {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
}
