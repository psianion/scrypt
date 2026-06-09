// src/shared/date.ts
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(utc);
dayjs.extend(customParseFormat);

export const DAY_FMT = "YYYY-MM-DD";
export const TIME_FMT = "h:mm A";

/** Current UTC day key, e.g. "2026-06-09". */
export function todayKey(): string {
  return dayjs.utc().format(DAY_FMT);
}

/** Current instant as a UTC ISO string — the canonical entry id/timestamp. */
export function nowIso(): string {
  return dayjs.utc().toISOString();
}

/** Strict YYYY-MM-DD validation (needs customParseFormat). */
export function isValidDayKey(s: string): boolean {
  return dayjs.utc(s, DAY_FMT, true).isValid();
}

/** Render a UTC ISO as a 12h time, e.g. "3:00 PM". */
export function formatTime(iso: string): string {
  return dayjs.utc(iso).format(TIME_FMT);
}

/** Render a UTC ISO as "YYYY-MM-DD · h:mm A". */
export function formatEntryDateTime(iso: string): string {
  return dayjs.utc(iso).format(`${DAY_FMT} · ${TIME_FMT}`);
}

/** Render a day key (YYYY-MM-DD) as a human heading, e.g. "Tuesday, June 9, 2026". */
export function formatDayHeading(dayKey: string): string {
  return dayjs.utc(dayKey, DAY_FMT, true).format("dddd, MMMM D, YYYY");
}
