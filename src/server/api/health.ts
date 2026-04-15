//
// GET /api/health/embed — exposes the EmbedClient's in-memory counters
// for ops visibility (queue depth, skipped chunks, timeouts, worker
// restarts, circuit state). Cheap, no metric system needed.
import type { Router } from "../router";
import type { EmbedClient } from "../embeddings/client";

export function embedHealthRoutes(
  router: Router,
  client: EmbedClient | null,
): void {
  router.get("/api/health/embed", () => {
    if (!client) {
      return Response.json(
        { error: "embed worker not initialised" },
        { status: 503 },
      );
    }
    const s = client.getStats();
    return Response.json({
      queue_depth: s.queueDepth,
      skipped_total: s.skippedTotal,
      timeouts_total: s.timeoutsTotal,
      restarts_total: s.restartsTotal,
      circuit_state: s.circuitState,
    });
  });
}
