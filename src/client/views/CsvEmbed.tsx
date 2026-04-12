import { useEffect, useState } from "react";
import { api } from "../api";

export function CsvEmbed({ file }: { file: string }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    api.data.get(file).then((r) => setRows(r as Record<string, string>[])).catch(() => setRows([]));
  }, [file]);

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const cmp = String(a[sortCol] || "").localeCompare(String(b[sortCol] || ""));
        return sortAsc ? cmp : -cmp;
      })
    : rows;

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  return (
    <div className="border border-[var(--border)] rounded overflow-hidden my-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-secondary)]">
            {headers.map((h) => (
              <th
                key={h}
                onClick={() => toggleSort(h)}
                className="px-2 py-1 text-left text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]"
              >
                {h} {sortCol === h ? (sortAsc ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              {headers.map((h) => (
                <td key={h} className="px-2 py-1 text-[var(--text-primary)]">
                  {row[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)]">
        {rows.length} rows
      </div>
    </div>
  );
}
