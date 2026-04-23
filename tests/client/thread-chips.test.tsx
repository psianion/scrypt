import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ThreadChips,
  deriveThreadsFromNotes,
  type ThreadSummary,
} from "../../src/client/components/ThreadChips";

afterEach(() => cleanup());

describe("deriveThreadsFromNotes", () => {
  test("groups by (project, thread), counts members, collects doc_types", () => {
    const notes = [
      { path: "p1", project: "dbtmg", doc_type: "plan", thread: "news-images" },
      { path: "p2", project: "dbtmg", doc_type: "spec", thread: "news-images" },
      { path: "p3", project: "dbtmg", doc_type: "plan", thread: "news-images" },
      { path: "p4", project: "goveva", doc_type: "research", thread: "auth" },
      { path: "p5", project: "dbtmg", doc_type: "plan", thread: null },
    ];
    const threads = deriveThreadsFromNotes(notes);
    const dbtmgNews = threads.find(
      (t) => t.project === "dbtmg" && t.thread === "news-images",
    )!;
    expect(dbtmgNews.count).toBe(3);
    expect(dbtmgNews.doc_types.sort()).toEqual(["plan", "spec"]);
    const auth = threads.find((t) => t.thread === "auth")!;
    expect(auth.project).toBe("goveva");
    expect(auth.count).toBe(1);
    // Untagged note not surfaced as a chip.
    expect(threads.length).toBe(2);
  });

  test("sorts by count desc then thread name asc", () => {
    const notes = [
      { path: "a", project: "p", doc_type: "plan", thread: "zeta" },
      { path: "b", project: "p", doc_type: "plan", thread: "alpha" },
      { path: "c", project: "p", doc_type: "plan", thread: "alpha" },
    ];
    const threads = deriveThreadsFromNotes(notes);
    expect(threads.map((t) => t.thread)).toEqual(["alpha", "zeta"]);
  });
});

describe("ThreadChips", () => {
  const SAMPLE: ThreadSummary[] = [
    { thread: "news-images", project: "dbtmg", count: 3, doc_types: ["plan", "spec"] },
    { thread: "auth-revamp", project: "goveva", count: 2, doc_types: ["plan"] },
  ];

  test("renders a chip per (project, thread) with count", () => {
    render(
      <ThreadChips threads={SAMPLE} selected={null} onSelect={() => {}} />,
    );
    expect(screen.getByText("news-images")).toBeDefined();
    expect(screen.getByText("auth-revamp")).toBeDefined();
    expect(screen.getByText(/\(3\)/)).toBeDefined();
    expect(screen.getByText(/\(2\)/)).toBeDefined();
  });

  test("clicking a chip calls onSelect with (project, thread)", () => {
    const calls: Array<{ project: string; thread: string } | null> = [];
    render(
      <ThreadChips
        threads={SAMPLE}
        selected={null}
        onSelect={(t) => calls.push(t)}
      />,
    );
    fireEvent.click(screen.getByText("news-images"));
    expect(calls).toEqual([{ project: "dbtmg", thread: "news-images" }]);
  });

  test("clicking the selected chip deselects (calls onSelect(null))", () => {
    const calls: Array<{ project: string; thread: string } | null> = [];
    render(
      <ThreadChips
        threads={SAMPLE}
        selected={{ project: "dbtmg", thread: "news-images" }}
        onSelect={(t) => calls.push(t)}
      />,
    );
    fireEvent.click(screen.getByText("news-images"));
    expect(calls).toEqual([null]);
  });

  test("selected chip gets aria-pressed=true", () => {
    const { container } = render(
      <ThreadChips
        threads={SAMPLE}
        selected={{ project: "dbtmg", thread: "news-images" }}
        onSelect={() => {}}
      />,
    );
    const pressed = container.querySelectorAll('[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect(pressed[0]?.textContent).toContain("news-images");
  });

  test("renders nothing when no threads (collapses cleanly)", () => {
    const { container } = render(
      <ThreadChips threads={[]} selected={null} onSelect={() => {}} />,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});
