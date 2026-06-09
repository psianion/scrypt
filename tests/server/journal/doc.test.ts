// tests/server/journal/doc.test.ts
import { test, expect } from "bun:test";
import {
  parseJournalDoc,
  serializeJournalDoc,
  appendEntry,
  type JournalEntry,
} from "../../../src/server/journal/doc";

const SAMPLE = `---
title: "2026-06-09"
kind: journal
tags:
  - journal
  - daily
---

# 2026-06-09

## 2026-06-09T15:00:00.000Z

thought one

## 2026-06-09T17:30:00.000Z

thought two
`;

test("parseJournalDoc returns ordered entries keyed by their UTC ISO id", () => {
  const doc = parseJournalDoc("2026-06-09", SAMPLE);
  expect(doc.entries.map((e) => e.id)).toEqual([
    "2026-06-09T15:00:00.000Z",
    "2026-06-09T17:30:00.000Z",
  ]);
  expect(doc.entries[0]).toEqual({
    id: "2026-06-09T15:00:00.000Z",
    displayTime: "3:00 PM",
    body: "thought one",
  });
});

test("same-minute entries stay distinct via sub-minute ISO ids (no collision logic)", () => {
  const two =
    `# 2026-06-09\n\n## 2026-06-09T15:00:11.000Z\n\na\n\n## 2026-06-09T15:00:47.000Z\n\nb\n`;
  const doc = parseJournalDoc("2026-06-09", `---\ntitle: x\n---\n\n${two}`);
  expect(doc.entries.map((e) => e.id)).toEqual([
    "2026-06-09T15:00:11.000Z",
    "2026-06-09T15:00:47.000Z",
  ]);
});

test("serialize round-trips parse (stable)", () => {
  const doc = parseJournalDoc("2026-06-09", SAMPLE);
  const out = serializeJournalDoc(doc);
  expect(parseJournalDoc("2026-06-09", out).entries).toEqual(doc.entries);
});

test("appendEntry inserts in chronological (id) order", () => {
  const doc = parseJournalDoc("2026-06-09", SAMPLE);
  const next = appendEntry(doc, "2026-06-09T16:00:00.000Z", "thought middle");
  expect(next.entries.map((e) => e.id)).toEqual([
    "2026-06-09T15:00:00.000Z",
    "2026-06-09T16:00:00.000Z",
    "2026-06-09T17:30:00.000Z",
  ]);
});
