// tests/client/split-panes.test.tsx
import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { SplitPane } from "../../src/client/components/SplitPane";

afterEach(cleanup);

describe("SplitPane", () => {
  test("renders children in split layout", () => {
    render(
      <SplitPane>
        <div data-testid="left">Left</div>
        <div data-testid="right">Right</div>
      </SplitPane>
    );
    expect(screen.getByTestId("left")).toBeDefined();
    expect(screen.getByTestId("right")).toBeDefined();
  });

  test("has draggable divider", () => {
    render(
      <SplitPane>
        <div>Left</div>
        <div>Right</div>
      </SplitPane>
    );
    expect(screen.getByTestId("split-divider")).toBeDefined();
  });
});
