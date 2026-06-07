// === Keep test scratch OUT of the repo root ===
// ~50 test files create temp dirs via `mkdtemp(join(tmpdir(), "<prefix>-"))`.
// In environments where TMPDIR is relative or points into the repo, that dumps
// scratch dirs straight into the repo root (we once found 465). Force an
// absolute base outside the repo, nest every test temp dir under one run-root,
// and delete that run-root when the whole suite finishes — so a normal
// `bun test` leaves nothing behind.
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { afterAll } from "bun:test";
import { safeTempBase } from "./safe-tmpdir";

const repoRoot = resolve(import.meta.dir, "..");
let tmpBase = safeTempBase(tmpdir(), repoRoot);
if (!existsSync(tmpBase)) tmpBase = tmpdir(); // extreme fallback; /tmp always exists on macOS+Linux
const testRunRoot = mkdtempSync(join(tmpBase, "scrypt-testrun-"));
process.env.TMPDIR = testRunRoot;
process.env.TMP = testRunRoot;
process.env.TEMP = testRunRoot;
afterAll(() => {
  try {
    rmSync(testRunRoot, { recursive: true, force: true });
  } catch {
    // best-effort: an interrupted run may leave it, but it's under the system
    // temp dir (outside the repo), so the OS reaps it.
  }
});

// Register happy-dom so tests/client/ files get document/window/HTMLElement,
// but preserve Bun's native fetch/Request/Response/Headers so tests/server/
// integration tests can still talk to Bun.serve. happy-dom's network types
// are subtly incompatible with Bun.serve's HTTP framing and will break any
// test that calls fetch() against a real server.
//
// @testing-library/react auto-registers an afterEach(cleanup) at import time,
// which Bun's test runner rejects outside a live test context. Opt out here —
// client test files call afterEach(cleanup) explicitly.
process.env.RTL_SKIP_AUTO_CLEANUP = "true";

const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;
const nativeFormData = globalThis.FormData;
const nativeBlob = globalThis.Blob;
const nativeFile = globalThis.File;

// @ts-ignore
await import("@happy-dom/global-registrator").then((m) =>
  m.GlobalRegistrator.register(),
);

// @ts-ignore
globalThis.fetch = nativeFetch;
// @ts-ignore
globalThis.Request = nativeRequest;
// @ts-ignore
globalThis.Response = nativeResponse;
// @ts-ignore
globalThis.Headers = nativeHeaders;
// @ts-ignore
globalThis.FormData = nativeFormData;
// @ts-ignore
globalThis.Blob = nativeBlob;
// @ts-ignore
globalThis.File = nativeFile;

// Expose native fetch so client test files can restore it after installing
// their own mocks, and run a global afterEach that unconditionally restores
// it. That way any client test that forgets to clean up doesn't leak its
// mock into a subsequent file — server integration tests always start each
// test with Bun's real fetch.
// @ts-ignore
globalThis.__nativeFetch = nativeFetch;

import { afterEach } from "bun:test";
afterEach(() => {
  // @ts-ignore
  globalThis.fetch = nativeFetch;
});
