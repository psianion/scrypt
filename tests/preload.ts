// Client tests need DOM globals — only import when test file is in tests/client/
const testFile = Bun.main;
if (testFile.includes("tests/client/") && typeof globalThis.window === "undefined") {
  // @testing-library/react auto-registers an afterEach(cleanup) at import time,
  // which Bun's test runner rejects when the import happens outside a live test
  // context. Opt out — tests handle cleanup explicitly with afterEach(cleanup).
  process.env.RTL_SKIP_AUTO_CLEANUP = "true";

  // @ts-ignore
  await import("@happy-dom/global-registrator").then((m) =>
    m.GlobalRegistrator.register()
  );
}
