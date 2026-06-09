// src/client/components/JournalCalendar.tsx
import { useEffect, useRef } from "react";
import { todayKey } from "../../shared/date";
import "./JournalCalendar.css";

interface Props {
  counts: { date: string; count: number }[];
  selected: string;
  onSelect: (date: string) => void;
}

function intensity(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function JournalCalendar({ counts, selected, onSelect }: Props) {
  const byDate = new Map(counts.map((c) => [c.date, c.count]));
  // Anchor on the UTC day key (matches `selected`) so the last cell is always
  // "today" with no local/UTC off-by-one.
  const today = new Date(`${todayKey()}T00:00:00Z`);
  const cells: { date: string; count: number }[] = [];
  for (let i = 371; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    cells.push({ date, count: byDate.get(date) ?? 0 });
  }
  const total = cells.reduce((n, c) => n + c.count, 0);

  // The grid scrolls horizontally; start it pinned to the right (today).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  return (
    <div className="journal-activity" data-testid="journal-activity">
      <div className="journal-activity-head">
        <span>
          {total} {total === 1 ? "entry" : "entries"} in the last year
        </span>
        <span className="journal-activity-legend">
          Less
          <i className="swatch intensity-0" />
          <i className="swatch intensity-1" />
          <i className="swatch intensity-2" />
          <i className="swatch intensity-3" />
          <i className="swatch intensity-4" />
          More
        </span>
      </div>
      <div className="journal-calendar" data-testid="journal-calendar" ref={scrollRef}>
        {cells.map((c) => (
          <button
            key={c.date}
            data-testid={`cal-${c.date}`}
            title={`${c.date}: ${c.count}`}
            className={`cal-cell intensity-${intensity(c.count)}${
              c.date === selected ? " selected" : ""
            }`}
            onClick={() => onSelect(c.date)}
          />
        ))}
      </div>
    </div>
  );
}
