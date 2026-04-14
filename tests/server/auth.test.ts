import { describe, test, expect } from "bun:test";
import { checkAuth } from "../../src/server/auth";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("checkAuth", () => {
  test("allows dev localhost without token when no token configured", () => {
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: false, authToken: undefined },
    );
    expect(result.ok).toBe(true);
  });

  test("allows dev localhost even when token is configured", () => {
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects non-localhost in dev when token configured and header missing", () => {
    const result = checkAuth(
      req("http://192.168.1.10:3777/api/notes"),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("allows non-localhost in dev with correct Bearer token", () => {
    const result = checkAuth(
      req("http://192.168.1.10:3777/api/notes", {
        authorization: "Bearer secret",
      }),
      { isProduction: false, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("rejects wrong token", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", {
        authorization: "Bearer wrong",
      }),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(false);
  });

  test("accepts production localhost without token (browser client bypass)", () => {
    // The SPA running in a browser on the same machine has no way to
    // attach a bearer header, so localhost is always allowed through.
    // Remote hosts with their own Host header still need the token.
    const result = checkAuth(
      req("http://127.0.0.1:3777/api/notes"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("accepts case-insensitive authorization header", () => {
    const result = checkAuth(
      req("http://example.com/api/notes", { Authorization: "Bearer secret" }),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("static paths bypass auth", () => {
    const result = checkAuth(
      req("http://example.com/assets/index.js"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });

  test("root path bypasses auth (SPA shell)", () => {
    const result = checkAuth(
      req("http://example.com/"),
      { isProduction: true, authToken: "secret" },
    );
    expect(result.ok).toBe(true);
  });
});
