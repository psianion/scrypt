#!/usr/bin/env bun
// src/cli/main.ts
//
// `scrypt` entry point. Resolves the command from the registry and dispatches.
// All business logic lives in the command runners; this file only wires Ctx and
// maps the returned code to process.exit. Guarded by import.meta.main so tests
// can import `main` without spawning a process.

import { makeRealCtx } from "./ctx";
import { commands, usage } from "./commands";

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(usage());
    return cmd ? 0 : 2; // bare invocation is a usage error; explicit help is ok
  }

  if (cmd === "--version" || cmd === "version") {
    try {
      const pkg: { default?: { version?: string }; version?: string } = await import("../../package.json");
      console.log(pkg.default?.version ?? pkg.version ?? "0.0.0");
    } catch {
      console.log("0.0.0");
    }
    return 0;
  }

  const command = commands[cmd];
  if (!command) {
    console.error(`unknown command: ${cmd}\n`);
    console.error(usage());
    return 2;
  }

  const ctx = makeRealCtx();
  return command.run(ctx, rest);
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
