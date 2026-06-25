// src/cli/ctx.ts
//
// The injectable I/O boundary. Every side effect the CLI performs goes through
// one of these interfaces, so business logic stays pure and unit-testable.
// makeRealCtx() is the ONLY place that imports Bun globals / node builtins /
// fetch / readline. makeFakeCtx() returns recording fakes for tests.

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Shell {
  /** Run a command with an argv array (no shell, no quoting bugs). Returns
   *  code 127 if the binary is absent rather than throwing. */
  run(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<ShellResult>;
  which(cmd: string): string | null;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface Http {
  /** Perform a request. Rejects on network error (caller catches). */
  request(method: string, url: string, opts?: { headers?: Record<string, string>; body?: string }): Promise<HttpResponse>;
}

export interface FsLike {
  read(path: string): string | null;
  write(path: string, content: string): void;
  exists(path: string): boolean;
  mkdirp(path: string): void;
  /** Best-effort; no-op where unsupported (Windows). */
  chmod(path: string, mode: number): void;
}

export interface Prompter {
  ask(question: string, def?: string): Promise<string>;
  confirm(question: string, def?: boolean): Promise<boolean>;
  select(question: string, choices: string[], defIndex?: number): Promise<string>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface Ctx {
  log: Logger;
  shell: Shell;
  http: Http;
  fs: FsLike;
  prompt: Prompter;
  clock: Clock;
  rng: (n: number) => Uint8Array;
  env: Record<string, string | undefined>;
  cwd: string;
  platform: NodeJS.Platform;
  arch: string;
  isTTY: boolean;
}

export function makeRealCtx(): Ctx {
  return {
    log: {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    },
    shell: {
      async run(cmd, args, opts) {
        try {
          const proc = Bun.spawn([cmd, ...args], {
            stdout: "pipe",
            stderr: "pipe",
            cwd: opts?.cwd,
            env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          });
          const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          const code = await proc.exited;
          return { code, stdout, stderr };
        } catch (e) {
          // ENOENT etc. — treat as "command not found / failed to spawn".
          return { code: 127, stdout: "", stderr: String(e) };
        }
      },
      which: (cmd) => Bun.which(cmd),
    },
    http: {
      async request(method, url, opts) {
        const res = await fetch(url, { method, headers: opts?.headers, body: opts?.body });
        const body = await res.text();
        return { status: res.status, body };
      },
    },
    fs: {
      read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
      write: (p, c) => writeFileSync(p, c, "utf8"),
      exists: (p) => existsSync(p),
      mkdirp: (p) => { mkdirSync(p, { recursive: true }); },
      chmod: (p, mode) => { try { chmodSync(p, mode); } catch { /* best effort */ } },
    },
    prompt: {
      async ask(question, def) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const suffix = def ? ` [${def}]` : "";
          const a = (await rl.question(`${question}${suffix}: `)).trim();
          return a || def || "";
        } finally {
          rl.close();
        }
      },
      async confirm(question, def = false) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const hint = def ? "Y/n" : "y/N";
          const a = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
          if (a === "") return def;
          return a === "y" || a === "yes";
        } finally {
          rl.close();
        }
      },
      async select(question, choices, defIndex = 0) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          console.log(question);
          choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}${i === defIndex ? " (default)" : ""}`));
          const a = (await rl.question(`Choose [1-${choices.length}]: `)).trim();
          if (a === "") return choices[defIndex];
          const n = Number(a);
          if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1];
          return choices[defIndex];
        } finally {
          rl.close();
        }
      },
    },
    clock: {
      now: () => Date.now(),
      sleep: (ms) => Bun.sleep(ms),
    },
    rng: (n) => new Uint8Array(nodeRandomBytes(n)),
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    isTTY: Boolean(process.stdout.isTTY),
  };
}

// ---- Test fakes -----------------------------------------------------------

export interface FakeCtxOverrides {
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  isTTY?: boolean;
  files?: Record<string, string>;
  rngByte?: number;
  shellResponder?: (cmd: string, args: string[]) => ShellResult;
  httpResponder?: (method: string, url: string, opts?: { headers?: Record<string, string>; body?: string }) => HttpResponse;
  whichResponder?: (cmd: string) => string | null;
  answers?: string[];
  confirms?: boolean[];
}

export interface FakeCtx extends Ctx {
  recorded: {
    shell: Array<{ cmd: string; args: string[] }>;
    http: Array<{ method: string; url: string; headers?: Record<string, string> }>;
    writes: Record<string, string>;
    logs: string[];
  };
}

export function makeFakeCtx(o: FakeCtxOverrides = {}): FakeCtx {
  const files: Record<string, string> = { ...(o.files ?? {}) };
  const recorded: FakeCtx["recorded"] = { shell: [], http: [], writes: {}, logs: [] };
  let answerIdx = 0;
  let confirmIdx = 0;

  return {
    recorded,
    log: {
      info: (m) => recorded.logs.push(m),
      warn: (m) => recorded.logs.push(m),
      error: (m) => recorded.logs.push(m),
    },
    shell: {
      async run(cmd, args) {
        recorded.shell.push({ cmd, args });
        return o.shellResponder?.(cmd, args) ?? { code: 0, stdout: "", stderr: "" };
      },
      which: (cmd) => (o.whichResponder ? o.whichResponder(cmd) : "/usr/bin/" + cmd),
    },
    http: {
      async request(method, url, opts) {
        recorded.http.push({ method, url, headers: opts?.headers });
        if (o.httpResponder) return o.httpResponder(method, url, opts);
        return { status: 200, body: '{"ok":true}' };
      },
    },
    fs: {
      read: (p) => (p in files ? files[p] : null),
      write: (p, c) => { files[p] = c; recorded.writes[p] = c; },
      exists: (p) => p in files,
      mkdirp: () => {},
      chmod: () => {},
    },
    prompt: {
      async ask(_q, def) { return o.answers?.[answerIdx++] ?? def ?? ""; },
      async confirm(_q, def) { return o.confirms?.[confirmIdx++] ?? def ?? false; },
      async select(_q, choices, defIndex = 0) { return o.answers?.[answerIdx++] ?? choices[defIndex]; },
    },
    clock: { now: () => 0, sleep: async () => {} },
    rng: (n) => new Uint8Array(n).fill(o.rngByte ?? 0xab),
    env: o.env ?? {},
    cwd: o.cwd ?? "/work",
    platform: o.platform ?? "linux",
    arch: o.arch ?? "x64",
    isTTY: o.isTTY ?? false,
  };
}
