import { test, expect } from "bun:test";
import { embedHealthRoutes } from "../../../src/server/api/health";
import type { Router } from "../../../src/server/router";
import type { EmbedClient } from "../../../src/server/embeddings/client";

function fakeRouter(): { router: Router; routes: Record<string, any> } {
  const routes: Record<string, any> = {};
  const router = {
    get: (path: string, handler: any) => {
      routes[`GET ${path}`] = handler;
    },
  } as unknown as Router;
  return { router, routes };
}

test("GET /api/health/embed returns stats from EmbedClient.getStats()", async () => {
  const { router, routes } = fakeRouter();
  const client = {
    getStats: () => ({
      queueDepth: 7,
      skippedTotal: 1,
      timeoutsTotal: 0,
      restartsTotal: 2,
      circuitState: "closed" as const,
    }),
  } as unknown as EmbedClient;

  embedHealthRoutes(router, client);
  const handler = routes["GET /api/health/embed"];
  const res = (await handler({} as any, {} as any)) as Response;

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    queue_depth: 7,
    skipped_total: 1,
    timeouts_total: 0,
    restarts_total: 2,
    circuit_state: "closed",
  });
});

test("GET /api/health/embed returns 503 when client is null", async () => {
  const { router, routes } = fakeRouter();
  embedHealthRoutes(router, null);
  const handler = routes["GET /api/health/embed"];
  const res = (await handler({} as any, {} as any)) as Response;

  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toContain("embed worker not initialised");
});
