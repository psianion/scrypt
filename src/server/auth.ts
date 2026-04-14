// src/server/auth.ts
export interface AuthState {
  isProduction: boolean;
  authToken: string | undefined;
}

export interface AuthResult {
  ok: boolean;
  reason?: "missing_token" | "wrong_token" | "no_token_configured";
}

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function checkAuth(req: Request, state: AuthState): AuthResult {
  const url = new URL(req.url);

  if (!url.pathname.startsWith("/api/")) {
    return { ok: true };
  }

  // Localhost bypass: the browser client has no mechanism to attach a
  // bearer token, so requests originating from the same machine (Host:
  // localhost / 127.0.0.1 / ::1) are always allowed through — in
  // production too. Remote callers still need the token because their
  // Host header is the tailnet / public hostname, not a loopback alias.
  const isLocalhost = LOCALHOST_HOSTS.has(url.hostname);
  if (isLocalhost) {
    return { ok: true };
  }

  if (!state.authToken) {
    return { ok: false, reason: "no_token_configured" };
  }

  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_token" };
  }
  const provided = header.slice("Bearer ".length).trim();
  if (provided !== state.authToken) {
    return { ok: false, reason: "wrong_token" };
  }
  return { ok: true };
}

export function unauthorizedResponse(): Response {
  return new Response("", { status: 401 });
}
