import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Input } from "@/client/ui/Input";

afterEach(cleanup);

describe("Input", () => {
  test("renders with .input class", () => {
    const { getByRole } = render(<Input aria-label="name" />);
    expect(getByRole("textbox").classList.contains("input")).toBe(true);
  });

  test("value + onChange wiring", () => {
    let v = "";
    const { getByRole, rerender } = render(
      <Input aria-label="name" value={v} onChange={(e) => { v = e.target.value; }} />,
    );
    fireEvent.change(getByRole("textbox"), { target: { value: "hi" } });
    expect(v).toBe("hi");
    rerender(<Input aria-label="name" value={v} onChange={() => {}} />);
    expect((getByRole("textbox") as HTMLInputElement).value).toBe("hi");
  });

  test("error prop applies .error class + renders message", () => {
    const { getByRole, getByText } = render(
      <Input aria-label="email" error="bad format" />,
    );
    expect(getByRole("textbox").classList.contains("error")).toBe(true);
    expect(getByText("bad format").classList.contains("input-error-msg")).toBe(true);
  });

  test("disabled prop passes through", () => {
    const { getByRole } = render(<Input aria-label="x" disabled />);
    expect((getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });
});
