import type { Database } from "bun:sqlite";

export interface SnapshotNode {
  id: string;
  title: string;
  doc_type: string | null;
  degree: number;
  community: number | null;
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

  const edgeRows = db
    .query<EdgeRow, []>(
      `SELECT source, target, relation, confidence, reason FROM graph_edges`,
    )
    .all();

  const edges: SnapshotEdge[] = [];
  const degree = new Map<string, number>();
  for (const e of edgeRows) {
    if (!noteIds.has(e.source) || !noteIds.has(e.target)) continue;
    edges.push(e);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const metaRows = db
    .query<MetaRow, []>(`SELECT note_path, doc_type FROM note_metadata`)
    .all();
  const docType = new Map<string, string | null>();
  for (const m of metaRows) docType.set(m.note_path, m.doc_type);

  const nodes: SnapshotNode[] = nodeRows.map((r) => ({
    id: r.id,
    title: r.label,
    doc_type: docType.get(r.note_path) ?? null,
    degree: degree.get(r.id) ?? 0,
    community: r.community_id,
  }));

  return {
    generated_at: Date.now(),
    nodes,
    edges,
  };
}
