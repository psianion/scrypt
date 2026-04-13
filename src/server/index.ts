// src/server/index.ts
import { join } from "node:path";
import { createDatabase, initSchema } from "./db";
import { FileManager } from "./file-manager";
import { Indexer } from "./indexer";
import { WebSocketManager } from "./websocket";
import { Router } from "./router";
import { notesRoutes } from "./api/notes";
import { searchRoutes } from "./api/search";
import { journalRoutes } from "./api/journal";
import { templateRoutes } from "./api/templates";
import { taskRoutes } from "./api/tasks";
import { dataRoutes } from "./api/data";
import { pluginRoutes } from "./api/plugins";
import { skillRoutes } from "./api/skills";
import { fileRoutes } from "./api/files";
import { ingestRoutes } from "./api/ingest";
import { threadRoutes } from "./api/threads";
import { researchRoutes } from "./api/research";
import { memoryRoutes } from "./api/memories";
import { dailyContextRoutes } from "./api/daily-context";
import { activityRoutes } from "./api/activity";
import { IngestRouter } from "./ingest/router";
import { ActivityLog } from "./activity";
import { loadConfig, type ScryptConfig } from "./config";
import { checkAuth, unauthorizedResponse } from "./auth";
import {
  initRepo,
  startAutocommitLoop,
  type AutocommitLoop,
} from "./git-autocommit";

export interface AppConfig {
  vaultPath: string;
  staticDir?: string;
  authToken?: string;
  isProduction?: boolean;
  gitAutocommit?: boolean;
  gitAutocommitInterval?: number;
}

export function createApp(config: AppConfig) {
  const scryptConfig: ScryptConfig = {
    vaultPath: config.vaultPath,
    staticDir: config.staticDir,
    port: 3777,
    authToken: config.authToken,
    isProduction: config.isProduction ?? false,
    gitAutocommit: config.gitAutocommit ?? false,
    gitAutocommitInterval: config.gitAutocommitInterval ?? 900,
    trashRetentionDays: 30,
    logLevel: "info",
  };
  const scryptPath = join(config.vaultPath, ".scrypt");
  const dbPath = join(scryptPath, "scrypt.db");
  const staticDir = config.staticDir || join(config.vaultPath, "dist");

  const db = createDatabase(dbPath);
  initSchema(db);

  const fm = new FileManager(config.vaultPath, scryptPath);
  const indexer = new Indexer(db, fm);
  const ws = new WebSocketManager();
  const router = new Router();

  // Register API routes
  notesRoutes(router, fm, indexer);
  searchRoutes(router, indexer);
  journalRoutes(router, fm, indexer, config.vaultPath);
  templateRoutes(router, fm, config.vaultPath);
  taskRoutes(router, indexer, fm, config.vaultPath);
  dataRoutes(router, config.vaultPath);
  pluginRoutes(router, config.vaultPath);
  skillRoutes(router, config.vaultPath);
  fileRoutes(router, config.vaultPath);

  const activity = new ActivityLog(db);
  const ingestRouter = new IngestRouter({
    vaultPath: config.vaultPath,
    db,
    fm,
    indexer,
    activity,
  });
  ingestRoutes(router, ingestRouter);
  threadRoutes(router, fm, config.vaultPath, activity);
  researchRoutes(router, db, ingestRouter);
  memoryRoutes(router, fm);
  dailyContextRoutes(router, fm, indexer, config.vaultPath);
  activityRoutes(router, activity);

  let autocommit: AutocommitLoop | undefined;
  if (scryptConfig.gitAutocommit) {
    initRepo(config.vaultPath).catch((e) =>
      console.error("[scrypt] git init failed:", e),
    );
    autocommit = startAutocommitLoop({
      vaultPath: config.vaultPath,
      intervalSeconds: scryptConfig.gitAutocommitInterval,
      onCommit: (r) => {
        activity.record({
          action: "snapshot",
          kind: null,
          path: ".",
          actor: "system",
          meta: { sha: r.sha, fileCount: r.fileCount },
        });
      },
    });
  }

  // File watcher → reindex → WS broadcast
  fm.watchFiles(async (event) => {
    if (event.type === "delete") {
      await indexer.removeNote(event.path);
    } else {
      await indexer.reindexNote(event.path);
    }
    const wsType =
      event.type === "create" ? "noteCreated" :
      event.type === "delete" ? "noteDeleted" : "noteChanged";
    ws.broadcast({ type: wsType, path: event.path });
    ws.broadcast({ type: "reindexed" });
  });

  // Initial full reindex — expose the promise so callers (tests) can await
  // before tearing down the DB, avoiding race between startup indexing and
  // fixture cleanup.
  const ready = indexer.fullReindex();

  return {
    ready,
    fetch(req: Request, server: any): Response | Promise<Response> {
      // WebSocket upgrade
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Auth gate for /api/*
      const authResult = checkAuth(req, {
        isProduction: scryptConfig.isProduction,
        authToken: scryptConfig.authToken,
      });
      if (!authResult.ok) {
        return unauthorizedResponse();
      }

      // API routes
      const apiResponse = router.handle(req);
      if (apiResponse) return apiResponse;

      // Static files + SPA fallback
      if (!url.pathname.startsWith("/api/")) {
        // Only try a static file when the path clearly references one —
        // bare "/" and route paths without an extension go straight to the
        // SPA shell. Bun.file() on a directory throws on macOS.
        const hasExt = /\.[a-zA-Z0-9]+$/.test(url.pathname);
        if (hasExt) {
          const filePath = join(staticDir, url.pathname);
          const file = Bun.file(filePath);
          if (file.size > 0) return new Response(file);
        }
        const indexFile = Bun.file(join(staticDir, "index.html"));
        if (indexFile.size > 0) return new Response(indexFile);
      }

      return Response.json({ error: "Not Found" }, { status: 404 });
    },
    websocket: ws.handlers(),
    indexer,
    fm,
    db,
    activity,
    ingestRouter,
    stop: () => {
      autocommit?.stop();
    },
  };
}

// CLI entry point
if (import.meta.main) {
  const config = loadConfig({ vaultPath: process.cwd() });
  const app = createApp({
    vaultPath: config.vaultPath,
    staticDir: config.staticDir,
    authToken: config.authToken,
    isProduction: config.isProduction,
    gitAutocommit: config.gitAutocommit,
    gitAutocommitInterval: config.gitAutocommitInterval,
  });
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket: app.websocket,
  });
  console.log(`Scrypt running on http://localhost:${server.port}`);
}
