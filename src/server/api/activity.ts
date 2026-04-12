// src/server/api/activity.ts
import type { Router } from "../router";
import { ActivityLog, type ActivityActor, type ActivityAction } from "../activity";

export function activityRoutes(router: Router, activity: ActivityLog): void {
  router.get("/api/activity", (req) => {
    const url = new URL(req.url);
    const since = url.searchParams.get("since") || undefined;
    const until = url.searchParams.get("until") || undefined;
    const actor =
      (url.searchParams.get("actor") as ActivityActor) || undefined;
    const kind = url.searchParams.get("kind") || undefined;
    const action =
      (url.searchParams.get("action") as ActivityAction) || undefined;
    const limitStr = url.searchParams.get("limit");

    let limit = 100;
    if (limitStr !== null) {
      const n = Number(limitStr);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return Response.json(
          { error: `invalid limit: ${limitStr}`, field: "limit" },
          { status: 400 },
        );
      }
      limit = Math.min(n, 1000);
    }

    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      return Response.json(
        { error: `invalid since: ${since}`, field: "since" },
        { status: 400 },
      );
    }
    if (until !== undefined && Number.isNaN(Date.parse(until))) {
      return Response.json(
        { error: `invalid until: ${until}`, field: "until" },
        { status: 400 },
      );
    }
    if (since !== undefined && until !== undefined && since > until) {
      return Response.json(
        { error: "since must be <= until", field: "since" },
        { status: 400 },
      );
    }

    const rows = activity.query({ since, until, actor, kind, action, limit });
    return Response.json(rows);
  });
}
