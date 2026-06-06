import { diff3Merge } from "node-diff3";

export type MergeRegion =
  | { type: "clean"; text: string }
  | { type: "conflict"; local: string; remote: string; base?: string };

/**
 * Line-based 3-way merge. `local` = your copy, `remote` = the hub copy,
 * `base` = the last-synced common ancestor (null when we never stored it).
 * Clean (auto-mergeable) stretches come back as `clean`; true conflicts as `conflict`.
 */
export function threeWayMerge(base: string | null, local: string, remote: string): MergeRegion[] {
  if (base === null) return [{ type: "conflict", local, remote }];
  const a = local.split("\n");
  const o = base.split("\n");
  const b = remote.split("\n");
  const regions = diff3Merge(a, o, b);
  return regions.map((r): MergeRegion => {
    if (r.ok) return { type: "clean", text: r.ok.join("\n") };
    const c = r.conflict!;
    return {
      type: "conflict",
      local: c.a.join("\n"),
      remote: c.b.join("\n"),
      base: c.o.join("\n"),
    };
  });
}
