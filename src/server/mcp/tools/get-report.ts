// src/server/mcp/tools/get-report.ts
//
// ingest-v3: extended to surface project + thread rollups alongside the
// markdown summary. Projects are grouped by doc_type, threads by project.
import { generateReport } from "../../indexer/report";
import type { ToolDef } from "../types";

type Input = Record<string, never>;

interface ProjectRollup {
  name: string;
  doc_type_counts: Record<string, number>;
  total: number;
}

interface ThreadRollup {
  thread: string;
  project: string | null;
  count: number;
  doc_types: string[];
}

interface Output {
  markdown: string;
  projects: ProjectRollup[];
  threads: ThreadRollup[];
}

export const getReportTool: ToolDef<Input, Output> = {
  name: "get_report",
  description:
    "Returns a markdown summary of the vault graph plus per-project and per-thread rollups (ingest-v3).",
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(ctx) {
    const projectRows = ctx.db
      .query<
        { project: string; doc_type: string | null; n: number },
        []
      >(
        `SELECT project, doc_type, COUNT(*) AS n
         FROM notes
         WHERE project IS NOT NULL
         GROUP BY project, doc_type`,
      )
      .all();

    const projectMap = new Map<string, Record<string, number>>();
    for (const row of projectRows) {
      if (!projectMap.has(row.project)) projectMap.set(row.project, {});
      const key = row.doc_type ?? "unknown";
      projectMap.get(row.project)![key] = row.n;
    }
    const projects: ProjectRollup[] = Array.from(projectMap.entries())
      .map(([name, counts]) => ({
        name,
        doc_type_counts: counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const threadRows = ctx.db
      .query<
        {
          thread: string;
          project: string | null;
          n: number;
          doc_types: string | null;
        },
        []
      >(
        `SELECT thread, project, COUNT(*) AS n,
                GROUP_CONCAT(DISTINCT doc_type) AS doc_types
         FROM notes
         WHERE thread IS NOT NULL
         GROUP BY project, thread`,
      )
      .all();

    const threads: ThreadRollup[] = threadRows
      .map((r) => ({
        thread: r.thread,
        project: r.project,
        count: r.n,
        doc_types: (r.doc_types ?? "")
          .split(",")
          .filter((s) => s.length > 0)
          .sort(),
      }))
      .sort(
        (a, b) =>
          (a.project ?? "").localeCompare(b.project ?? "") ||
          a.thread.localeCompare(b.thread),
      );

    const baseMarkdown = generateReport(ctx.db);
    const markdown = renderExtendedMarkdown(baseMarkdown, projects, threads);

    return { markdown, projects, threads };
  },
};

function renderExtendedMarkdown(
  base: string,
  projects: ProjectRollup[],
  threads: ThreadRollup[],
): string {
  const lines: string[] = [base.trimEnd()];
  if (projects.length > 0) {
    lines.push("", "## Projects", "");
    for (const p of projects) {
      const parts = Object.entries(p.doc_type_counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`- **${p.name}** (${p.total} notes): ${parts}`);
    }
  }
  if (threads.length > 0) {
    lines.push("", "## Threads", "");
    for (const t of threads) {
      const docs = t.doc_types.length > 0 ? t.doc_types.join(",") : "—";
      lines.push(
        `- **${t.thread}** [${t.project ?? "—"}]: ${t.count} notes (${docs})`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
