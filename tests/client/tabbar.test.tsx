// tests/client/tabbar.test.tsx
//
// Wave 1 smoke test for the rewritten TabBar.
// Asserts the active-tab visual contract (data-active + .tab/.tab-bar token
// classes), close-button wiring, and the empty-state path. Visual fidelity
// against the pencil is verified by Playwright; this test pins the JSX
// contract so future refactors don't quietly drop the data-attrs CSS depends
// on.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { TabBar } from "../../src/client/components/TabBar";
import { useStore } from "../../src/client/store";

beforeEach(() => {
  useStore.setState({
    tabs: [
      { path: "alpha", title: "Alpha note" },
      { path: "beta", title: "Beta note" },
    ],
    activeTab: "alpha",
  });
});

afterEach(() => {
  cleanup();
  useStore.setState({ tabs: [], activeTab: null });
});

function renderTabBar() {
  return render(
    <MemoryRouter initialEntries={["/note/alpha"]}>
      <TabBar />
    </MemoryRouter>,
  );
}

describe("TabBar (Wave 1 rewrite)", () => {
  test("renders under the .tab-bar token class with role=tablist", () => {
    renderTabBar();
    const bar = screen.getByTestId("tab-bar");
    expect(bar.classList.contains("tab-bar")).toBe(true);
    expect(bar.getAttribute("role")).toBe("tablist");
  });

  test("active tab carries data-active and aria-selected, inactive tab does not", () => {
    renderTabBar();
    const active = screen.getByTestId("tab-alpha");
    const inactive = screen.getByTestId("tab-beta");
    expect(active.hasAttribute("data-active")).toBe(true);
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(inactive.hasAttribute("data-active")).toBe(false);
    expect(inactive.getAttribute("aria-selected")).toBe("false");
    // Both tabs share the .tab class so token styling applies uniformly.
    expect(active.classList.contains("tab")).toBe(true);
    expect(inactive.classList.contains("tab")).toBe(true);
  });

  test("clicking a tab updates activeTab in the store", () => {
    renderTabBar();
    fireEvent.click(screen.getByTestId("tab-beta"));
    expect(useStore.getState().activeTab).toBe("beta");
  });

  test("close button removes the tab without activating it", () => {
    renderTabBar();
    const closeBtn = screen.getByLabelText("Close Beta note");
    fireEvent.click(closeBtn);
    const tabs = useStore.getState().tabs;
    expect(tabs.find((t) => t.path === "beta")).toBeUndefined();
    // Active tab unchanged because we closed the inactive one.
    expect(useStore.getState().activeTab).toBe("alpha");
  });

  test("renders an empty .tab-bar when no tabs are open", () => {
    useStore.setState({ tabs: [], activeTab: null });
    renderTabBar();
    const bar = screen.getByTestId("tab-bar");
    expect(bar.classList.contains("tab-bar")).toBe(true);
    expect(bar.querySelectorAll(".tab").length).toBe(0);
  });
});
