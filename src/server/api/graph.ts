// src/server/api/graph.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import type {
  GraphResponse,
  GraphNode,
  GraphEdge,
} from "../../shared/graph-types";
import { RESERVED_NAMESPACES, type Tag } from "../../shared/types";
import { parseTag } from "../parsers";
import type { SnapshotScheduler } from "../graph/snapshot-scheduler";
import { writeGraphSnapshot } from "../graph/snapshot";

const SNAPSHOT_STALE_MS = 10_000;

interface NoteRow {
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

export function graphRoutes(
  router: Router,
  db: Database,
  vaultDir: string,
  scheduler: SnapshotScheduler,
): void {
  router.get("/api/graph/snapshot", (req) => {
    const filePath = join(vaultDir, ".scrypt", "graph.json");

    if (!existsSync(filePath)) {
      writeGraphSnapshot(db, vaultDir);
    } else {
      const age = Date.now() - statSync(filePath).mtimeMs;
      if (age > SNAPSHOT_STALE_MS) {
        // stale-while-revalidate: serve file, schedule a rebuild in bg
        scheduler.schedule();
      }
    }

    const body = readFileSync(filePath);
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "ETag": etag,
        "Cache-Control": "no-cache",
      },
    });
  });

  router.get("/api/graph", async () => {
    const noteRows = db
      .query(
        `SELECT path, title, domain, subdomain, tags FROM notes ORDER BY path`,
      )
      .all() as NoteRow[];

    const visible = noteRows.filter(
      (r) => !RESERVED_PREFIXES.some((p) => r.path.startsWith(p)),
    );

    const nodes: GraphNode[] = visible.map((r) => ({
      id: r.path,
      path: r.path,
      title: r.title ?? r.path,
      domain: r.domain,
      subdomain: r.subdomain,
      tags: parseTagsField(r.tags),
      connectionCount: 0,
    }));

    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = [];

    // 1. wikilink edges — Wave 8 graph_edges uses relation='wikilink'.
    const linkRows = db
      .query(
        `SELECT source, target FROM graph_edges WHERE relation = 'wikilink'`,
      )
      .all() as { source: string; target: string }[];
    for (const row of linkRows) {
      if (!visibleIds.has(row.source) || !visibleIds.has(row.target))
        continue;
      edges.push({
        source: row.source,
        target: row.target,
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

    // 5. similarity edges from embeddings
    const model = process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5";
    const chunkRows = db
      .query<
        { note_path: string; dims: number; vector: Uint8Array },
        [string]
      >(
        `SELECT note_path, dims, vector FROM note_chunk_embeddings WHERE model = ?`,
      )
      .all(model);

    if (chunkRows.length > 0) {
      // Average chunk vectors per note
      const noteVecs = new Map<string, { sum: Float32Array; count: number }>();
      for (const r of chunkRows) {
        if (!visibleIds.has(r.note_path)) continue;
        const vec = new Float32Array(
          new Uint8Array(r.vector).buffer.slice(0, r.dims * 4),
        );
        let entry = noteVecs.get(r.note_path);
        if (!entry) {
          entry = { sum: new Float32Array(r.dims), count: 0 };
          noteVecs.set(r.note_path, entry);
        }
        for (let k = 0; k < r.dims; k++) entry.sum[k] += vec[k];
        entry.count += 1;
      }

      // Normalize averaged vectors
      const averaged: Array<{ path: string; vec: Float32Array }> = [];
      for (const [path, entry] of noteVecs) {
        const vec = entry.sum;
        for (let k = 0; k < vec.length; k++) vec[k] /= entry.count;
        let norm = 0;
        for (let k = 0; k < vec.length; k++) norm += vec[k] * vec[k];
        norm = Math.sqrt(norm);
        if (norm > 0) for (let k = 0; k < vec.length; k++) vec[k] /= norm;
        averaged.push({ path, vec });
      }

      // Pairwise cosine similarity — add edges above threshold
      const SIM_THRESHOLD = 0.8;
      for (let i = 0; i < averaged.length; i++) {
        for (let j = i + 1; j < averaged.length; j++) {
          const a = averaged[i];
          const b = averaged[j];
          let score = 0;
          for (let k = 0; k < a.vec.length; k++) score += a.vec[k] * b.vec[k];
          if (score >= SIM_THRESHOLD) {
            edges.push({
              source: a.path,
              target: b.path,
              type: "similarity",
              weight: score,
            });
          }
        }
      }
    }

    // connectionCount
    const countMap = new Map<string, number>();
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
