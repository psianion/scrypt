import { describe, test, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Chip, Pill, Kbd, TierChip } from "@/client/ui/Chip";

afterEach(cleanup);

describe("Chip family", () => {
  test("Chip renders with .chip + variant class", () => {
    const { getByText } = render(<Chip variant="tag">#area/ops</Chip>);
    const el = getByText("#area/ops");
    expect(el.classList.contains("chip")).toBe(true);
    expect(el.classList.contains("chip-tag")).toBe(true);
  });

  test("Chip removable fires onRemove and not outer onClick", () => {
    let removed = 0;
    let outer = 0;
    const { getByLabelText } = render(
      <Chip onClick={() => { outer++; }} onRemove={() => { removed++; }} removeLabel="remove">
        foo
      </Chip>,
    );
    fireEvent.click(getByLabelText("remove"));
    expect(removed).toBe(1);
    expect(outer).toBe(0);
  });

  test("Pill renders with .pill class", () => {
    const { getByText } = render(<Pill>5</Pill>);
    expect(getByText("5").classList.contains("pill")).toBe(true);
  });

  test("Kbd renders with .kbd class", () => {
    const { getByText } = render(<Kbd>⌘K</Kbd>);
    expect(getByText("⌘K").classList.contains("kbd")).toBe(true);
  });

  test("TierChip renders tier variant class", () => {
    const { getByText } = render(<TierChip tier="semantic">SEMANTIC</TierChip>);
    const el = getByText("SEMANTIC");
    expect(el.classList.contains("tier-chip")).toBe(true);
    expect(el.classList.contains("tier-semantic")).toBe(true);
  });
});
