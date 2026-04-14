// src/server/config.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ScryptConfig {
  vaultPath: string;
  staticDir?: string;
  port: number;
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

export function loadConfig(opts: LoadConfigOpts): ScryptConfig {
  const env = process.env;
  const isProduction = env.NODE_ENV === "production";
  const authToken = env.SCRYPT_AUTH_TOKEN || undefined;

  if (isProduction && !authToken) {
    throw new Error(
      "SCRYPT_AUTH_TOKEN is required when NODE_ENV=production",
    );
  }

  return {
    vaultPath: opts.vaultPath,
    staticDir: opts.staticDir,
    port: Number(env.SCRYPT_PORT) || 3777,
    authToken,
    isProduction,
    gitAutocommit: env.SCRYPT_GIT_AUTOCOMMIT === "1",
    gitAutocommitInterval: Number(env.SCRYPT_GIT_AUTOCOMMIT_INTERVAL) || 900,
    trashRetentionDays: Number(env.SCRYPT_TRASH_RETENTION_DAYS) || 30,
    logLevel: (env.SCRYPT_LOG_LEVEL as LogLevel) || "info",
  };
}
