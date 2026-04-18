// src/client/api.ts
import type { Note, NoteMeta, NoteIncomingEdge, SearchResult, Task, LocalGraphNode, LocalGraphEdge, WsMessage } from "../shared/types";
import { useEmbeddingProgress } from "./stores/embeddingProgress";
import type { GraphResponse } from "../shared/graph-types";

const BASE = "";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Notes
export const api = {
  notes: {
    list: (params?: { tag?: string; folder?: string; sort?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return json<NoteMeta[]>(`/api/notes${qs ? `?${qs}` : ""}`);
    },
    get: (path: string) =>
      json<Note & { backlinks: any[]; incoming_edges: NoteIncomingEdge[] }>(
        `/api/notes/${path}`,
      ),
    create: (data: { path: string; content: string; tags?: string[] }) =>
      json<{ path: string }>("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    update: (path: string, data: { content?: string; frontmatter?: Record<string, unknown> }) =>
      json<{ path: string }>(`/api/notes/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    delete: (path: string) =>
      json<{ deleted: string }>(`/api/notes/${path}`, { method: "DELETE" }),
  },

  search: (q: string) => json<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  searchTags: (q: string) => json<{ tag: string; count: number }[]>(`/api/search/tags?q=${encodeURIComponent(q)}`),
  searchGraph: (q: string) =>
    json<{ paths: string[] }>(`/api/search/graph?q=${encodeURIComponent(q)}`),

  graph: {
    full: () => json<GraphResponse>("/api/graph"),
    local: (path: string, depth = 2) =>
      json<{ nodes: LocalGraphNode[]; edges: LocalGraphEdge[] }>(`/api/graph/${path}?depth=${depth}`),
  },

  backlinks: (path: string) => json<any[]>(`/api/backlinks/${path}`),

  journal: {
    today: () => json<Note>("/api/journal/today"),
    get: (date: string) => json<Note>(`/api/journal/${date}`),
  },

  templates: {
    list: () => json<{ name: string; path: string }[]>("/api/templates"),
    apply: (data: { template: string; path: string; variables?: Record<string, string> }) =>
      json<{ path: string }>("/api/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  },

  tasks: {
    list(params?: {
      status?: "open" | "in_progress" | "closed" | "all";
      type?: string;
      note_path?: string;
      limit?: number;
      offset?: number;
    }) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params ?? {})) {
        if (v !== undefined) qs.set(k, String(v));
      }
      return json<{ tasks: Task[]; total: number }>(
        `/api/tasks/list${qs.toString() ? `?${qs}` : ""}`,
      );
    },
  },

  data: {
    list: () => json<{ file: string }[]>("/api/data"),
    get: (file: string) => json<Record<string, unknown>[]>(`/api/data/${file}`),
    schema: (file: string) => json<{ headers: string[]; types: string[]; rowCount: number }>(`/api/data/${file}/schema`),
  },
};

// WebSocket — multiplexes the legacy note-change stream with the Wave 8
// `vault:embedding` channel. Re-creates itself on close so the embedding
// progress bridge stays attached across reconnects.
export function connectWebSocket(onMessage: (msg: WsMessage) => void): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const frame = parsed as { channel?: string; type?: string };
    if (
      frame?.channel === "vault:embedding" &&
      frame?.type === "embedding_progress"
    ) {
      useEmbeddingProgress.getState().onEvent(frame as Parameters<
        ReturnType<typeof useEmbeddingProgress.getState>["onEvent"]
      >[0]);
      return;
    }
    onMessage(parsed as WsMessage);
  };

  ws.onclose = () => {
    setTimeout(() => connectWebSocket(onMessage), 2000);
  };

  return ws;
}
