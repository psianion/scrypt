// src/cli/init-plan.ts
//
// PURE init planner. Given the existing .env (parsed), the user's answers, and a
// precomputed candidate token, it decides the token action, computes the merged
// .env text, and emits an ordered list of step descriptors for the runner to
// execute. Keeping this pure makes idempotency and the --print-env dry-run
// trivially testable.

import { type EnvLine, mergeEnv, getEnv, commentOut } from "./env-file";
import { isWeakToken, redactToken } from "./token";
import type { Profile } from "./runtime-detect";

export interface InitAnswers {
  profile: Profile;
  vaultPath: string; // absolute
  ingestDir?: string; // docker only
  hubUrl?: string; // vps only
  gitAutocommit?: boolean;
}

export type InitStep =
  | { kind: "write-env" }
  | { kind: "write-override"; ingestDir: string; arch: string }
  | { kind: "start-runtime"; profile: Profile }
  | { kind: "health-verify"; url: string }
  | { kind: "probe-hub"; url: string };

export interface PlanInitInput {
  existing: EnvLine[];
  answers: InitAnswers;
  existingToken: string | undefined;
  /** Candidate token precomputed by the caller via rng (keeps this pure). */
  candidateToken: string;
  /** Explicit token from --token (wins over everything). */
  forcedToken?: string;
  /** --rotate-token: force regeneration even if a good token exists. */
  rotate: boolean;
  noStart: boolean;
  /** Effective port (default 3777). */
  port: number;
  arch: string;
}

export interface InitPlan {
  token: string;
  tokenAction: "kept" | "generated" | "rotated";
  envUpdates: Record<string, string>;
  envText: string;
  changed: boolean;
  steps: InitStep[];
  warnings: string[];
  /** Human-readable diff lines with the token redacted. */
  redactedDiff: string[];
}

const NATIVE_BIND_WARNING =
  "native mode: the server binds ALL interfaces (Bun.serve has no hostname; SCRYPT_BIND_ADDR is not applied to the bind). " +
  "Your generated token protects non-loopback callers, but note the Host-header loopback bypass. " +
  "On an untrusted network, prefer the docker or vps profile. Run `scrypt doctor` to audit exposure.";

export function planInit(input: PlanInitInput): InitPlan {
  const { answers, port, arch } = input;
  const warnings: string[] = [];

  // ---- Token resolution (idempotent) ----
  let token: string;
  let tokenAction: InitPlan["tokenAction"];
  if (input.forcedToken) {
    token = input.forcedToken;
    tokenAction = input.existingToken ? "rotated" : "generated";
  } else if (input.rotate) {
    token = input.candidateToken;
    tokenAction = input.existingToken ? "rotated" : "generated";
  } else if (input.existingToken && !isWeakToken(input.existingToken)) {
    token = input.existingToken;
    tokenAction = "kept";
  } else {
    token = input.candidateToken;
    // weak/placeholder existing token is replaced, not "kept"
    tokenAction = "generated";
    if (input.existingToken && isWeakToken(input.existingToken)) {
      warnings.push("existing SCRYPT_AUTH_TOKEN was weak/placeholder — generated a strong one.");
    }
  }

  // ---- Per-profile env keys ----
  const updates: Record<string, string> = {};
  let lines = input.existing.map((l) => ({ ...l }));

  if (answers.profile === "native") {
    updates.SCRYPT_VAULT_PATH = answers.vaultPath;
    updates.SCRYPT_AUTH_TOKEN = token;
    if (port !== 3777) updates.SCRYPT_PORT = String(port);
    if (answers.gitAutocommit) updates.SCRYPT_GIT_AUTOCOMMIT = "1";
    // A NODE_ENV=production copied from .env.example would make native boot throw
    // (and is misleading). Comment it out.
    if (getEnv(lines, "NODE_ENV") === "production") {
      const r = commentOut(lines, "NODE_ENV");
      lines = r.lines;
      if (r.changed) warnings.push("commented out NODE_ENV=production for native dev (was copied from .env.example).");
    }
    // Deliberately NOT writing SCRYPT_BIND_ADDR=127.0.0.1: it does not restrict
    // the actual bind and would mask the token-required check. (critique M6)
    warnings.push(NATIVE_BIND_WARNING);
  } else if (answers.profile === "docker") {
    // compose sets NODE_ENV=production -> token is REQUIRED or loadConfig throws.
    updates.SCRYPT_AUTH_TOKEN = token;
    updates.SCRYPT_VAULT_DIR = answers.vaultPath;
    if (answers.ingestDir) updates.SCRYPT_INGEST_DIR = answers.ingestDir;
    updates.SCRYPT_BIND_ADDR = "127.0.0.1"; // gates the host publish mapping to loopback
    if (port !== 3777) updates.SCRYPT_PORT = String(port);
    if (answers.gitAutocommit) updates.SCRYPT_GIT_AUTOCOMMIT = "1";
  } else {
    // vps: this machine is a sync CLIENT to a remote hub. No local server keys.
    if (answers.hubUrl) updates.SCRYPT_HUB_URL = answers.hubUrl;
    updates.SCRYPT_AUTH_TOKEN = token;
    updates.SCRYPT_VAULT_PATH = answers.vaultPath;
  }

  const merge = mergeEnv(lines, updates);

  // ---- Steps ----
  const steps: InitStep[] = [{ kind: "write-env" }];
  if (answers.profile === "docker" && answers.ingestDir) {
    steps.push({ kind: "write-override", ingestDir: answers.ingestDir, arch });
  }
  if (!input.noStart) {
    if (answers.profile === "vps") {
      if (answers.hubUrl) steps.push({ kind: "probe-hub", url: `${answers.hubUrl.replace(/\/$/, "")}/api/sync/manifest` });
    } else {
      steps.push({ kind: "start-runtime", profile: answers.profile });
      steps.push({ kind: "health-verify", url: `http://localhost:${port}/health` });
    }
  }

  // ---- Redacted diff ----
  const redactedDiff = Object.entries(updates).map(([k, v]) =>
    k === "SCRYPT_AUTH_TOKEN" ? `${k}=${redactToken(v)}` : `${k}=${v}`,
  );

  return {
    token,
    tokenAction,
    envUpdates: updates,
    envText: merge.text,
    changed: merge.changed,
    steps,
    warnings,
    redactedDiff,
  };
}
