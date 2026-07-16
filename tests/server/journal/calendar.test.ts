// tests/server/journal/calendar.test.ts
import { test, expect } from "bun:test";
import { setup } from "./api.test";

test("calendar returns per-day entry counts", async () => {
  const { router } = setup();
  await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "a" }),
    }),
  )!;
  await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "b" }),
    }),
  )!;
  const res = await router.handle(
    new Request("http://x/api/journal/calendar?from=2026-06-01&to=2026-06-30"),
  )!;
  const days = await res.json();
  const hit = days.find((d: any) => d.date === "2026-06-09");
  expect(hit.count).toBe(2);
});

test("calendar filters out days outside the from/to window", async () => {
  const { router } = setup();
  await router.handle(
    new Request("http://x/api/journal/2026-06-09/entries", {
      method: "POST",
      body: JSON.stringify({ body: "a" }),
    }),
  )!;
  const res = await router.handle(
    new Request("http://x/api/journal/calendar?from=2026-07-01&to=2026-07-31"),
  )!;
  const days = await res.json();
  expect(days.find((d: any) => d.date === "2026-06-09")).toBeUndefined();
});
