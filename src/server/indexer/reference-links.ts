// src/server/indexer/reference-links.ts
//
// Deterministic reference extractor (spec C2). Pulls explicit references out
// of a note body: internal markdown links, wikilinks, and "see also" /
// citation cross-refs. No DB and no LLM — pure string work. Path resolution
// and graph_edges writing happen in Indexer (reuses Indexer.resolveLink).

export interface ReferenceTarget {
  raw: string;
  reason: "reference" | "cites";
}

// [label](target) where target is not an external URL and not an anchor.
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
// [[Target]] or [[Target|alias]] — wikilink, target is the left side.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
// A heading line that opens a citation context.
const CITES_HEADING_RE = /^#{1,6}\s+(references|sources|citations|bibliography)\s*$/i;

function isExternal(target: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || // http://, https://, etc with //
    /^(mailto|tel):/i.test(target) ||
    target.startsWith("#") || // pure anchor, not a note
    target.startsWith("//")
  );
}

function stripFences(body: string): string[] {
  const lines = body.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const ln of lines) {
    if (/^```/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(ln);
  }
  return out;
}

export function extractReferenceTargets(body: string): ReferenceTarget[] {
  const lines = stripFences(body);
  const seen = new Map<string, ReferenceTarget>();
  let inCites = false;

  const add = (raw: string, reason: "reference" | "cites") => {
    const key = raw.trim();
    if (key.length === 0) return;
    if (!seen.has(key)) seen.set(key, { raw: key, reason });
  };

  for (const ln of lines) {
    const headingMatch = /^#{1,6}\s+/.test(ln);
    if (headingMatch) inCites = CITES_HEADING_RE.test(ln);

    for (const m of ln.matchAll(MD_LINK_RE)) {
      const target = m[1];
      if (isExternal(target)) continue;
      add(target, inCites ? "cites" : "reference");
    }
    for (const m of ln.matchAll(WIKILINK_RE)) {
      add(m[1], inCites ? "cites" : "reference");
    }
  }

  return Array.from(seen.values());
}
