import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Toggle } from "@/client/ui/Toggle";

afterEach(cleanup);

describe("Toggle", () => {
  test("renders with data-checked attr when checked=true", () => {
    const { getByRole } = render(<Toggle checked onChange={() => {}} aria-label="t" />);
    expect(getByRole("switch").getAttribute("data-checked")).toBe("true");
  });

  test("no data-checked attr when checked=false", () => {
    const { getByRole } = render(<Toggle checked={false} onChange={() => {}} aria-label="t" />);
    expect(getByRole("switch").getAttribute("data-checked")).toBeNull();
  });

  test("click fires onChange with inverted value", () => {
    let next: boolean | null = null;
    const { getByRole } = render(
      <Toggle checked={false} onChange={(v) => { next = v; }} aria-label="t" />,
    );
    fireEvent.click(getByRole("switch"));
    expect(next).toBe(true);
  });

  test("disabled blocks onChange", () => {
    let called = 0;
    const { getByRole } = render(
      <Toggle checked={false} disabled onChange={() => { called++; }} aria-label="t" />,
    );
    fireEvent.click(getByRole("switch"));
    expect(called).toBe(0);
  });
});
