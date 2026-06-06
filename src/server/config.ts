// src/server/config.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ScryptConfig {
  vaultPath: string;
  staticDir?: string;
  port: number;
  bindAddr: string;
  authToken: string | undefined;
  isProduction: boolean;
  gitAutocommit: boolean;
  gitAutocommitInterval: number;
  trashRetentionDays: number;
  logLevel: LogLevel;
}

interface LoadConfigOpts {
  vaultPath: string;
  staticDir?: string;
}

// Loopback bind addresses that carry no network-exposure risk and so don't
// force a token. "0.0.0.0" / "::" bind every interface and ARE exposed, so they
// are deliberately excluded. (F5)
const LOOPBACK_BINDS = new Set(["127.0.0.1", "localhost", "::1", ""]);

function isLoopbackBind(addr: string): boolean {
  return LOOPBACK_BINDS.has(addr.trim());
}

export function loadConfig(opts: LoadConfigOpts): ScryptConfig {
  const env = process.env;
  const isProduction = env.NODE_ENV === "production";
  const authToken = env.SCRYPT_AUTH_TOKEN || undefined;
  // Default to loopback: the app must opt in to a routable bind. SCRYPT_BIND_ADDR
  // doubles as the Docker host-publish knob; the app only consumes it to gate the
  // token requirement on actual network exposure (see below) — it does not bind
  // it inside the container (the publish mapping handles host exposure).
  const bindAddr = env.SCRYPT_BIND_ADDR || "127.0.0.1";

  // Require a token whenever the server is reachable off-box: either an explicit
  // production build, OR a non-loopback bind address. Keying on actual exposure
  // (not just NODE_ENV) closes the off-script `bun run` window where a tailnet-
  // bound server would otherwise fail open. (F5)
  const exposed = isProduction || !isLoopbackBind(bindAddr);
  if (exposed && !authToken) {
    throw new Error(
      isProduction
        ? "SCRYPT_AUTH_TOKEN is required when NODE_ENV=production"
        : `SCRYPT_AUTH_TOKEN is required when binding a non-loopback interface (SCRYPT_BIND_ADDR=${bindAddr})`,
    );
  }

  return {
    vaultPath: opts.vaultPath,
    staticDir: opts.staticDir,
    port: Number(env.SCRYPT_PORT) || 3777,
    bindAddr,
    authToken,
    isProduction,
    gitAutocommit: env.SCRYPT_GIT_AUTOCOMMIT === "1",
    gitAutocommitInterval: Number(env.SCRYPT_GIT_AUTOCOMMIT_INTERVAL) || 900,
    trashRetentionDays: Number(env.SCRYPT_TRASH_RETENTION_DAYS) || 30,
    logLevel: (env.SCRYPT_LOG_LEVEL as LogLevel) || "info",
  };
}
