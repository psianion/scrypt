import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useGraphSnapshot } from "./useGraphSnapshot";
import { createGraph, type RenderHandle } from "./render";
import type { IngestBlock, Note, NoteIncomingEdge } from "../../shared/types";

interface Props {
  path: string;
  /** Optional pre-fetched note. When provided, skip the /api/notes/:path
   * fetch. Used by unit tests and by future callers that already have the
   * full note record in hand. */
  note?: (Note & Partial<{ backlinks: unknown[]; incoming_edges: NoteIncomingEdge[] }>) | null;
  /** When true, reveal the debug-only ingest fields (source_hash, tokens,
   * cost_usd, ingest_version) — spec §6.1.1 "never surfaced in primary UI". */
  debug?: boolean;
}

type NoteWithContext = Note & {
  backlinks: unknown[];
  incoming_edges: NoteIncomingEdge[];
};

export function NoteContextPanel({ path, note: noteProp, debug = false }: Props) {
  const { snap } = useGraphSnapshot();
  const [fetchedNote, setFetchedNote] = useState<NoteWithContext | null>(null);
  const [noteError, setNoteError] = useState<Error | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [semExpanded, setSemExpanded] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RenderHandle | null>(null);
  const navigate = useNavigate();

  // When a caller passes `note` directly, that's our source of truth; skip
  // the network. Otherwise fetch as before.
  const note: (Note & Partial<{ incoming_edges: NoteIncomingEdge[] }>) | null =
    noteProp ?? fetchedNote;

  useEffect(() => {
    if (!path || noteProp !== undefined) return;
    let cancelled = false;
    setNoteError(null);
    api.notes
      .get(path)
      .then((n) => {
        if (cancelled) return;
        setFetchedNote(n);
        setNoteError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn("[note-context] load failed:", path, e.message);
        setFetchedNote(null);
        setNoteError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadTick, noteProp]);

  const retryNote = () => setReloadTick((t) => t + 1);

  useEffect(() => {
    if (!snap || !hostRef.current || !path) return;
    const host = hostRef.current;
    try {
      handleRef.current = createGraph(host, {
        snap,
        tierFilter: { connected: true, mentions: true, semantically_related: true },
        visited: new Set(),
        onNodeClick: (id) => navigate(`/note/${id}`),
        onNodeVisited: () => {},
        enableRadial: false,
        mode: { kind: "local", centerId: path, depthLimit: 1 },
        width: 260,
        height: 260,
      });
    } catch {
      // Pixi cannot init (e.g. jsdom without WebGL) — leave host empty; rest of panel still renders.
    }
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [snap, path, navigate]);

  if (!path) return null;

  const incoming = note?.incoming_edges ?? [];
  const byTier = {
    connected: incoming.filter((e) => e.tier === "connected"),
    mentions: incoming.filter((e) => e.tier === "mentions"),
    semantically_related: incoming.filter(
      (e) => e.tier === "semantically_related",
    ),
  };

  // When the caller provides `note` directly (tests / pre-fetched data), a
  // snapshot isn't required — only fetched-mode needs both. Otherwise the
  // provenance section never renders in unit tests.
  const loading = noteProp === undefined && (!snap || !note);
  const ingest: IngestBlock | null = (note?.ingest ?? null) as IngestBlock | null;

  return (
    <aside className="note-context">
      <section className="note-context__graph">
        <h4>Local graph</h4>
        <div ref={hostRef} className="note-context__graph-host" />
        <Link
          to={`/graph?focus=${encodeURIComponent(path)}`}
          className="note-context__open-global"
          title="Open in graph"
        >
          ⤢
        </Link>
      </section>

      {ingest ? <ProvenanceSection ingest={ingest} debug={debug} /> : null}

      <section className="note-context__related">
        <h4>Related</h4>
        {noteError ? (
          <div className="note-context__empty">
            Failed to load note.{" "}
            <button type="button" className="link-btn" onClick={retryNote}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="note-context__empty">Loading…</div>
        ) : byTier.connected.length +
          byTier.mentions.length +
          byTier.semantically_related.length ===
        0 ? (
          <div className="note-context__empty">No inbound relationships yet</div>
        ) : (
          <>
            {byTier.connected.length > 0 && (
              <div className="tier-group">
                <h5>Connected</h5>
                {byTier.connected.map((e) => (
                  <div key={e.source + e.tier} className="tier-row">
                    <Link to={`/note/${e.source}`}>{e.source}</Link>
                    {e.reason && (
                      <div className="tier-row__reason">{e.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {byTier.mentions.length > 0 && (
              <div className="tier-group">
                <h5>Mentions</h5>
                {byTier.mentions.map((e) => (
                  <div key={e.source + e.tier} className="tier-row">
                    <Link to={`/note/${e.source}`}>{e.source}</Link>
                    {e.reason && (
                      <div className="tier-row__reason">{e.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {byTier.semantically_related.length > 0 && (
              <div className="tier-group">
                <h5
                  onClick={() => setSemExpanded((x) => !x)}
                  className="tier-group__toggle"
                >
                  Semantically related ({byTier.semantically_related.length}){" "}
                  {semExpanded ? "▾" : "▸"}
                </h5>
                {semExpanded &&
                  byTier.semantically_related.map((e) => (
                    <div key={e.source + e.tier} className="tier-row">
                      <Link to={`/note/${e.source}`}>{e.source}</Link>
                      {e.reason && (
                        <div className="tier-row__reason">{e.reason}</div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </section>
    </aside>
  );
}

// Field → surface mapping (§6.1.1). Always-on fields describe where the note
// came from and when it was ingested; debug-only fields are useful for
// dedup / cost reasoning but noisy in day-to-day navigation.
function ProvenanceSection({
  ingest,
  debug,
}: {
  ingest: IngestBlock;
  debug: boolean;
}) {
  const rows: Array<[string, string | number | null | undefined]> = [
    ["Original filename", ingest.original_filename],
    ["Original path", ingest.original_path],
    ["Ingested at", ingest.ingested_at],
    ["Source mtime", ingest.source_mtime],
    ["Model", ingest.model],
  ];
  if (debug) {
    rows.push(
      ["Source hash", ingest.source_hash],
      ["Source size", ingest.source_size],
      ["Tokens", ingest.tokens],
      ["Cost (USD)", ingest.cost_usd],
      ["Ingest version", ingest.ingest_version],
    );
  }
  return (
    <section className="note-context__provenance" data-testid="provenance">
      <h4>Provenance</h4>
      <dl className="provenance-grid">
        {rows.map(([label, value]) =>
          value == null || value === "" ? null : (
            <div key={label} className="provenance-row">
              <dt>{label}</dt>
              <dd>{String(value)}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
