// Structured logging facade for the `@marketplace/db` CLI entry points.
//
// Same operator-facing contract as the app facades — `createModuleLogger`
// (declared once at module scope), `withExecutionContext` (one execution id per
// CLI run), structured JSON lines, and sanitized errors — implemented locally
// because this package compiles to CommonJS while the shared
// `@marketplace/logging` core is ESM-only. Recorded as a deviation in
// `.scratch/production-deployment/plan/first-production-deployment.md`.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type CliLogLevel = "debug" | "info" | "warn" | "error";

export interface CliModuleLogger {
  debug(message: string, error?: unknown): void;
  info(message: string, error?: unknown): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

const APP_LABEL = "db-cli";
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_STACK_LINES = 20;

const scope = new AsyncLocalStorage<{ executionId: string }>();

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]"],
  [/(password|passwd|token|authorization|secret|api[_-]?key)(["'\s:=]+)[^\s,&}"']+/gi, "$1$2[redacted]"],
  [/bearer\s+[a-z0-9._-]+/gi, "bearer [redacted]"],
];

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.slice(0, MAX_MESSAGE_LENGTH);
}

function projectError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message).slice(
        0,
        MAX_ERROR_MESSAGE_LENGTH
      ),
      stack: (error.stack ?? "")
        .split("\n")
        .slice(0, MAX_STACK_LINES)
        .map((line) => redactSensitiveText(line))
        .join("\n"),
    };
  }
  return { message: redactSensitiveText(String(error)).slice(0, MAX_ERROR_MESSAGE_LENGTH) };
}

function write(
  level: CliLogLevel,
  module: string,
  message: string,
  error?: unknown
): void {
  const active = scope.getStore();
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    app: APP_LABEL,
    requestId: null,
    module,
    message: redactSensitiveText(message),
  };
  if (active !== undefined) record.executionId = active.executionId;
  if (error !== undefined) record.error = projectError(error);

  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Logging must never break the operation it describes.
  }
}

/** Logger bound to one module name; create once at module scope. */
export function createModuleLogger(module: string): CliModuleLogger {
  return {
    debug: (message, error) => write("debug", module, message, error),
    info: (message, error) => write("info", module, message, error),
    warn: (message, error) => write("warn", module, message, error),
    error: (message, error) => write("error", module, message, error),
  };
}

/** Run a CLI entry as one execution scope. */
export function withExecutionContext<T>(work: () => T): T {
  return scope.run({ executionId: randomUUID() }, work);
}

/** Execution id of the active scope, null outside one. */
export function getExecutionId(): string | null {
  return scope.getStore()?.executionId ?? null;
}
