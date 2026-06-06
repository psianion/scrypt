// src/server/sync/hub-client.ts
//
// HTTP client to a scrypt server (the remote hub, or the local server for
// applying pulled notes). All errors surface loudly — no silent fallbacks.

export class SyncHttpError extends Error {
  constructor(
    public op: string,
    public status: number,
    public url: string,
  ) {
    super(
      status === 401
        ? `Unauthorized calling ${op} at ${url} — check SCRYPT_AUTH_TOKEN.`
        : `Error calling ${op} at ${url} (HTTP ${status}).`,
    );
    this.name = "SyncHttpError";
  }
}

// Cap on note bytes accepted over the pull path, mirroring the read endpoint's
// guard in api/sync.ts. Keeps a single accidentally-huge note (renamed binary,
// pasted blob) from OOMing a small VPS container during sync. (F13)
const MAX_NOTE_BYTES = 25 * 1024 * 1024; // 25 MiB

export class HubClient {
  private baseUrl: string;
  constructor(baseUrl: string, private token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["content-type"] = "application/json";
    if (this.token) h["authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /** Low-level GET that maps failures to clear errors. Exposed for tests. */
  async get(path: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    } catch (err) {
      throw new Error(
        `online vault unreachable at ${this.baseUrl} — is Tailscale up and the container running? (${String(err)})`,
      );
    }
    if (!res.ok) throw new SyncHttpError(path, res.status, this.baseUrl);
    return res;
  }

  async getManifest(): Promise<Map<string, string>> {
    const res = await this.get("/api/sync/manifest");
    const body = (await res.json()) as {
      notes?: { path: string; content_hash: string }[];
    };
    if (!Array.isArray(body.notes)) {
      throw new Error(`Unexpected manifest shape from ${this.baseUrl}/api/sync/manifest`);
    }
    return new Map(body.notes.map((n) => [n.path, n.content_hash]));
  }

  async getNoteContent(notePath: string): Promise<string> {
    const res = await this.get(
      `/api/sync/note?path=${encodeURIComponent(notePath)}`,
    );
    // Reject an oversized note before buffering it into memory. The hub's read
    // endpoint already 413s on file.size, but a non-scrypt upstream might not,
    // so guard here too via Content-Length. (F13)
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_NOTE_BYTES) {
      throw new Error(
        `note ${notePath} is ${len} bytes, over the ${MAX_NOTE_BYTES}-byte sync cap`,
      );
    }
    return res.text();
  }

  async createNote(
    notePath: string,
    content: string,
    clientTag: string,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/mcp`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "create_note",
            arguments: {
              path: notePath,
              content,
              client_tag: clientTag,
              allow_nonstandard_path: true,
            },
          },
        }),
      });
    } catch (err) {
      throw new Error(
        `vault unreachable at ${this.baseUrl} — is it running? (${String(err)})`,
      );
    }
    if (!res.ok) throw new SyncHttpError("create_note", res.status, this.baseUrl);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text: string }[] };
      error?: { message: string };
    };
    if (body.error) throw new Error(`create_note failed: ${body.error.message}`);
    if (body.result?.isError) {
      throw new Error(
        `create_note tool error for ${notePath}: ${body.result.content?.[0]?.text ?? "unknown"}`,
      );
    }
  }

  async rescanSimilarity(clientTag: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/mcp`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "rescan_similarity",
            arguments: { client_tag: clientTag },
          },
        }),
      });
    } catch (err) {
      throw new Error(`vault unreachable at ${this.baseUrl} — is it running? (${String(err)})`);
    }
    if (!res.ok) throw new SyncHttpError("rescan_similarity", res.status, this.baseUrl);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text: string }[] };
      error?: { message: string };
    };
    if (body.error) throw new Error(`rescan_similarity failed: ${body.error.message}`);
    if (body.result?.isError) {
      throw new Error(`rescan_similarity tool error: ${body.result.content?.[0]?.text ?? "unknown"}`);
    }
  }
}
