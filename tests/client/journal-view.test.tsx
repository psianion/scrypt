// tests/client/journal-view.test.tsx
import { test, expect, mock, afterEach } from "bun:test";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { JournalView } from "../../src/client/views/JournalView";
import { api } from "../../src/client/api";

afterEach(cleanup);

test("composer posts an entry and tasks render", async () => {
  const day = {
    date: "2026-06-09",
    entries: [{ id: "2026-06-09T15:00:00.000Z", displayTime: "3:00 PM", body: "hi" }],
    tasks_due: [{ id: 1, title: "do laundry", status: "open" }],
    related: [{ path: "notes/poke.md", title: "poke", score: 0.5 }],
  };
  api.journal.today = mock(async () => day) as any;
  api.journal.day = mock(async () => day) as any;
  api.journal.calendar = mock(async () => [{ date: "2026-06-09", count: 1 }]) as any;
  api.journal.addEntry = mock(async () => day) as any;

  const { getByTestId, getByText } = render(<JournalView />);
  await waitFor(() => getByText("hi"));
  expect(getByText("3:00 PM")).toBeTruthy();
  expect(getByText("do laundry")).toBeTruthy();

  fireEvent.change(getByTestId("journal-composer"), { target: { value: "new thought" } });
  fireEvent.click(getByTestId("journal-composer-save"));
  await waitFor(() => expect(api.journal.addEntry).toHaveBeenCalled());
});
