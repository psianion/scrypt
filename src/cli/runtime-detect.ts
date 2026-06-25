// src/cli/runtime-detect.ts
//
// PURE classification of the host's capabilities into recommended setup
// profiles. The thin shell gathers raw facts (version exit codes, daemon ping,
// platform/arch); this module decides what's usable and what to warn about.

export type Profile = "native" | "docker" | "vps";

export interface RuntimeFacts {
  /** `bun --version` succeeded (or we're already running under Bun). */
  bun: boolean;
  /** `docker info` exit 0 — daemon reachable. */
  dockerDaemon: boolean;
  /** `docker compose version` exit 0. */
  dockerCompose: boolean;
  /** `claude --version` exit 0. */
  claude: boolean;
  /** Tailscale state, if detectable. */
  tailscale: { installed: boolean; up: boolean; ip: string | null };
  platform: NodeJS.Platform;
  arch: string;
}

export interface RuntimeReport {
  available: { native: boolean; docker: boolean; vps: boolean };
  recommended: Profile;
  warnings: string[];
}

export function detectRuntimes(facts: RuntimeFacts): RuntimeReport {
  const docker = facts.dockerDaemon && facts.dockerCompose;
  const available = {
    native: facts.bun,
    // docker profile needs a working daemon + compose
    docker,
    // vps (sync-client) profile only needs Bun to run the sync CLI locally
    vps: facts.bun,
  };

  const warnings: string[] = [];

  if (docker && facts.arch !== "arm64") {
    warnings.push(
      "docker-compose.yml pins platform: linux/arm64; on this " +
        `${facts.arch} host the CLI de-pins it via a generated override so the image builds natively.`,
    );
  }
  if (facts.dockerDaemon && !facts.dockerCompose) {
    warnings.push("Docker daemon is up but `docker compose` is unavailable — install the Compose plugin.");
  }
  if (!facts.claude) {
    warnings.push("`claude` CLI not found — `scrypt mcp install` will be unavailable until Claude Code is installed.");
  }
  if (facts.tailscale.installed && !facts.tailscale.up) {
    warnings.push("Tailscale is installed but not connected — run `tailscale up` before using the vps/sync profile.");
  }

  // Recommendation: prefer Docker for a clean, production-like local setup when
  // available; otherwise native if Bun is present.
  let recommended: Profile;
  if (available.docker) recommended = "docker";
  else if (available.native) recommended = "native";
  else recommended = "vps";

  return { available, recommended, warnings };
}
