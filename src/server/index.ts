// src/server/index.ts
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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
import { graphRoutes } from "./api/graph";
import { mcpRoutes } from "./mcp/routes";
import { ToolRegistry } from "./mcp/registry";
import { registerAllTools } from "./mcp/tools";
import { SectionsRepo } from "./indexer/sections-repo";
import { MetadataRepo } from "./indexer/metadata-repo";
import { ChunkEmbeddingsRepo } from "./embeddings/chunks-repo";
import { EmbeddingEngine } from "./embeddings/engine";
import { EmbeddingService } from "./embeddings/service";
import { ProgressBus } from "./embeddings/progress";
import { Idempotency } from "./mcp/idempotency";
import { wireWebSocketSink } from "./embeddings/ws-sink";
import type { ToolContext } from "./mcp/types";
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

  mkdirSync(scryptPath, { recursive: true });
  mkdirSync(join(scryptPath, "trash"), { recursive: true });

  const db = createDatabase(dbPath);
  initSchema(db);

  const fm = new FileManager(config.vaultPath, scryptPath);

  // Wave 8: construct the embedding pipeline up front so the indexer
  // can reuse the same SectionsRepo/ProgressBus/EmbeddingEngine that
  // the MCP streamable-http transport will later share.
  const wave8Sections = new SectionsRepo(db);
  const wave8Metadata = new MetadataRepo(db);
  const wave8Embeddings = new ChunkEmbeddingsRepo(db);
  const wave8Bus = new ProgressBus();
  const wave8Engine = new EmbeddingEngine({
    model: process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5",
    batchSize: Number(process.env.SCRYPT_EMBED_BATCH ?? 8),
    cacheDir:
      process.env.SCRYPT_EMBED_CACHE_DIR ?? join(scryptPath, "embed-cache"),
  });
  const wave8EmbedService = new EmbeddingService({
    engine: wave8Engine,
    repo: wave8Embeddings,
    bus: wave8Bus,
    chunkOpts: {
      maxTokens: Number(process.env.SCRYPT_EMBED_MAX_TOKENS ?? 450),
      overlapTokens: Number(process.env.SCRYPT_EMBED_OVERLAP ?? 50),
    },
  });

  const indexer = new Indexer(
    db,
    fm,
    process.env.SCRYPT_EMBED_DISABLE === "1"
      ? undefined
      : { sections: wave8Sections, embedService: wave8EmbedService },
  );
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
  graphRoutes(router, db);

  // Wave 8: MCP streamable-http transport mounted at POST /mcp. Reuses
  // the same embedding pipeline as the file-watch indexer so a single
  // ProgressBus drives the UI overlay and both paths share one model.
  const mcpRegistry = new ToolRegistry();
  registerAllTools(mcpRegistry);
  const mcpCtx: ToolContext = {
    db,
    sections: wave8Sections,
    metadata: wave8Metadata,
    embeddings: wave8Embeddings,
    embedService: wave8EmbedService,
    engine: wave8Engine,
    bus: wave8Bus,
    idempotency: new Idempotency(db),
    userId: null,
    vaultDir: config.vaultPath,
    // Wire the legacy indexer so MCP write tools repopulate notes /
    // notes_fts / backlinks / tags / tasks / link_index without having
    // to wait for the fs watcher (unreliable under Docker on macOS).
    legacyIndexer: indexer,
  };
  wireWebSocketSink(wave8Bus, (channel, payload) =>
    ws.broadcastChannel(channel, payload),
  );
  mcpRoutes(router, mcpRegistry, mcpCtx, async (req) => {
    // Reuse scrypt's existing bearer token; returns a synthetic user id
    // when the token matches, null otherwise. Local stdio is the only
    // path for un-tokened access.
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!scryptConfig.authToken) return "local";
    return token === scryptConfig.authToken ? "local" : null;
  });

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
  const vaultPath = process.env.SCRYPT_VAULT_PATH || process.cwd();
  const staticDir = process.env.SCRYPT_STATIC_DIR;
  const config = loadConfig({ vaultPath, staticDir });
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
