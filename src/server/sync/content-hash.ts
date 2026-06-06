// src/server/sync/content-hash.ts
//
// The single source of truth for a note's content hash. Must stay
// byte-for-byte compatible with what the indexer records in
// graph_nodes.content_hash, so the sync engine can compare local and
// hub notes reliably. Input is the parsed frontmatter object + the
// frontmatter-stripped body, exactly as FileManager.readNote returns them.
export function computeContentHash(
  frontmatter: Record<string, unknown>,
  content: string,
): string {
  return Bun.hash(`${JSON.stringify(frontmatter)}${content}`).toString(16);
}
