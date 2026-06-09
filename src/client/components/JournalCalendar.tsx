// src/client/components/JournalCalendar.tsx
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
  // last 53 weeks ending today, GitHub-style columns
  const today = new Date();
  const cells: { date: string; count: number }[] = [];
  for (let i = 371; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    cells.push({ date, count: byDate.get(date) ?? 0 });
  }
  return (
    <div className="journal-calendar" data-testid="journal-calendar">
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
  );
}
