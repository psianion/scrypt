// Seed a synthetic lineage-rich vault via the running container's MCP HTTP
// endpoint (POST /mcp). Raw file drops don't populate notes.project /
// note_metadata.doc_type (only create_note / update_note_metadata do — see
// src/server/mcp/tools/create-note.ts + update-note-metadata.ts), so this
// script drives the same tool calls an AI client would make instead of
// writing .md files directly.
//
// Usage: bun scripts/seed-graph.ts
//
// Builds, per project, a DAG of doc_type layers:
//   research -> research (supersedes) x4 -> spec (derives-from) -> spec
//   (supersedes) x2 -> plan (implements)                     [depth 0..8]
// plus a handful of rootless texture notes (architecture/review/guide/
// journal/other) for doc_type variety. Lineage shapes come straight from
// src/server/vocab/lineage-reasons.ts:
//   derives-from: source doc_type=spec,  target doc_type=research
//   implements:   source doc_type=plan,  target doc_type in {spec, architecture}
//   supersedes:   source/target share the same doc_type
// (plan<->plan edges are always dropped by the snapshot, so the plan layer
// is a lineage dead end — that's expected.)

const BASE = process.env.SCRYPT_BASE_URL ?? "http://localhost:3777";
const TOKEN = process.env.SCRYPT_AUTH_TOKEN ?? "";

const PROJECTS = [
  "atlas",
  "nimbus",
  "forge",
  "lumen",
  "vertex",
  "cipher",
  "harbor",
  "quartz",
];

const TOPICS = [
  "auth flow", "cache layer", "billing engine", "search index", "onboarding",
  "rate limiter", "event bus", "notification service", "data pipeline",
  "permissions model", "mobile sync", "audit log", "retry policy",
  "config service", "session store", "webhook delivery", "queue worker",
  "feature flags", "schema migration", "backup strategy",
];

interface PlannedNote {
  path: string;
  project: string;
  doc_type: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  parents: { path: string; reason: string }[];
}

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// Weighted sample without replacement — first ~15% of `pool` are "hubs"
// (weight 5) so out-degree (children pointing back) varies a lot, giving
// node-size variance in the rendered graph.
function pickParents(pool: PlannedNote[], count: number): PlannedNote[] {
  if (pool.length === 0) return [];
  const hubCut = Math.max(1, Math.floor(pool.length * 0.15));
  const weighted: PlannedNote[] = [];
  pool.forEach((n, i) => {
    const w = i < hubCut ? 5 : 1;
    for (let k = 0; k < w; k++) weighted.push(n);
  });
  const picked = new Set<PlannedNote>();
  let guard = 0;
  while (picked.size < Math.min(count, pool.length) && guard < 50) {
    picked.add(rand(weighted));
    guard++;
  }
  return [...picked];
}

function mkNote(
  project: string,
  docType: string,
  slug: string,
  layerLabel: string,
  parents: { path: string; reason: string }[],
): PlannedNote {
  const topic = rand(TOPICS);
  const title = `${project} ${layerLabel}: ${topic}`;
  const path = `projects/${project}/${docType}/${slug}.md`;
  const summary = `${layerLabel} note on the ${topic} for ${project}.`;
  const body =
    `This ${docType} note covers the ${topic} within the ${project} project. ` +
    `It exists as synthetic lineage-seed data generated for graph testing, ` +
    `${parents.length > 0 ? `building on ${parents.length} prior note(s).` : "as a root of its lineage chain."}`;
  return { path, project, doc_type: docType, slug, title, summary, body, parents };
}

function frontmatter(n: PlannedNote): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  return `---
title: "${esc(n.title)}"
project: ${n.project}
doc_type: ${n.doc_type}
slug: ${n.slug}
tags: []
---

${n.body}
`;
}

// --- planning: build the per-project layered DAG -----------------------

function planProject(project: string): PlannedNote[] {
  const notes: PlannedNote[] = [];
  let seq = 0;
  const next = (docType: string, layerLabel: string) => {
    const slug = `${docType}-${String(++seq).padStart(3, "0")}`;
    return { slug, layerLabel };
  };

  const layerCounts: [string, number, string][] = [
    ["research", 16, "L0 research root"],
    ["research", 13, "L1 research"],
    ["research", 10, "L2 research"],
    ["research", 8, "L3 research"],
    ["research", 6, "L4 research"],
    ["spec", 12, "L5 spec"],
    ["spec", 9, "L6 spec"],
    ["spec", 7, "L7 spec"],
    ["spec", 5, "L8 spec"],
    ["plan", 9, "L9 plan"],
  ];

  let prevLayer: PlannedNote[] = [];
  layerCounts.forEach(([docType, count, label], layerIdx) => {
    const layer: PlannedNote[] = [];
    for (let i = 0; i < count; i++) {
      const { slug, layerLabel } = next(docType, label);
      let parents: { path: string; reason: string }[] = [];
      if (layerIdx > 0) {
        const reason =
          docType === "plan"
            ? "implements"
            : layerCounts[layerIdx - 1]![0] !== docType
              ? "derives-from"
              : "supersedes";
        const numParents = 1 + Math.floor(Math.random() * 3); // 1-3
        parents = pickParents(prevLayer, numParents).map((p) => ({
          path: p.path,
          reason,
        }));
      }
      const note = mkNote(project, docType, slug, layerLabel, parents);
      layer.push(note);
      notes.push(note);
    }
    prevLayer = layer;
  });

  // Texture roots: doc_type variety beyond the lineage chain, no parents.
  const textureTypes = ["architecture", "review", "guide", "journal", "other"];
  const textureCount = 125 - notes.length;
  for (let i = 0; i < textureCount; i++) {
    const docType = textureTypes[i % textureTypes.length]!;
    const { slug, layerLabel } = next(docType, `texture ${docType}`);
    notes.push(mkNote(project, docType, slug, layerLabel, []));
  }

  return notes;
}

// --- HTTP plumbing --------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mcpCallOnce(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = (await res.json()) as {
    result?: { isError?: boolean; content?: { type: string; text: string }[] };
    error?: unknown;
  };
  if (json.error) throw new Error(`rpc error: ${JSON.stringify(json.error)}`);
  const text = json.result?.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (json.result?.isError) throw new Error(`tool error: ${JSON.stringify(parsed)}`);
  return parsed;
}

// SQLite is single-writer; the embed worker + snapshot/index schedulers are
// concurrent writers, so even serial MCP calls hit transient "database is
// locked". Retry with backoff — the lazy correct fix for SQLITE_BUSY.
async function mcpCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await mcpCallOnce(name, args);
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const transient =
        msg.includes("database is locked") ||
        msg.includes("socket connection was closed") ||
        msg.includes("fetch failed") ||
        msg.includes("Unable to connect");
      if (!transient) throw err;
      await sleep(100 + attempt * 250 + Math.random() * 200);
    }
  }
  throw lastErr;
}

// Simple fixed-size async worker pool.
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  let ok = 0;
  let fail = 0;
  const failures: string[] = [];
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx]!);
        ok++;
      } catch (err) {
        fail++;
        if (failures.length < 10) failures.push(String(err));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, fail, failures };
}

async function main() {
  const allNotes = PROJECTS.flatMap(planProject);
  console.log(`planned ${allNotes.length} notes across ${PROJECTS.length} projects`);

  // Phase 1: create_note + update_note_metadata for every note.
  let created = 0;
  const t0 = Date.now();
  const createResult = await pool(allNotes, 2, async (n) => {
    await mcpCall("create_note", {
      path: n.path,
      content: frontmatter(n),
      client_tag: n.path,
    });
    await mcpCall("update_note_metadata", {
      path: n.path,
      doc_type: n.doc_type,
      summary: n.summary,
      client_tag: `meta:${n.path}`,
    });
    created++;
    if (created % 100 === 0) {
      console.log(`  created ${created}/${allNotes.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  });
  console.log(`notes: ok=${createResult.ok} fail=${createResult.fail}`);
  if (createResult.failures.length) console.log("sample failures:", createResult.failures.slice(0, 5));

  // Phase 2: add_edge for every planned parent link (now that all endpoints
  // exist and carry note_metadata.doc_type, which checkLineageShape needs).
  const edgeJobs = allNotes.flatMap((n) =>
    n.parents.map((p) => ({ source: n.path, target: p.path, reason: p.reason })),
  );
  console.log(`planned ${edgeJobs.length} lineage edges`);
  let edged = 0;
  const edgeResult = await pool(edgeJobs, 2, async (e) => {
    await mcpCall("add_edge", {
      source: e.source,
      target: e.target,
      tier: "connected",
      reason: e.reason,
      client_tag: `edge:${e.source}->${e.target}:${e.reason}`,
    });
    edged++;
    if (edged % 200 === 0) console.log(`  edges ${edged}/${edgeJobs.length}`);
  });
  console.log(`edges: ok=${edgeResult.ok} fail=${edgeResult.fail}`);
  if (edgeResult.failures.length) console.log("sample failures:", edgeResult.failures.slice(0, 5));

  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
