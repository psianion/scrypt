import { isAbsolute, relative, resolve } from "node:path";

/**
 * Returns a temp base directory guaranteed to be absolute and OUTSIDE the repo.
 *
 * Some CI/shell environments set `TMPDIR` to a relative or repo-relative path.
 * When that happens, `mkdtemp(join(tmpdir(), "<prefix>-"))` — used by ~50 test
 * files — dumps scratch dirs straight into the repo root, where they pile up
 * (we once found 465). When the given `base` is unsafe (relative, the repo root
 * itself, or anywhere inside it), fall back to `/tmp`, which exists on macOS and
 * Linux (the only platforms this project targets).
 *
 * Containment is checked with `relative()` rather than string prefixing so it
 * is separator-agnostic (Windows `resolve()` yields backslashes, which a
 * `root + "/"` prefix test would miss) and so a sibling like `/x/scrypt-other`
 * is NOT mistaken for being inside `/x/scrypt`.
 */
export function safeTempBase(base: string, repoRoot: string): string {
  if (!isAbsolute(base)) return "/tmp";
  const root = resolve(repoRoot);
  const rel = relative(root, resolve(base));
  // rel === "" is the repo root itself; a rel that neither escapes upward
  // (`..`) nor is absolute (different drive on Windows) lies inside the repo.
  const insideRepo = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  return insideRepo ? "/tmp" : base;
}
