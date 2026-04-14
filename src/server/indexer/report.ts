// src/server/indexer/report.ts
//
// Pure function: current graph state → markdown summary. Mirrors the
// shape of graphify's GRAPH_REPORT.md.
import type { Database } from "bun:sqlite";

export function generateReport(db: Database): string {
  const totalNodes =
    db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_nodes`).get()
      ?.n ?? 0;
  const totalEdges =
    db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_edges`).get()
      ?.n ?? 0;

  const hubs = db
    .query<{ id: string; label: string; degree: number }, []>(
      `SELECT n.id, n.label,
              (SELECT COUNT(*) FROM graph_edges
               WHERE source = n.id OR target = n.id) AS degree
       FROM graph_nodes n
       ORDER BY degree DESC
       LIMIT 10`,
    )
    .all();

  const orphans = db
    .query<{ id: string; label: string }, []>(
      `SELECT id, label FROM graph_nodes n
       WHERE NOT EXISTS (
         SELECT 1 FROM graph_edges WHERE source = n.id OR target = n.id
       )
       LIMIT 20`,
    )
    .all();

  const communities = db
    .query<{ community_id: number; n: number }, []>(
      `SELECT community_id, COUNT(*) AS n FROM graph_nodes
       WHERE community_id IS NOT NULL
       GROUP BY community_id
       ORDER BY n DESC
       LIMIT 20`,
    )
    .all();

  const topByCommunityStmt = db.prepare(
    `SELECT label FROM graph_nodes
     WHERE community_id = ?
     ORDER BY (
       SELECT COUNT(*) FROM graph_edges
       WHERE source = graph_nodes.id OR target = graph_nodes.id
     ) DESC
     LIMIT 5`,
  );

  const lines: string[] = [];
  lines.push(`# Scrypt Graph Report`);
  lines.push("");
  lines.push(`- Nodes: ${totalNodes}`);
  lines.push(`- Edges: ${totalEdges}`);
  lines.push("");
  lines.push(`## Hub Nodes`);
  for (const h of hubs) {
    lines.push(`- **${h.label ?? h.id}** — degree ${h.degree}`);
  }
  lines.push("");
  lines.push(`## Communities`);
  for (const c of communities) {
    const top = (topByCommunityStmt.all(c.community_id) as { label: string }[])
      .map((r) => r.label)
      .join(", ");
    lines.push(`- Community ${c.community_id} (${c.n} nodes): ${top}`);
  }
  lines.push("");
  if (orphans.length > 0) {
    lines.push(`## Orphan Notes`);
    for (const o of orphans) lines.push(`- ${o.label ?? o.id}`);
    lines.push("");
  }
  lines.push(`## Suggested Questions`);
  for (const h of hubs.slice(0, 5)) {
    lines.push(`- What connects **${h.label ?? h.id}** to the rest of the vault?`);
  }
  return lines.join("\n");
}
