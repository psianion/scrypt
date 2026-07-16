// src/server/auth.ts
interface AuthState {
  isProduction: boolean;
  authToken: string | undefined;
}

interface AuthResult {
  ok: boolean;
  reason?: "missing_token" | "wrong_token" | "no_token_configured";
}

/** Minimal shape of Bun's Server we need — just enough to ask for the real
 * TCP peer address of a request. Kept as an interface (not `import type
 * {Server} from "bun"`) so unit tests can pass a plain stub. */
export interface PeerAddressProvider {
  requestIP(req: Request): { address: string } | null;
}

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True when the request's ACTUAL socket peer (not the client-supplied Host
 * header, which any remote caller can spoof with `Host: localhost`) is a
 * loopback address. Uses Bun's `server.requestIP()`, which reads the real
 * TCP connection — safe even when the process binds all interfaces (the
 * native profile does this regardless of SCRYPT_BIND_ADDR; see doctor.ts).
 * Shared by the /api/* + /ws gate (checkAuth) and the /mcp auth path so both
 * apply the same loopback-or-token rule. (F5 hardening)
 */
export function isLoopbackPeer(
  server: PeerAddressProvider | null | undefined,
  req: Request,
): boolean {
  const address = server?.requestIP(req)?.address;
  if (!address) return false; // no real peer info -> fail closed, not open
  return LOOPBACK_IPS.has(address) || address.startsWith("127.");
}

export function checkAuth(
  req: Request,
  server: PeerAddressProvider | null | undefined,
  state: AuthState,
): AuthResult {
  const url = new URL(req.url);

  // /ws carries live vault content (note paths, embedding progress) over the
  // wire and must be gated exactly like /api/*. Everything else that isn't
  // /api/ or /ws is the built static SPA shell (HTML/JS/CSS) — safe to leave
  // public since it can only ever serve files under staticDir (path-
  // traversal containment lives in index.ts's static handler), never vault
  // content, the DB, or .env.
  const needsAuth = url.pathname.startsWith("/api/") || url.pathname === "/ws";
  if (!needsAuth) {
    return { ok: true };
  }

  // Loopback bypass: the browser client has no mechanism to attach a bearer
  // token, so requests whose real socket peer is this machine are allowed
  // through — in production too. This is now keyed on the TCP peer address,
  // not the spoofable Host header, so a remote caller can no longer talk
  // their way past it with `Host: localhost`.
  if (isLoopbackPeer(server, req)) {
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
