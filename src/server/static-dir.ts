// src/server/static-dir.ts
//
// Where the built web UI lives. Resolution order:
//   1. SCRYPT_STATIC_DIR (explicit; Docker sets /app/dist)
//   2. <repo>/dist when `bun run build` has produced it — the native case,
//      so a vault outside the repo still gets the UI without any env work
//   3. <vault>/dist (legacy fallback)
export interface StaticDirInput {
  env: string | undefined;
  repoDist: string;
  vaultDist: string;
}

export function resolveStaticDir(
  input: StaticDirInput,
  exists: (p: string) => boolean,
): { dir: string; source: "env" | "repo" | "vault" } {
  if (input.env && input.env.trim() !== "") return { dir: input.env, source: "env" };
  if (exists(input.repoDist)) return { dir: input.repoDist, source: "repo" };
  return { dir: input.vaultDist, source: "vault" };
}
