import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestEnv } from "../../helpers";
import { parseFrontmatter } from "../../../src/server/parsers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Open SVE2 question",
    content: "# Open",
    frontmatter: { status: "open", priority: 2 },
  });
  await env.app.ingestRouter.ingest({
    kind: "thread",
    title: "Resolved old thing",
    content: "# Done",
    frontmatter: { status: "resolved", priority: 0 },
  });
  await Bun.sleep(200);
  await env.app.indexer.fullReindex();
});
afterAll(async () => {
  await env.cleanup();
});

describe("GET /api/threads", () => {
  test("returns all threads when no filter", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=open`);
    const data = await res.json();
    expect(data.every((t: any) => t.status === "open")).toBe(true);
  });

  test("filters by comma-separated statuses", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads?status=open,resolved`,
    );
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by priority", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?priority=2`);
    const data = await res.json();
    expect(data.every((t: any) => t.priority >= 2)).toBe(true);
  });
});

describe("GET /api/threads/:slug", () => {
  test("returns full thread with content", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/open-sve2-question`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slug).toBe("open-sve2-question");
    expect(data.status).toBe("open");
    expect(data.content).toContain("Open");
  });

  test("returns 404 for unknown slug", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads/nope`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/threads/:slug", () => {
  test("updates status and run_count", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in-progress", run_count: 5 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await (
      await fetch(`${env.baseUrl}/api/threads/open-sve2-question`)
    ).json();
    expect(updated.status).toBe("in-progress");
    expect(updated.run_count).toBe(5);
  });

  test("rejects unknown fields with 400", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evil: "yes" }),
      },
    );
    expect(res.status).toBe(400);
  });

  test("rejects client-supplied modified/created timestamps via whitelist", async () => {
    await env.app.ingestRouter.ingest({
      kind: "thread",
      title: "ts bypass target",
      content: "# orig",
      frontmatter: { status: "open", priority: 1 },
    });
    const slug = "ts-bypass-target";
    const beforeRes = await fetch(`${env.baseUrl}/api/threads/${slug}`);
    const before = await beforeRes.json();
    const originalStatus = before.status;
    const originalCreated = before.created;

    const res = await fetch(`${env.baseUrl}/api/threads/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modified: "1999-01-01T00:00:00Z",
        created: "1999-01-01T00:00:00Z",
        status: "resolved",
      }),
    });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(["modified", "created"]).toContain(err.field);

    const afterRes = await fetch(`${env.baseUrl}/api/threads/${slug}`);
    const after = await afterRes.json();
    expect(after.status).toBe(originalStatus);
    expect(after.created).toBe(originalCreated);
    expect(after.created).not.toBe("1999-01-01T00:00:00Z");
    expect(after.modified).not.toBe("1999-01-01T00:00:00Z");
    expect(new Date(after.modified).getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  });

  test("valid PATCH bumps modified but preserves created", async () => {
    await env.app.ingestRouter.ingest({
      kind: "thread",
      title: "valid patch target",
      content: "# orig",
      frontmatter: { status: "open", priority: 1 },
    });
    const slug = "valid-patch-target";
    const beforeRes = await fetch(`${env.baseUrl}/api/threads/${slug}`);
    const before = await beforeRes.json();
    const beforeModified = before.modified as string;
    const beforeCreated = before.created as string;

    await Bun.sleep(20);
    const res = await fetch(`${env.baseUrl}/api/threads/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(200);

    const fullPath = join(env.vaultPath, `notes/threads/${slug}.md`);
    const raw = readFileSync(fullPath, "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("resolved");
    expect(frontmatter.created).toBe(beforeCreated);
    expect(frontmatter.created).not.toBe("1999-01-01T00:00:00Z");
    expect(
      (frontmatter.modified as string) > beforeModified,
    ).toBe(true);
  });

  test("returns 400 for malformed JSON body", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/threads/open-sve2-question`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/threads status validation", () => {
  test("accepts a whitelisted status", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=open`);
    expect(res.status).toBe(200);
  });

  test("rejects a bogus status with 400 field=status", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=bogus`);
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.field).toBe("status");
  });

  test("rejects a partially-bogus comma-separated status with 400", async () => {
    const res = await fetch(`${env.baseUrl}/api/threads?status=open,bogus`);
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.field).toBe("status");
  });
});
