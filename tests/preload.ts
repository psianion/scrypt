// Client tests need DOM globals — only import when test file is in tests/client/
const testFile = Bun.main;
if (testFile.includes("tests/client/") && typeof globalThis.window === "undefined") {
  // @ts-ignore
  await import("@happy-dom/global-registrator").then((m) =>
    m.GlobalRegistrator.register()
  );
}
