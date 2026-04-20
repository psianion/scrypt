import type { Database } from "bun:sqlite";
import {
  mkdirSync,
  renameSync,
  unlinkSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface SnapshotNode {
  id: string;
  title: string;
  doc_type: string | null;
  /** First meaningful path segment — used to group nodes into project clusters. */
  project: string;
  degree: number;
  community: number | null;
}

/**
 * Pick a project name from a vault-relative path. `research/<name>/...` is the
 * main pattern in this vault, so the 2nd segment wins there; otherwise the
 * first segment (`journal`, `docs`, `assets`, etc.) is the project.
 */
export function projectOf(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "root";
  if (parts[0] === "research" && parts.length > 2 && parts[1]) return parts[1]!;
  return parts[0]!;
}

export interface SnapshotEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string | null;
  reason: string | null;
}

export interface GraphSnapshot {
  generated_at: number;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

interface NodeRow {
  id: string;
  label: string;
  note_path: string;
  community_id: number | null;
}

interface EdgeRow {
  source: string;
  target: string;
  relation: string;
  confidence: string | null;
  reason: string | null;
}

interface MetaRow {
  note_path: string;
  doc_type: string | null;
}

export function buildGraphSnapshot(db: Database): GraphSnapshot {
  const nodeRows = db
    .query<NodeRow, []>(
      `SELECT id, label, note_path, community_id
       FROM graph_nodes
       WHERE kind = 'note'`,
    )
    .all();

  const noteIds = new Set(nodeRows.map((r) => r.id));

  // Pre-compute each node's project from its path. Used to filter edges and
  // color clusters.
  const projectById = new Map<string, string>();
  for (const r of nodeRows) projectById.set(r.id, projectOf(r.note_path));

  const edgeRows = db
    .query<EdgeRow, []>(
      `SELECT source, target, relation, confidence, reason FROM graph_edges`,
    )
    .all();

  // Drop cross-project *semantic* edges — cosine-close but unrelated pairs
  // (e.g. a dnd note close to a goveva note) create hairballs that obscure
  // actual structure. Explicit `connected`/`mentions` edges are kept across
  // projects because they represent real authored links.
  const edges: SnapshotEdge[] = [];
  const degree = new Map<string, number>();
  for (const e of edgeRows) {
    if (!noteIds.has(e.source) || !noteIds.has(e.target)) continue;
    const tier = e.confidence ?? "connected";
    if (
      tier === "semantically_related" &&
      projectById.get(e.source) !== projectById.get(e.target)
    ) {
      continue;
    }
    edges.push(e);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const metaRows = db
    .query<MetaRow, []>(`SELECT note_path, doc_type FROM note_metadata`)
    .all();
  const docType = new Map<string, string | null>();
  for (const m of metaRows) docType.set(m.note_path, m.doc_type);

  // Map distinct projects to small stable integer community ids so the client
  // can color clusters consistently even when `graph_nodes.community_id` hasn't
  // been populated yet by cluster_graph.
  const projectIndex = new Map<string, number>();
  for (const p of projectById.values()) {
    if (!projectIndex.has(p)) projectIndex.set(p, projectIndex.size);
  }

  const nodes: SnapshotNode[] = nodeRows.map((r) => {
    const project = projectById.get(r.id) ?? projectOf(r.note_path);
    return {
      id: r.id,
      title: r.label,
      doc_type: docType.get(r.note_path) ?? null,
      project,
      degree: degree.get(r.id) ?? 0,
      community: r.community_id ?? projectIndex.get(project) ?? null,
    };
  });

  return {
    generated_at: Date.now(),
    nodes,
    edges,
  };
}

export function writeGraphSnapshot(db: Database, vaultDir: string): string {
  const snap = buildGraphSnapshot(db);
  const dir = join(vaultDir, ".scrypt");
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, "graph.json");
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  const payload = Buffer.from(JSON.stringify(snap), "utf8");
  let fd: number | null = null;
  try {
    fd = openSync(tmpPath, "w");
    writeSync(fd, payload, 0, payload.length, 0);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmpPath, finalPath);
  } catch (err) {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    try {
      unlinkSync(tmpPath);
    } catch (cleanupErr: unknown) {
      const code = (cleanupErr as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw cleanupErr;
    }
    throw err;
  }
  return finalPath;
}
