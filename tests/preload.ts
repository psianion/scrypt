// Client tests need DOM globals — only import when test file is in tests/client/
if (typeof globalThis.window === "undefined") {
  // @ts-ignore
  await import("@happy-dom/global-registrator").then((m) =>
    m.GlobalRegistrator.register()
  );
}
