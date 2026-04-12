// src/server/api/ingest.ts
import type { Router } from "../router";
import { IngestRouter, IngestError } from "../ingest/router";

export function ingestRoutes(router: Router, ingest: IngestRouter): void {
  router.post("/api/ingest", async (req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    try {
      const result = await ingest.ingest(body);
      return Response.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof IngestError) {
        const status =
          err.code === "bad_request"
            ? 400
            : err.code === "conflict"
              ? 409
              : err.code === "not_found"
                ? 404
                : 500;
        return Response.json(
          { error: err.message, field: err.field },
          { status },
        );
      }
      console.error("ingest internal error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  });
}
