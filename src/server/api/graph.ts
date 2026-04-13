// src/server/api/graph.ts
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import type {
  GraphResponse,
  GraphNodeV2,
  GraphEdgeV2,
} from "../../shared/graph-types";
import { RESERVED_NAMESPACES, type Tag } from "../../shared/types";
import { parseTag } from "../parsers";

interface NoteRow {
  id: number;
  path: string;
  title: string | null;
  domain: string | null;
  subdomain: string | null;
  tags: string | null;
}

const RESERVED_PREFIXES = [
  ".scrypt/",
  "journal/",
  "data/",
  "assets/",
  "dist/",
];

export function graphRoutes(router: Router, db: Database): void {
  router.get("/api/graph", async () => {
    const noteRows = db
      .query(
        `SELECT id, path, title, domain, subdomain, tags FROM notes ORDER BY id`,
      )
      .all() as NoteRow[];

    const visible = noteRows.filter(
      (r) => !RESERVED_PREFIXES.some((p) => r.path.startsWith(p)),
    );

    const nodes: GraphNodeV2[] = visible.map((r) => ({
      id: r.id,
      path: r.path,
      title: r.title ?? r.path,
      domain: r.domain,
      subdomain: r.subdomain,
      tags: parseTagsField(r.tags),
      connectionCount: 0,
    }));

    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges: GraphEdgeV2[] = [];

    // 1. wikilink edges — persisted in graph_edges as type='link'
    const linkRows = db
      .query(
        `SELECT source_id, target_id FROM graph_edges WHERE type = 'link'`,
      )
      .all() as { source_id: number; target_id: number }[];
    for (const row of linkRows) {
      if (!visibleIds.has(row.source_id) || !visibleIds.has(row.target_id))
        continue;
      edges.push({
        source: row.source_id,
        target: row.target_id,
        type: "wikilink",
        weight: 3,
      });
    }

    // 2. subdomain: equal (domain, subdomain), both non-null
    // 3. domain: equal domain, different (or one missing) subdomain
    // 4. tag: shared namespaced tag from RESERVED_NAMESPACES, same ns AND value
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];

        if (a.domain && b.domain && a.domain === b.domain) {
          if (a.subdomain && a.subdomain === b.subdomain) {
            edges.push({
              source: a.id,
              target: b.id,
              type: "subdomain",
              weight: 2,
            });
          } else if (a.subdomain !== b.subdomain) {
            edges.push({
              source: a.id,
              target: b.id,
              type: "domain",
              weight: 1,
            });
          }
        }

        if (hasSharedReservedTag(a.tags, b.tags)) {
          edges.push({
            source: a.id,
            target: b.id,
            type: "tag",
            weight: 1.5,
          });
        }
      }
    }

    // connectionCount
    const countMap = new Map<number, number>();
    for (const e of edges) {
      countMap.set(e.source, (countMap.get(e.source) ?? 0) + 1);
      countMap.set(e.target, (countMap.get(e.target) ?? 0) + 1);
    }
    for (const n of nodes) {
      n.connectionCount = countMap.get(n.id) ?? 0;
    }

    const payload: GraphResponse = { nodes, edges };
    return Response.json(payload);
  });
}

function parseTagsField(raw: string | null): Tag[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").map(parseTag);
  } catch {
    return [];
  }
}

function hasSharedReservedTag(a: Tag[], b: Tag[]): boolean {
  for (const ta of a) {
    if (ta.namespace === null) continue;
    if (!RESERVED_NAMESPACES.has(ta.namespace)) continue;
    for (const tb of b) {
      if (tb.namespace === ta.namespace && tb.value === ta.value) return true;
    }
  }
  return false;
}
