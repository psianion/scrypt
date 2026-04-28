import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Button } from "@/client/ui/Button";

afterEach(cleanup);

describe("Button", () => {
  test("renders children and applies variant class", () => {
    const { getByRole } = render(<Button variant="primary">Save</Button>);
    const btn = getByRole("button", { name: "Save" });
    expect(btn.classList.contains("btn")).toBe(true);
    expect(btn.classList.contains("btn-primary")).toBe(true);
  });

  test("onClick fires when enabled", () => {
    let clicked = 0;
    const { getByRole } = render(<Button onClick={() => { clicked++; }}>Go</Button>);
    fireEvent.click(getByRole("button"));
    expect(clicked).toBe(1);
  });

  test("disabled blocks click", () => {
    let clicked = 0;
    const { getByRole } = render(
      <Button disabled onClick={() => { clicked++; }}>Go</Button>,
    );
    fireEvent.click(getByRole("button"));
    expect(clicked).toBe(0);
  });

  test("loading adds .loading class and blocks click", () => {
    let clicked = 0;
    const { getByRole } = render(
      <Button loading onClick={() => { clicked++; }}>Go</Button>,
    );
    const btn = getByRole("button");
    expect(btn.classList.contains("loading")).toBe(true);
    fireEvent.click(btn);
    expect(clicked).toBe(0);
  });

  test("defaults to variant=primary when omitted", () => {
    const { getByRole } = render(<Button>Go</Button>);
    expect(getByRole("button").classList.contains("btn-primary")).toBe(true);
  });
});
