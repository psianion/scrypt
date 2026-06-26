// tests/shared/date.test.ts
import { test, expect } from "bun:test";
import {
  isValidDayKey,
  nowIso,
  formatTime,
  formatEntryDateTime,
} from "../../src/shared/date";

test("isValidDayKey accepts YYYY-MM-DD only", () => {
  expect(isValidDayKey("2026-06-09")).toBe(true);
  expect(isValidDayKey("2026-6-9")).toBe(false);
  expect(isValidDayKey("nope")).toBe(false);
});

test("formatTime renders 12h UTC time from an ISO", () => {
  expect(formatTime("2026-06-09T15:00:23.000Z")).toBe("3:00 PM");
  expect(formatTime("2026-06-09T00:05:00.000Z")).toBe("12:05 AM");
});

test("formatEntryDateTime renders day + 12h time in UTC", () => {
  expect(formatEntryDateTime("2026-05-12T15:00:00.000Z")).toBe("2026-05-12 · 3:00 PM");
});

test("nowIso returns a Z-suffixed UTC ISO", () => {
  expect(nowIso()).toMatch(/Z$/);
});
