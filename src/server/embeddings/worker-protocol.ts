//
// Shared message types for the embed worker. Both the parent
// (EmbedClient in client.ts) and the worker thread (worker.ts) import
// these and round-trip them via postMessage.
import type { ParsedStructural } from "../indexer/structural-parse";
import type { EmbeddingEvent } from "./progress";

export type WorkerInbound =
  | EmbedJobMessage
  | PrewarmMessage
  | ShutdownMessage;

export type WorkerOutbound =
  | EmbedDoneMessage
  | EmbedProgressMessage
  | WorkerErrorMessage
  | WorkerReadyMessage;

export interface EmbedJobMessage {
  type: "embed-note";
  requestId: string;
  parsed: ParsedStructural;
  correlationId: string;
}

export interface PrewarmMessage {
  type: "prewarm";
}

export interface ShutdownMessage {
  type: "shutdown";
}

export interface EmbedDoneMessage {
  type: "embed-done";
  requestId: string;
  chunksTotal: number;
  chunksEmbedded: number;
  embedMs: number;
  chunksSkipped: number;
}

export interface EmbedProgressMessage {
  type: "embed-progress";
  event: EmbeddingEvent;
}

export interface WorkerErrorMessage {
  type: "worker-error";
  requestId?: string;
  message: string;
  stack?: string;
}

export interface WorkerReadyMessage {
  type: "worker-ready";
  model: string;
}
