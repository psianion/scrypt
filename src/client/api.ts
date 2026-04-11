// src/client/api.ts
import type { Note, NoteMeta, SearchResult, Task, GraphNode, GraphEdge, WsMessage } from "../shared/types";

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
    get: (path: string) => json<Note & { backlinks: any[] }>(`/api/notes/${path}`),
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

  graph: {
    full: () => json<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/api/graph"),
    local: (path: string, depth = 2) =>
      json<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/graph/${path}?depth=${depth}`),
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
    list: (params?: { board?: string; done?: string; tag?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return json<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
    },
    update: (id: number, data: Partial<Pick<Task, "done" | "board" | "priority">>) =>
      json<void>(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  },

  data: {
    list: () => json<{ file: string }[]>("/api/data"),
    get: (file: string) => json<Record<string, unknown>[]>(`/api/data/${file}`),
    schema: (file: string) => json<{ headers: string[]; types: string[]; rowCount: number }>(`/api/data/${file}/schema`),
  },
};

// WebSocket
export function connectWebSocket(onMessage: (msg: WsMessage) => void): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data) as WsMessage;
    onMessage(msg);
  };

  ws.onclose = () => {
    // Reconnect after 2 seconds
    setTimeout(() => connectWebSocket(onMessage), 2000);
  };

  return ws;
}
