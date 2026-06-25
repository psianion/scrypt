import { describe, test, expect } from "bun:test";
import { buildMcpAddArgs, mcpUrlFromPort, MCP_PROBE_BODY, runMcpInstall } from "../../src/cli/mcp-install";
import { makeFakeCtx } from "../../src/cli/ctx";

const TOKEN = "0123456789abcdef".repeat(4);

describe("buildMcpAddArgs", () => {
  test("includes the bearer header as a discrete argv element when token present", () => {
    const args = buildMcpAddArgs({ name: "scrypt", url: "http://localhost:3777/mcp", scope: "user", token: TOKEN });
    expect(args).toEqual([
      "mcp", "add", "--transport", "http", "scrypt", "http://localhost:3777/mcp", "--scope", "user",
      "--header", `Authorization: Bearer ${TOKEN}`,
    ]);
  });

  test("omits the header when no token", () => {
    const args = buildMcpAddArgs({ name: "scrypt", url: "u", scope: "user" });
    expect(args).not.toContain("--header");
  });

  test("derives url from port (not hardcoded 3777)", () => {
    expect(mcpUrlFromPort(9000)).toBe("http://localhost:9000/mcp");
  });

  test("probe body is the exact jsonrpc tools/list payload", () => {
    expect(JSON.parse(MCP_PROBE_BODY)).toEqual({ jsonrpc: "2.0", id: 0, method: "tools/list" });
  });
});

describe("runMcpInstall", () => {
  test("probe 200 -> remove then add with correct argv; derives port from .env", async () => {
    const ctx = makeFakeCtx({
      files: { "/work/.env": `SCRYPT_AUTH_TOKEN=${TOKEN}\nSCRYPT_PORT=9001\n` },
      httpResponder: () => ({ status: 200, body: '{"jsonrpc":"2.0"}' }),
    });
    const r = await runMcpInstall(ctx, { envPath: "/work/.env" });
    expect(r.ok).toBe(true);
    // probed the derived port
    expect(ctx.recorded.http[0].url).toBe("http://localhost:9001/mcp");
    const calls = ctx.recorded.shell.map((s) => s.args.join(" "));
    expect(calls.some((c) => c.startsWith("mcp remove scrypt"))).toBe(true);
    expect(calls.some((c) => c.startsWith("mcp add --transport http scrypt"))).toBe(true);
  });

  test("probe != 200 -> does NOT call `mcp add`", async () => {
    const ctx = makeFakeCtx({
      files: { "/work/.env": `SCRYPT_AUTH_TOKEN=${TOKEN}\n` },
      httpResponder: () => ({ status: 401, body: "" }),
    });
    const r = await runMcpInstall(ctx, { envPath: "/work/.env" });
    expect(r.ok).toBe(false);
    const calls = ctx.recorded.shell.map((s) => s.args.join(" "));
    expect(calls.some((c) => c.includes("mcp add"))).toBe(false);
  });

  test("claude absent -> graceful failure, no throw, no shell calls", async () => {
    const ctx = makeFakeCtx({
      files: { "/work/.env": `SCRYPT_AUTH_TOKEN=${TOKEN}\n` },
      whichResponder: () => null,
    });
    const r = await runMcpInstall(ctx, { envPath: "/work/.env" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("claude CLI not on PATH");
    expect(ctx.recorded.shell.length).toBe(0);
  });
});
