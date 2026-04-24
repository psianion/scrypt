import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Segment } from "@/client/ui/Segment";

afterEach(cleanup);

describe("Segment", () => {
  test("marks active item with data-active", () => {
    const items = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const { getByText } = render(<Segment items={items} value="a" onChange={() => {}} />);
    expect(getByText("A").getAttribute("data-active")).toBe("true");
    expect(getByText("B").getAttribute("data-active")).toBeNull();
  });

  test("click fires onChange with value", () => {
    let next: string | null = null;
    const items = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const { getByText } = render(
      <Segment items={items} value="a" onChange={(v) => { next = v; }} />,
    );
    fireEvent.click(getByText("B"));
    expect(next).toBe("b");
  });
});
