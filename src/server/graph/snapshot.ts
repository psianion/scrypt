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
import { parseTier, type Tier } from "../../shared/types";

export interface SnapshotNode {
  id: string;
  title: string;
  doc_type: string | null;
  project: string;
  degree: number;
  community: number | null;
}

export function projectOf(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "root";
  if (parts[0] === "research" && parts.length > 2 && parts[1]) return parts[1]!;
  return parts[0]!;
}

export interface SnapshotEdge {
  source: string;
  target: string;
  tier: Tier;
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
  tier: string;
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

  const projectById = new Map<string, string>();
  for (const r of nodeRows) projectById.set(r.id, projectOf(r.note_path));

  const pathById = new Map<string, string>();
  for (const r of nodeRows) pathById.set(r.id, r.note_path);

  const metaRows = db
    .query<MetaRow, []>(`SELECT note_path, doc_type FROM note_metadata`)
    .all();
  const docType = new Map<string, string | null>();
  for (const m of metaRows) docType.set(m.note_path, m.doc_type);

  // Resolve doc_type by node id via its note_path; the snapshot enforces
  // anti-connection rules here so the renderer never sees disallowed edges.
  const docTypeById = (id: string): string | null => {
    const p = pathById.get(id);
    return p ? docType.get(p) ?? null : null;
  };

  const edgeRows = db
    .query<EdgeRow, []>(
      `SELECT source, target, tier, reason FROM graph_edges`,
    )
    .all();

  const edges: SnapshotEdge[] = [];
  const degree = new Map<string, number>();
  for (const e of edgeRows) {
    if (!noteIds.has(e.source) || !noteIds.has(e.target)) continue;
    let tier = parseTier(e.tier);
    if (tier === null) continue;

    const srcType = docTypeById(e.source);
    const tgtType = docTypeById(e.target);

    if (srcType === "plan" && tgtType === "plan") continue;

    if (
      srcType === "journal" ||
      srcType === "changelog" ||
      tgtType === "journal" ||
      tgtType === "changelog"
    ) {
      if (tier === "connected") tier = "mentions";
    }

    if (
      tier === "semantically_related" &&
      projectById.get(e.source) !== projectById.get(e.target)
    ) {
      continue;
    }
    edges.push({
      source: e.source,
      target: e.target,
      tier,
      reason: e.reason,
    });
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // Fallback community ids so clusters colour consistently before cluster_graph runs.
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
