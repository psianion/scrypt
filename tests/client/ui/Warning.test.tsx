import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { Warning } from "@/client/ui/Warning";

afterEach(cleanup);

describe("Warning", () => {
  test("renders children with .warning-block class", () => {
    const { getByText } = render(<Warning>Local embeddings are rebuilding.</Warning>);
    const body = getByText("Local embeddings are rebuilding.");
    expect(body.closest(".warning-block")).not.toBeNull();
  });

  test("default icon is a lucide SVG inside an aria-hidden slot", () => {
    const { container } = render(<Warning>msg</Warning>);
    const iconSlot = container.querySelector(".warning-block-icon");
    expect(iconSlot).not.toBeNull();
    expect(iconSlot?.getAttribute("aria-hidden")).toBe("true");
    const svg = iconSlot?.querySelector("svg");
    expect(svg).not.toBeNull();
    // lucide strokes inherit currentColor so theme switching works
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
  });

  test("accepts a custom icon override", () => {
    const { container } = render(<Warning icon={<span data-testid="custom-icon">x</span>}>msg</Warning>);
    expect(container.querySelector("[data-testid='custom-icon']")).not.toBeNull();
    // when overridden, default lucide svg should NOT render
    expect(container.querySelector(".warning-block-icon svg")).toBeNull();
  });
});
