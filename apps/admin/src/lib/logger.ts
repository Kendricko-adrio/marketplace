import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Structured logger for the order flow.
 *
 * Every log line is a single JSON object so it can be ingested by a log
 * aggregator (Loki, Datadog, Vercel logs, …) and queried by `requestId` /
 * `orderId` / `module`. Each record carries:
 *
 *   - timestamp  — ISO-8601 UTC (date + time the action happened)
 *   - level      — debug | info | warn | error
 *   - requestId  — correlates all logs within one request
 *   - message    — human-readable description of the action
 *   - …context   — arbitrary structured fields (orderId, userId, status, …)
 *
 * `requestLogger(request)` honors an upstream `x-request-id` header so a
 * request can be traced across the edge → app → downstream calls; it
 * generates a fresh id otherwise. Bind request-scoped context with
 * `.child({ orderId })` — the child keeps the same `requestId`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  readonly [key: string]: unknown;
}

export interface Logger {
  readonly requestId: string;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a new logger with extra bound context (same requestId). */
  child(context: LogContext): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL =
  LEVELS[(process.env.LOG_LEVEL as LogLevel | undefined) ?? "info"] ??
  LEVELS.info;

function emit(
  level: LogLevel,
  requestId: string,
  message: string,
  bound: LogContext,
  context?: LogContext
): void {
  if (LEVELS[level] < MIN_LEVEL) return;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    requestId,
    message,
    ...bound,
    ...context,
  };
  // Serialize to a single line; fall back to the record if it contains a
  // non-JSON-serializable value (e.g. a thrown Error) so we never lose the log.
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ ...record, message: String(message) });
  }
  // Route to the console method matching the level so platform log filters work.
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

function makeLogger(requestId: string, bound: LogContext): Logger {
  return {
    requestId,
    debug: (m, c) => emit("debug", requestId, m, bound, c),
    info: (m, c) => emit("info", requestId, m, bound, c),
    warn: (m, c) => emit("warn", requestId, m, bound, c),
    error: (m, c) => emit("error", requestId, m, bound, c),
    child: (c) => makeLogger(requestId, { ...bound, ...c }),
  };
}

/** Create a standalone logger (e.g. for lib code not tied to a request). */
export function createLogger(context?: LogContext, requestId?: string): Logger {
  return makeLogger(requestId ?? randomUUID(), context ?? {});
}

/**
 * Build a logger bound to the incoming request. Honors an upstream
 * `x-request-id` header (so a request can be traced across the edge, the app,
 * and downstream calls); generates a fresh id otherwise.
 */
export function requestLogger(request: NextRequest, context?: LogContext): Logger {
  const incoming = request.headers.get("x-request-id")?.trim();
  return makeLogger(incoming || randomUUID(), context ?? {});
}

/**
 * Stamp a response with the request id so the client can reference it when
 * reporting an issue. Returns the same response for chaining.
 */
export function withRequestId<T extends NextResponse>(response: T, logger: Logger): T {
  response.headers.set("x-request-id", logger.requestId);
  return response;
}

/**
 * Serialize an unknown catch value into a plain object safe for structured
 * logging (preserves name/message/stack for Error, stringifies everything else).
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}