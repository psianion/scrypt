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
}
