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
    const limit = Math.min(Number(limitStr) || 100, 1000);

    const rows = activity.query({ since, until, actor, kind, action, limit });
    return Response.json(rows);
  });
}
