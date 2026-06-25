// src/cli/runtime-ops.ts
//
// PURE command builders for starting/stopping each runtime, plus the pid-file
// path helper. Actual spawning/killing lives in the command runners (impure).

import { join } from "node:path";
import type { Profile } from "./runtime-detect";

export interface StartCommand {
  cmd: string;
  args: string[];
}

export const COMPOSE_FILE = "docker-compose.yml";
export const COMPOSE_OVERRIDE = "docker-compose.override.yml";
export const COMPOSE_VPS_FILE = "docker-compose.vps.yml";

export function buildNativeStart(): StartCommand {
  return { cmd: "bun", args: ["src/server/index.ts"] };
}

export function buildDockerUp(overrideExists: boolean): StartCommand {
  const files = overrideExists
    ? ["-f", COMPOSE_FILE, "-f", COMPOSE_OVERRIDE]
    : ["-f", COMPOSE_FILE];
  return { cmd: "docker", args: ["compose", ...files, "up", "-d"] };
}

export function buildDockerDown(volumes: boolean, overrideExists: boolean): StartCommand {
  const files = overrideExists
    ? ["-f", COMPOSE_FILE, "-f", COMPOSE_OVERRIDE]
    : ["-f", COMPOSE_FILE];
  const args = ["compose", ...files, "down"];
  if (volumes) args.push("-v");
  return { cmd: "docker", args };
}

export function buildStartCommand(profile: Profile, overrideExists: boolean): StartCommand | null {
  if (profile === "native") return buildNativeStart();
  if (profile === "docker") return buildDockerUp(overrideExists);
  return null; // vps does not start a local server
}

export function pidFilePath(vaultPath: string): string {
  return join(vaultPath, ".scrypt", "cli", "server.pid");
}
