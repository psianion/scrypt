import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useGraphSnapshot } from "./useGraphSnapshot";
import { createGraph, type RenderHandle } from "./render";
import type { Note, NoteIncomingEdge } from "../../shared/types";

interface Props {
  path: string;
}

type NoteWithContext = Note & {
  backlinks: unknown[];
  incoming_edges: NoteIncomingEdge[];
};

export function NoteContextPanel({ path }: Props) {
  const { snap } = useGraphSnapshot();
  const [note, setNote] = useState<NoteWithContext | null>(null);
  const [noteError, setNoteError] = useState<Error | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [semExpanded, setSemExpanded] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RenderHandle | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setNoteError(null);
    api.notes
      .get(path)
      .then((n) => {
        if (cancelled) return;
        setNote(n);
        setNoteError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn("[note-context] load failed:", path, e.message);
        setNote(null);
        setNoteError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadTick]);

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
        depthLimit: 1,
        centerId: path,
        width: 260,
        height: 260,
      });
    } catch {
      // Pixi cannot init (e.g. jsdom/happy-dom without WebGL/Canvas) — leave
      // the host empty. The rest of the panel (tags, related) still renders.
    }
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [snap, path, navigate]);

  if (!path) return null;

  const incoming = note?.incoming_edges ?? [];
  const byTier = {
    connected: incoming.filter((e) => e.confidence === "connected"),
    mentions: incoming.filter((e) => e.confidence === "mentions"),
    semantically_related: incoming.filter(
      (e) => e.confidence === "semantically_related",
    ),
  };

  const tags = note?.tags ?? [];
  const loading = !snap || !note;

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

      <section className="note-context__tags">
        <h4>Tags</h4>
        {tags.length === 0 ? (
          <div className="note-context__empty">None</div>
        ) : (
          <div className="note-context__tag-row">
            {tags.map((t) => (
              <Link
                key={t}
                to={`/tags?tag=${encodeURIComponent(t)}`}
                className="tag-chip"
              >
                #{t}
              </Link>
            ))}
          </div>
        )}
      </section>

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
                  <div key={e.source + e.relation} className="tier-row">
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
                  <div key={e.source + e.relation} className="tier-row">
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
                    <div key={e.source + e.relation} className="tier-row">
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
