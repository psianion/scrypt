import { isAbsolute, resolve } from "node:path";

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
 * Note the `root + "/"` guard: a sibling like `/x/scrypt-other` must NOT count
 * as inside `/x/scrypt`.
 */
export function safeTempBase(base: string, repoRoot: string): string {
  const root = resolve(repoRoot);
  if (isAbsolute(base)) {
    const r = resolve(base);
    if (r !== root && !r.startsWith(root + "/")) return base;
  }
  return "/tmp";
}
