// src/server/embeddings/service.ts
//
// Ties chunker + engine + chunk repo + progress bus into one pipeline.
// Called by the indexer's file-watch path and by the MCP create_note
// tool. The service is sync in the sense that embedNote awaits every
// batch before returning — the UI animation driven by the progress bus
// is what makes it feel live.
import {
  chunkNote,
  type ChunkOptions,
  type EmbeddingChunk,
} from "./chunker";
import type { ChunkEmbeddingsRepo } from "./chunks-repo";
import type { ProgressBus } from "./progress";
import type { ParsedStructural } from "../indexer/structural-parse";

export interface EngineLike {
  model: string;
  batchSize: number;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  prewarm?(): Promise<void>;
}

export interface EmbedResult {
  chunks_total: number;
  chunks_embedded: number;
  embed_ms: number;
}

export interface EmbeddingServiceOptions {
  engine: EngineLike;
  repo: ChunkEmbeddingsRepo;
  bus: ProgressBus;
  chunkOpts: ChunkOptions;
}

export class EmbeddingService {
  private inflight = new Map<string, Promise<EmbedResult>>();

  constructor(private opts: EmbeddingServiceOptions) {}

  async embedNote(
    parsed: ParsedStructural,
    correlationId: string,
  ): Promise<EmbedResult> {
    // Coalesce concurrent embeds for the same (path, content_hash) so
    // that MCP create_note + the fs watcher's follow-up reindexNote
    // share a single pipeline run instead of racing and double-firing
    // every UI overlay event.
    const key = `${parsed.notePath}\u0000${parsed.contentHash}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.embedNoteImpl(parsed, correlationId).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async embedNoteImpl(
    parsed: ParsedStructural,
    correlationId: string,
  ): Promise<EmbedResult> {
    const { engine, repo, bus, chunkOpts } = this.opts;
    const startedAt = Date.now();

    const chunks = chunkNote(parsed, chunkOpts);

    // Fast-path: if every chunk is already cached with matching hash
    // (sequential re-invocation with unchanged content), skip the
    // pipeline and emit nothing so the UI overlay isn't re-pulsed.
    if (
      chunks.length > 0 &&
      chunks.every((c) =>
        repo.hasFreshChunk(
          c.note_path,
          c.chunk_id,
          engine.model,
          c.content_hash,
        ),
      )
    ) {
      return {
        chunks_total: chunks.length,
        chunks_embedded: chunks.length,
        embed_ms: 0,
      };
    }

    bus.emit({
      type: "embedding_progress",
      correlation_id: correlationId,
      note_path: parsed.notePath,
      phase: "parsing",
    });

    bus.emit({
      type: "embedding_progress",
      correlation_id: correlationId,
      note_path: parsed.notePath,
      phase: "chunking",
      chunk_total: chunks.length,
    });

    const misses: EmbeddingChunk[] = [];
    const hitIds = new Set<string>();
    const allIds = new Set<string>();
    for (const c of chunks) {
      allIds.add(c.chunk_id);
      if (
        repo.hasFreshChunk(
          c.note_path,
          c.chunk_id,
          engine.model,
          c.content_hash,
        )
      ) {
        hitIds.add(c.chunk_id);
      } else {
        misses.push(c);
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      bus.emit({
        type: "embedding_progress",
        correlation_id: correlationId,
        note_path: parsed.notePath,
        phase: "embedding",
        chunk_id: c.chunk_id,
        chunk_index: i,
        chunk_total: chunks.length,
        chunk_range: [c.start_line, c.end_line],
        cache_hit: hitIds.has(c.chunk_id),
      });
    }

    const batches: EmbeddingChunk[][] = [];
    for (let i = 0; i < misses.length; i += engine.batchSize) {
      batches.push(misses.slice(i, i + engine.batchSize));
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const vectors = await engine.embedBatch(batch.map((c) => c.text));
      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        repo.upsert({
          note_path: c.note_path,
          chunk_id: c.chunk_id,
          chunk_text: c.text,
          start_line: c.start_line,
          end_line: c.end_line,
          model: engine.model,
          dims: vectors[i].length,
          vector: vectors[i],
          content_hash: c.content_hash,
        });
      }
      for (const c of batch) {
        bus.emit({
          type: "embedding_progress",
          correlation_id: correlationId,
          note_path: parsed.notePath,
          phase: "stored",
          chunk_id: c.chunk_id,
          chunk_range: [c.start_line, c.end_line],
          batch_index: b,
          batch_total: batches.length,
        });
      }
    }

    for (const c of chunks) {
      if (hitIds.has(c.chunk_id)) {
        bus.emit({
          type: "embedding_progress",
          correlation_id: correlationId,
          note_path: parsed.notePath,
          phase: "stored",
          chunk_id: c.chunk_id,
          chunk_range: [c.start_line, c.end_line],
          cache_hit: true,
        });
      }
    }

    repo.deleteMissingChunks(parsed.notePath, engine.model, allIds);

    const embed_ms = Date.now() - startedAt;
    bus.emit({
      type: "embedding_progress",
      correlation_id: correlationId,
      note_path: parsed.notePath,
      phase: "done",
    });

    return {
      chunks_total: chunks.length,
      chunks_embedded: chunks.length,
      embed_ms,
    };
  }
}
