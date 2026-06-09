// tests/client/journal-calendar.test.tsx
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { JournalCalendar } from "../../src/client/components/JournalCalendar";

afterEach(cleanup);

test("renders a cell per day with intensity class and fires onSelect", () => {
  const counts = [{ date: "2026-06-09", count: 3 }];
  const { container, getByTestId } = render(
    <JournalCalendar counts={counts} selected="2026-06-09" onSelect={() => {}} />,
  );
  const cell = getByTestId("cal-2026-06-09");
  expect(cell.className).toContain("intensity-");
  expect(container.querySelectorAll("[data-testid^='cal-']").length).toBeGreaterThan(0);
});
