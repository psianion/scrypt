// src/server/ingest/kinds.ts
export const KINDS = [
  "thread",
  "research_run",
  "memory",
  "spec",
  "plan",
  "note",
  "log",
  "thought",
  "idea",
  "journal",
] as const;

export type Kind = (typeof KINDS)[number];

export function isValidKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function ymdhm(d: Date): string {
  return `${ymd(d)}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

export function destinationFor(kind: Kind, slug: string, now: Date): string {
  switch (kind) {
    case "thread":
      return `notes/threads/${slug}.md`;
    case "research_run":
      return `notes/research/${ymdhm(now)}-${slug}.md`;
    case "memory":
      return `memory/${slug}.md`;
    case "spec":
      return `docs/specs/${ymd(now)}-${slug}.md`;
    case "plan":
      return `docs/plans/${ymd(now)}-${slug}.md`;
    case "note":
      return `notes/inbox/${slug}.md`;
    case "log":
      return `notes/logs/${ymd(now)}-${slug}.md`;
    case "thought":
      return `notes/thoughts/${ymdhm(now)}-${slug}.md`;
    case "idea":
      return `notes/ideas/${slug}.md`;
    case "journal":
      return `journal/${ymd(now)}.md`;
  }
}
