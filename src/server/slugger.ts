// src/server/slugger.ts
const MAX_LEN = 60;

export function slugify(input: string): string {
  const lowered = input.toLowerCase();
  const ascii = lowered
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length === 0) return "untitled";
  if (ascii.length <= MAX_LEN) return ascii;
  const clipped = ascii.slice(0, MAX_LEN);
  const lastHyphen = clipped.lastIndexOf("-");
  const cut = lastHyphen > 0 ? clipped.slice(0, lastHyphen) : clipped;
  return cut.replace(/-+$/, "");
}

export function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => boolean,
): string {
  if (!isTaken(base)) return base;
  let n = 2;
  while (isTaken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
