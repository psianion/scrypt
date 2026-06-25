// src/server/paths.ts
//
// Vault-relative paths are a LOGICAL namespace: they key graph nodes, the DB,
// the REST API, the sync manifest, and wiki-links, and the whole app + tests
// treat them as POSIX ("notes/inbox/x.md"). But node:path `relative()`/`join()`
// and the fs watcher emit OS-native separators — on Windows that's backslashes.
// Normalize at every point a filesystem path becomes a vault-relative path so a
// note has ONE canonical id regardless of host OS.

/** Convert OS-native separators to POSIX "/". No-op on POSIX hosts. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
