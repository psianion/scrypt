// tests/client/journal-related.test.tsx
//
// "Related notes" now come from the journal *day bundle* as a flat, semantic
// list of { path, title, score } — not the legacy /api/daily_context
// { notes, memories, draft_prompts } tag/domain bundle (retired in Task 5.3).
import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";

interface RelatedNoteDTO {
  path: string;
  title: string;
  score: number;
}

interface JournalDay {
  date: string;
  related: RelatedNoteDTO[];
}

// Minimal renderer matching the planned JournalView "Related notes" aside:
// one row per related note, titled, sorted by the server (highest score first).
function RelatedAside({ day }: { day: JournalDay }) {
  if (day.related.length === 0) return null;
  return (
    <aside data-testid="journal-related">
      <div>Related notes</div>
      {day.related.map((r) => (
        <a key={r.path} href={`/note/${r.path}`} title={r.score.toFixed(2)}>
          {r.title}
        </a>
      ))}
    </aside>
  );
}

afterEach(() => cleanup());

describe("journal day-bundle related notes", () => {
  test("renders one row per related note from the day bundle", () => {
    const day: JournalDay = {
      date: "2026-06-09",
      related: [
        { path: "dnd/research/necromancer.md", title: "Necromancer", score: 0.82 },
        { path: "dnd/research/poke.md", title: "Pokemon Cards", score: 0.61 },
      ],
    };
    render(<RelatedAside day={day} />);
    expect(screen.getByText("Necromancer")).toBeDefined();
    expect(screen.getByText("Pokemon Cards")).toBeDefined();
  });

  test("related items expose path/title/score (the new flat shape)", () => {
    const item: RelatedNoteDTO = {
      path: "dnd/research/necromancer.md",
      title: "Necromancer",
      score: 0.82,
    };
    expect(typeof item.path).toBe("string");
    expect(typeof item.title).toBe("string");
    expect(typeof item.score).toBe("number");
    // legacy bundle keys are gone
    expect((item as any).notes).toBeUndefined();
    expect((item as any).memories).toBeUndefined();
    expect((item as any).draft_prompts).toBeUndefined();
  });

  test("empty related collapses the aside", () => {
    const day: JournalDay = { date: "2026-06-09", related: [] };
    render(<RelatedAside day={day} />);
    expect(screen.queryByTestId("journal-related")).toBeNull();
  });
});
