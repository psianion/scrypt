// src/server/embeddings/chunker.ts
//
// Turns a ParsedStructural into EmbeddingChunk records ready for the
// embedder. One primary chunk per section; long sections split into
// overlapping sub-chunks. Every chunk text is prefixed with a title →
// heading breadcrumb so short chunks retain whole-note context.
import { createHash } from "crypto";
import type {
  ParsedStructural,
  ParsedSection,
} from "../indexer/structural-parse";

export interface EmbeddingChunk {
  note_path: string;
  chunk_id: string;
  text: string;
  display_text: string;
  // provisional 0 — Task 5 exports CHUNKER_VERSION and adds the DB column
  chunker_version: number;
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

const CHUNKER_VERSION = 1;

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

function buildBreadcrumb(
  parsed: ParsedStructural,
  section: ParsedSection,
): string {
  const trail: string[] = [parsed.title];
  if (section.level > 0) {
    const idx = parsed.sections.indexOf(section);
    const ancestors: string[] = [];
    let wantLevel = section.level - 1; // next-shallower ancestor still needed
    for (let i = idx - 1; i >= 0 && wantLevel >= 1; i--) {
      const s = parsed.sections[i];
      if (s.level > 0 && s.level <= wantLevel) {
        ancestors.unshift(s.headingText);
        wantLevel = s.level - 1;
      }
    }
    trail.push(...ancestors, section.headingText);
  }
  return trail.join(" › ");
}

function contextPrefix(
  parsed: ParsedStructural,
  section: ParsedSection,
): string {
  return `${buildBreadcrumb(parsed, section)}\n\n`;
}

// Split a section body into evenly-sized word slices, preferring blank-line
// paragraph boundaries and balancing so no final slice is a tiny orphan.
function splitIntoSlices(
  body: string,
  wordBudget: number,
  overlapWords: number,
): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const slices: string[] = [];
  let buf: string[] = [];
  let bufWords = 0;
  const flush = () => {
    if (buf.length > 0) {
      slices.push(buf.join("\n\n"));
      buf = [];
      bufWords = 0;
    }
  };
  for (const para of paras) {
    const pw = para.split(/\s+/).filter(Boolean).length;
    if (pw > wordBudget) {
      flush();
      const words = para.split(/\s+/).filter(Boolean);
      const step = Math.max(1, wordBudget - overlapWords);
      for (let cursor = 0; cursor < words.length; cursor += step) {
        slices.push(words.slice(cursor, cursor + wordBudget).join(" "));
        if (cursor + wordBudget >= words.length) break;
      }
      continue;
    }
    if (bufWords + pw > wordBudget) flush();
    buf.push(para);
    bufWords += pw;
  }
  flush();
  if (slices.length >= 2) {
    const lastWords = slices[slices.length - 1].split(/\s+/).filter(Boolean).length;
    if (lastWords < Math.floor(wordBudget / 2)) {
      const a = slices[slices.length - 2].split(/\s+/).filter(Boolean);
      const b = slices[slices.length - 1].split(/\s+/).filter(Boolean);
      const combined = [...a, ...b];
      const half = Math.ceil(combined.length / 2);
      slices.splice(
        slices.length - 2,
        2,
        combined.slice(0, half).join(" "),
        combined.slice(half).join(" "),
      );
    }
  }
  return slices.length > 0 ? slices : [body.trim()];
}

export function chunkNote(
  parsed: ParsedStructural,
  opts: ChunkOptions,
): EmbeddingChunk[] {
  const chunks: EmbeddingChunk[] = [];
  const wordBudget = approxWordBudget(opts.maxTokens);
  const overlapWords = approxWordBudget(opts.overlapTokens);

  for (const section of parsed.sections) {
    const body = sectionBody(parsed, section);
    if (isBlank(body)) continue;

    const prefix = contextPrefix(parsed, section);
    const words = body.split(/\s+/).filter((w) => w.length > 0);

    if (words.length <= wordBudget) {
      const text = prefix + body;
      chunks.push({
        note_path: parsed.notePath,
        chunk_id: section.id,
        text,
        display_text: body,
        chunker_version: CHUNKER_VERSION,
        start_line: section.startLine,
        end_line: section.endLine,
        content_hash: hash(text),
      });
      continue;
    }

    const slices = splitIntoSlices(body, wordBudget, overlapWords);
    slices.forEach((slice, part) => {
      const text = prefix + slice;
      chunks.push({
        note_path: parsed.notePath,
        chunk_id: `${section.id}:part_${part}`,
        text,
        display_text: slice,
        chunker_version: CHUNKER_VERSION,
        start_line: section.startLine,
        end_line: section.endLine,
        content_hash: hash(text),
      });
    });
  }
  return chunks;
}
