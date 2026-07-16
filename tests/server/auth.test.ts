import { describe, test, expect } from "bun:test";
import { checkAuth, isLoopbackPeer } from "../../src/server/auth";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

/** Stub for Bun's Server — only requestIP() is needed by checkAuth. */
function fakeServer(address: string | null) {
  return {
    requestIP: () => (address ? { address } : null),
  };
}

const LOOPBACK = fakeServer("127.0.0.1");
const REMOTE = fakeServer("203.0.113.5");
const NO_PEER_INFO = fakeServer(null);

describe("checkAuth", () => {
  test("allows dev loopback peer without token when no token configured", () => {
    const result = checkAuth(req("http://127.0.0.1:3777/api/notes"), LOOPBACK, {
      isProduction: false,
      authToken: undefined,
    });
    expect(result.ok).toBe(true);
  });

  test("allows dev loopback peer even when token is configured", () => {
    const result = checkAuth(req("http://127.0.0.1:3777/api/notes"), LOOPBACK, {
      isProduction: false,
      authToken: "secret",
    });
    expect(result.ok).toBe(true);
  });

  test("rejects non-loopback peer in dev when token configured and header missing", () => {
    const result = checkAuth(req("http://192.168.1.10:3777/api/notes"), REMOTE, {
      isProduction: false,
      authToken: "secret",
    });
    expect(result.ok).toBe(false);
  });

  test("allows non-loopback peer in dev with correct Bearer token", () => {
    const result = checkAuth(
      req("http://192.168.1.10:3777/api/notes", { authorization: "Bearer secret" }),
      REMOTE,
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects wrong token", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", { authorization: "Bearer wrong" }),
      REMOTE,
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("accepts production loopback peer without token (browser client bypass)", () => {
    // The SPA running in a browser on the same machine has no way to
    // attach a bearer header, so a genuine loopback peer is always allowed
    // through. Remote peers still need the token.
    const result = checkAuth(req("http://127.0.0.1:3777/api/notes"), LOOPBACK, {
      isProduction: true,
      authToken: "secret",
    });
    expect(result.ok).toBe(true);
  });

  test("accepts case-insensitive authorization header", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", { Authorization: "Bearer secret" }),
      REMOTE,
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("static paths bypass auth even for a remote peer", () => {
    const result = checkAuth(req("http://example.com/assets/index.js"), REMOTE, {
      isProduction: true,
      authToken: "secret",
    });
    expect(result.ok).toBe(true);
  });

  test("root path bypasses auth (SPA shell)", () => {
    const result = checkAuth(req("http://example.com/"), REMOTE, {
      isProduction: true,
      authToken: "secret",
    });
    expect(result.ok).toBe(true);
  });

  test("/ws requires the same auth as /api/* — remote peer without token is rejected", () => {
    const result = checkAuth(req("http://example.com/ws"), REMOTE, {
      isProduction: true,
      authToken: "secret",
    });
    expect(result.ok).toBe(false);
  });

  test("/ws allows a genuine loopback peer without a token", () => {
    const result = checkAuth(req("http://127.0.0.1:3777/ws"), LOOPBACK, {
      isProduction: true,
      authToken: "secret",
    });
    expect(result.ok).toBe(true);
  });

  test("/ws allows a remote peer with the correct token", () => {
    const result = checkAuth(
      req("http://example.com/ws", { authorization: "Bearer secret" }),
      REMOTE,
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  // Regression: previously checkAuth trusted `new URL(req.url).hostname`,
  // which Bun derives from the client-supplied Host header — a remote caller
  // could bypass the token entirely by sending `Host: localhost`. Loopback
  // trust must now be keyed on the real socket peer (server.requestIP), so a
  // spoofed Host header on a non-loopback connection is rejected.
  test("Host-header spoof does NOT bypass auth for a real remote peer", () => {
    const result = checkAuth(
      req("http://localhost:3777/api/notes"), // spoofed Host looks like loopback
      REMOTE, // but the actual TCP peer is remote
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("fails closed when peer address is unavailable (no server / no requestIP)", () => {
    const result = checkAuth(req("http://127.0.0.1:3777/api/notes"), NO_PEER_INFO, {
      isProduction: false,
      authToken: "secret",
    });
    expect(result.ok).toBe(false);
  });

  test("fails closed with no server argument at all", () => {
    const result = checkAuth(req("http://127.0.0.1:3777/api/notes"), undefined, {
      isProduction: false,
      authToken: "secret",
    });
    expect(result.ok).toBe(false);
  });
});

describe("isLoopbackPeer", () => {
  test("true for 127.0.0.1", () => {
    expect(isLoopbackPeer(LOOPBACK, req("http://x/"))).toBe(true);
  });

  test("true for ::1", () => {
    expect(isLoopbackPeer(fakeServer("::1"), req("http://x/"))).toBe(true);
  });

  test("false for a remote address", () => {
    expect(isLoopbackPeer(REMOTE, req("http://x/"))).toBe(false);
  });

  test("false when there is no server", () => {
    expect(isLoopbackPeer(undefined, req("http://x/"))).toBe(false);
  });
});
