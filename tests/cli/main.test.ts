import { describe, test, expect } from "bun:test";
import { commands, usage } from "../../src/cli/commands";
import { main } from "../../src/cli/main";

describe("registry + main dispatch", () => {
  test("registers the documented commands", () => {
    for (const c of ["init", "up", "down", "doctor", "mcp", "token", "sync", "reindex", "maintenance"]) {
      expect(commands[c]).toBeDefined();
      expect(typeof commands[c].run).toBe("function");
    }
  });

  test("usage lists every command", () => {
    const u = usage();
    for (const c of Object.keys(commands)) expect(u).toContain(c);
  });

  test("explicit help exits 0", async () => {
    expect(await main(["help"])).toBe(0);
  });

  test("bare invocation is a usage error (exit 2)", async () => {
    expect(await main([])).toBe(2);
  });

  test("unknown command exits 2", async () => {
    expect(await main(["frobnicate"])).toBe(2);
  });

  test("--version exits 0", async () => {
    expect(await main(["--version"])).toBe(0);
  });
});
