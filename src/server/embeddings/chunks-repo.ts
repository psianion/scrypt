// src/server/embeddings/chunks-repo.ts
//
// Persistence for per-chunk embeddings. Vectors are stored as a raw
// Float32 byte view in the SQLite BLOB column. hasFreshChunk powers the
// content-hash cache skip so unchanged sections of a partially-edited
// note don't get re-embedded.
import type { Database } from "bun:sqlite";

interface ChunkEmbeddingInput {
  note_path: string;
  chunk_id: string;
  chunk_text: string;
  start_line: number;
  end_line: number;
  model: string;
  dims: number;
  vector: Float32Array;
  content_hash: string;
}

export interface ChunkEmbeddingRow {
  note_path: string;
  chunk_id: string;
  chunk_text: string;
  start_line: number;
  end_line: number;
  model: string;
  dims: number;
  vector: Float32Array;
  content_hash: string;
  created_at: number;
}

interface RawRow {
  note_path: string;
  chunk_id: string;
  chunk_text: string;
  start_line: number;
  end_line: number;
  model: string;
  dims: number;
  vector: Uint8Array;
  content_hash: string;
  created_at: number;
}

function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function fromBlob(b: Uint8Array, dims: number): Float32Array {
  const copy = new ArrayBuffer(dims * 4);
  new Uint8Array(copy).set(b);
  return new Float32Array(copy);
}

function hydrate(r: RawRow): ChunkEmbeddingRow {
  return { ...r, vector: fromBlob(r.vector, r.dims) };
}

export class ChunkEmbeddingsRepo {
  constructor(private db: Database) {}

  upsert(c: ChunkEmbeddingInput): void {
    this.db
      .query(
        `INSERT INTO note_chunk_embeddings
           (note_path, chunk_id, chunk_text, start_line, end_line,
            model, dims, vector, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_path, chunk_id) DO UPDATE SET
           chunk_text   = excluded.chunk_text,
           start_line   = excluded.start_line,
           end_line     = excluded.end_line,
           model        = excluded.model,
           dims         = excluded.dims,
           vector       = excluded.vector,
           content_hash = excluded.content_hash,
           created_at   = excluded.created_at`,
      )
      .run(
        c.note_path,
        c.chunk_id,
        c.chunk_text,
        c.start_line,
        c.end_line,
        c.model,
        c.dims,
        toBlob(c.vector),
        c.content_hash,
        Date.now(),
      );
  }

  hasFreshChunk(
    notePath: string,
    chunkId: string,
    model: string,
    contentHash: string,
  ): boolean {
    const row = this.db
      .query<{ n: number }, [string, string, string, string]>(
        `SELECT COUNT(*) AS n FROM note_chunk_embeddings
         WHERE note_path = ? AND chunk_id = ? AND model = ? AND content_hash = ?`,
      )
      .get(notePath, chunkId, model, contentHash);
    return (row?.n ?? 0) > 0;
  }

  listByNote(notePath: string, model: string): ChunkEmbeddingRow[] {
    const rows = this.db
      .query<RawRow, [string, string]>(
        `SELECT * FROM note_chunk_embeddings WHERE note_path = ? AND model = ?`,
      )
      .all(notePath, model);
    return rows.map(hydrate);
  }

  deleteByNote(notePath: string, model: string): number {
    return this.db
      .query(
        `DELETE FROM note_chunk_embeddings WHERE note_path = ? AND model = ?`,
      )
      .run(notePath, model).changes;
  }

  deleteMissingChunks(
    notePath: string,
    model: string,
    keepIds: Set<string>,
  ): void {
    const existing = this.db
      .query<{ chunk_id: string }, [string, string]>(
        `SELECT chunk_id FROM note_chunk_embeddings WHERE note_path = ? AND model = ?`,
      )
      .all(notePath, model);
    const toDelete = existing.filter((r) => !keepIds.has(r.chunk_id));
    if (toDelete.length === 0) return;

    const stmt = this.db.prepare(
      `DELETE FROM note_chunk_embeddings
       WHERE note_path = ? AND model = ? AND chunk_id = ?`,
    );
    const tx = this.db.transaction(() => {
      for (const r of toDelete) stmt.run(notePath, model, r.chunk_id);
    });
    tx();
  }

  scanAll(model: string): ChunkEmbeddingRow[] {
    const rows = this.db
      .query<RawRow, [string]>(
        `SELECT * FROM note_chunk_embeddings WHERE model = ?`,
      )
      .all(model);
    return rows.map(hydrate);
  }

  countByModel(model: string): number {
    return (
      this.db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM note_chunk_embeddings WHERE model = ?`,
        )
        .get(model)?.n ?? 0
    );
  }
}
