import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import {
  TasksRepo,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskStatus,
  type TaskType,
} from "../../../src/server/indexer/tasks-repo";
import { taskListRoutes } from "../../../src/server/api/tasks";
import { Router } from "../../../src/server/router";

interface Seed {
  note_path: string | null;
  title: string;
  type: TaskType;
  status?: TaskStatus;
  priority?: number;
}

function buildRouter(seeds: Seed[] = []): { router: Router; repo: TasksRepo } {
  const db = new Database(":memory:");
  initSchema(db);
  const repo = new TasksRepo(db);
  for (const s of seeds) repo.create(s);
  const router = new Router();
  taskListRoutes(router, repo);
  return { router, repo };
}

async function getJson(router: Router, qs: string): Promise<{ status: number; body: any }> {
  const res = await router.handle(new Request(`http://x/api/tasks/list${qs}`));
  if (!res) throw new Error("router returned null");
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const FIXTURE: Seed[] = [
  { note_path: "notes/a.md", title: "A1 plan", type: "PLAN", status: "open", priority: 5 },
  { note_path: "notes/a.md", title: "A2 build", type: "BUILD", status: "in_progress", priority: 3 },
  { note_path: "notes/a.md", title: "A3 done", type: "BUILD", status: "closed", priority: 1 },
  { note_path: "notes/b.md", title: "B1 research", type: "RESEARCH", status: "open", priority: 4 },
  { note_path: "notes/b.md", title: "B2 plan", type: "PLAN", status: "open", priority: 2 },
  { note_path: "notes/b.md", title: "B3 review", type: "REVIEW", status: "closed", priority: 0 },
  { note_path: "notes/c.md", title: "C1 brain", type: "BRAINSTORM", status: "in_progress", priority: 7 },
  { note_path: "notes/c.md", title: "C2 custom", type: "CUSTOM", status: "open", priority: 1 },
  { note_path: null, title: "Orphan plan", type: "PLAN", status: "open", priority: 9 },
  { note_path: null, title: "Orphan closed", type: "CUSTOM", status: "closed", priority: 9 },
];

describe("GET /api/tasks/list — filter and pagination interactions", () => {
  test("status default + status=all + note_path + type filters across realistic fixture", async () => {
    const { router } = buildRouter(FIXTURE);

    // 1. Default (no params) — only "open" tasks across all notes:
    //    A1, B1, B2, C2, Orphan plan = 5
    const def = await getJson(router, "");
    expect(def.status).toBe(200);
    expect(def.body.total).toBe(5);
    expect(def.body.tasks.every((t: any) => t.status === "open")).toBe(true);
    // Default order is priority DESC then due NULLS LAST then id ASC.
    // Highest open priority is "Orphan plan" (9).
    expect(def.body.tasks[0].title).toBe("Orphan plan");

    // 2. status=all returns every row regardless of status (10).
    const all = await getJson(router, "?status=all");
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(10);
    const statusSet = new Set(all.body.tasks.map((t: any) => t.status));
    expect(statusSet.has("open")).toBe(true);
    expect(statusSet.has("in_progress")).toBe(true);
    expect(statusSet.has("closed")).toBe(true);

    // 3. status=in_progress filters to two: A2, C1.
    const inProg = await getJson(router, "?status=in_progress");
    expect(inProg.body.total).toBe(2);
    expect(inProg.body.tasks.map((t: any) => t.title).sort()).toEqual([
      "A2 build",
      "C1 brain",
    ]);

    // 4. note_path filter restricts results to that note exactly.
    //    notes/a.md has 3 rows but default status=open → only A1.
    const aOpen = await getJson(router, "?note_path=notes/a.md");
    expect(aOpen.body.total).toBe(1);
    expect(aOpen.body.tasks[0].title).toBe("A1 plan");

    // 5. note_path + status=all returns all 3 rows for notes/a.md.
    const aAll = await getJson(router, "?note_path=notes/a.md&status=all");
    expect(aAll.body.total).toBe(3);
    expect(aAll.body.tasks.map((t: any) => t.title).sort()).toEqual([
      "A1 plan",
      "A2 build",
      "A3 done",
    ]);

    // 6. note_path + type combo: notes/b.md & type=PLAN → only B2 (open).
    const bPlanOpen = await getJson(router, "?note_path=notes/b.md&type=PLAN");
    expect(bPlanOpen.body.total).toBe(1);
    expect(bPlanOpen.body.tasks[0].title).toBe("B2 plan");

    // 7. type=PLAN with status=all returns A1, B2, Orphan plan.
    const planAll = await getJson(router, "?type=PLAN&status=all");
    expect(planAll.body.total).toBe(3);
  });

  test("pagination boundaries: limit=0, limit=1, limit > total, offset > total, negative clamped to default", async () => {
    const { router } = buildRouter(FIXTURE);

    // limit=0 → total still 5 open, but tasks page is empty.
    const zero = await getJson(router, "?limit=0");
    expect(zero.status).toBe(200);
    expect(zero.body.total).toBe(5);
    expect(zero.body.tasks).toHaveLength(0);

    // limit=1 → single highest-priority open task.
    const one = await getJson(router, "?limit=1");
    expect(one.body.tasks).toHaveLength(1);
    expect(one.body.total).toBe(5);
    expect(one.body.tasks[0].title).toBe("Orphan plan");

    // limit past total → returns all 5, total still 5.
    const big = await getJson(router, "?limit=1000&status=all");
    expect(big.body.total).toBe(10);
    expect(big.body.tasks).toHaveLength(10);

    // offset past total → empty page, total preserved.
    const farOffset = await getJson(router, "?offset=999");
    expect(farOffset.body.total).toBe(5);
    expect(farOffset.body.tasks).toHaveLength(0);

    // Negative limit/offset → parseNum clamps to default (limit=200, offset=0).
    // So same result as the default request.
    const neg = await getJson(router, "?limit=-5&offset=-3");
    expect(neg.status).toBe(200);
    expect(neg.body.total).toBe(5);
    expect(neg.body.tasks).toHaveLength(5);

    // Non-numeric (NaN) → also default-clamped, still 200.
    const nan = await getJson(router, "?limit=abc&offset=xyz");
    expect(nan.status).toBe(200);
    expect(nan.body.tasks).toHaveLength(5);

    // limit=2 + offset=2 over status=all (10 rows) → 2 mid-page rows.
    const page = await getJson(router, "?status=all&limit=2&offset=2");
    expect(page.body.total).toBe(10);
    expect(page.body.tasks).toHaveLength(2);
  });

  test("each 400 validation branch in tasks.ts is covered", async () => {
    const { router } = buildRouter(FIXTURE);

    // Invalid status (not in TASK_STATUSES, not "all") → 400.
    const badStatuses = ["bogus", "OPEN", "done", "pending", " "];
    for (const s of badStatuses) {
      const r = await getJson(router, `?status=${encodeURIComponent(s)}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("invalid status");
    }

    // Invalid type → 400. Test each non-member.
    const badTypes = ["plan", "FOO", "build", "Research", ""];
    for (const t of badTypes) {
      const r = await getJson(router, `?type=${encodeURIComponent(t)}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("invalid type");
    }

    // Empty status param ("") is non-null and not in VALID_STATUS → 400.
    const empty = await getJson(router, "?status=");
    expect(empty.status).toBe(400);

    // Type validation runs before status validation: bad type + status=all
    // should still produce a 400 on the type, not skip via the all branch.
    const both = await getJson(router, "?status=all&type=NOPE");
    expect(both.status).toBe(400);
    expect(both.body.error).toContain("invalid type");

    // Sanity: every valid status + every valid type returns 200.
    for (const s of TASK_STATUSES) {
      const r = await getJson(router, `?status=${s}`);
      expect(r.status).toBe(200);
    }
    for (const t of TASK_TYPES) {
      const r = await getJson(router, `?type=${t}&status=all`);
      expect(r.status).toBe(200);
    }
  });

  test("tasks created via repo (cross-system contract) are immediately visible to GET /api/tasks/list", async () => {
    const { router, repo } = buildRouter([]);

    // Empty start.
    const empty = await getJson(router, "?status=all");
    expect(empty.body.total).toBe(0);

    // Mirror what the MCP create_task tool does — direct repo.create.
    const created = repo.create({
      note_path: "notes/new.md",
      title: "Freshly created",
      type: "RESEARCH",
      status: "open",
      priority: 8,
    });
    expect(created.id).toBeGreaterThan(0);

    // Default open list now sees it.
    const open = await getJson(router, "");
    expect(open.body.total).toBe(1);
    expect(open.body.tasks[0].title).toBe("Freshly created");

    // note_path filter on the new note returns it.
    const scoped = await getJson(router, "?note_path=notes/new.md");
    expect(scoped.body.total).toBe(1);

    // After flipping to closed it disappears from default but stays in status=all.
    repo.update(created.id, { status: "closed" });
    const openAfter = await getJson(router, "");
    expect(openAfter.body.total).toBe(0);
    const allAfter = await getJson(router, "?status=all");
    expect(allAfter.body.total).toBe(1);
  });
});
