// src/server/embeddings/chunker.ts
//
// Turns a ParsedStructural into EmbeddingChunk records ready for the
// embedder. One primary chunk per section; long sections split into
// overlapping sub-chunks. Every chunk text is prefixed with the note
// title so short chunks retain whole-note context.
import { createHash } from "crypto";
import type {
  ParsedStructural,
  ParsedSection,
} from "../indexer/structural-parse";

export interface EmbeddingChunk {
  note_path: string;
  chunk_id: string;
  text: string;
  start_line: number;
  end_line: number;
  content_hash: string;
}

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

// Rough token ≈ 1.3 English words. This is a heuristic used only to
// decide when to split; the embedder's tokenizer does the real thing.
const APPROX_TOKENS_PER_WORD = 1.3;

function approxWordBudget(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens / APPROX_TOKENS_PER_WORD));
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sectionBody(
  parsed: ParsedStructural,
  section: ParsedSection,
): string {
  const lines = parsed.body.split("\n");
  const from = section.level > 0 ? section.startLine + 1 : section.startLine;
  return lines.slice(from, section.endLine + 1).join("\n").trim();
}

function isBlank(s: string): boolean {
  return s.replace(/\s+/g, "") === "";
}

export function chunkNote(
  parsed: ParsedStructural,
  opts: ChunkOptions,
): EmbeddingChunk[] {
  const chunks: EmbeddingChunk[] = [];
  const titlePrefix = `${parsed.title}\n\n`;
  const wordBudget = approxWordBudget(opts.maxTokens);
  const overlapWords = approxWordBudget(opts.overlapTokens);
  const step = Math.max(1, wordBudget - overlapWords);

  for (const section of parsed.sections) {
    const body = sectionBody(parsed, section);
    if (isBlank(body)) continue;

    const words = body.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= wordBudget) {
      const text = titlePrefix + body;
      chunks.push({
        note_path: parsed.notePath,
        chunk_id: section.id,
        text,
        start_line: section.startLine,
        end_line: section.endLine,
        content_hash: hash(text),
      });
      continue;
    }

    let part = 0;
    let cursor = 0;
    while (cursor < words.length) {
      const slice = words.slice(cursor, cursor + wordBudget).join(" ");
      if (isBlank(slice)) break;
      const text = titlePrefix + slice;
      chunks.push({
        note_path: parsed.notePath,
        chunk_id: `${section.id}:part_${part}`,
        text,
        start_line: section.startLine,
        end_line: section.endLine,
        content_hash: hash(text),
      });
      part += 1;
      if (cursor + wordBudget >= words.length) break;
      cursor += step;
    }
  }
  return chunks;
}
