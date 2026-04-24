import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Checkbox } from "@/client/ui/Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  test("data-checked applied when checked=true", () => {
    const { getByRole } = render(<Checkbox checked onChange={() => {}} aria-label="c" />);
    expect(getByRole("checkbox").getAttribute("data-checked")).toBe("true");
  });

  test("click inverts", () => {
    let v: boolean | null = null;
    const { getByRole } = render(
      <Checkbox checked={false} onChange={(n) => { v = n; }} aria-label="c" />,
    );
    fireEvent.click(getByRole("checkbox"));
    expect(v).toBe(true);
  });

  test("disabled blocks onChange", () => {
    let called = 0;
    const { getByRole } = render(
      <Checkbox checked={false} disabled onChange={() => { called++; }} aria-label="c" />,
    );
    fireEvent.click(getByRole("checkbox"));
    expect(called).toBe(0);
  });
});
