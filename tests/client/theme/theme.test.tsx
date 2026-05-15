import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";
import { useStore } from "@/client/store";
import { useApplyTheme } from "@/client/theme/theme";

afterEach(() => {
  cleanup();
  useStore.setState({ theme: "dark" });
  document.documentElement.removeAttribute("data-theme");
});

function Harness() {
  useApplyTheme();
  return null;
}

describe("useApplyTheme", () => {
  test("sets data-theme=dark on mount when store theme is dark", () => {
    render(<Harness />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("updates data-theme when store.theme changes", () => {
    render(<Harness />);
    act(() => {
      useStore.getState().setTheme("light");
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
