import pino from "pino";

import { createLoggingContext } from "./context.js";
import { guardDestination } from "./destination.js";
import {
  createHttpRequestHandler,
  DEFAULT_HTTP_MODULE,
} from "./http-context.js";
import { redactSensitiveText } from "./redaction.js";
import { projectError } from "./safe-error.js";

/**
 * Core structured logging envelope (server-only).
 *
 * One JSON object per line, written to stdout by default. Pino is an
 * implementation detail of this package: callers never import it, never pass a
 * logger around, and never bind arbitrary business fields. The public shape is
 * the final contract in `plan/maintainable-code-and-contextual-logging.md` §6.3:
 *
 *   {"timestamp":"2026-10-23T08:30:45.123Z","level":"info","app":"store",
 *    "requestId":null,"module":"checkout-service",
 *    "message":"Order order-123 berhasil dibuat"}
 *
 * Fixed fields: `timestamp` (ISO-8601 UTC, milliseconds), `level` (string),
 * `app`, `requestId`, `module`, `message`. Business facts belong in `message`;
 * recognised sensitive values there are best-effort redacted, but callers still
 * owe safe summaries instead of raw payloads (see `redaction.ts`).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Minimal line sink (same shape as Pino's `DestinationStream`). Production
 * always writes to stdout; a sink is injectable only through the core factory
 * so the public seam can assert the emitted envelope.
 */
export interface LogDestination {
  write(line: string): void;
  /**
   * Optional failure channel of a stream-like sink (`process.stdout`, a custom
   * writable). When present, the core observes `error` once per physical
   * destination, because a closed pipe reports `EPIPE` asynchronously and an
   * unhandled `error` event would terminate the process. A plain write-only
   * sink simply omits it. The caller's `write` is never replaced.
   */
  on?(event: "error", listener: (error: unknown) => void): void;
}

export interface LoggingOptions {
  /** Owner of the runtime logger, emitted as the `app` field (`store` | `admin`). */
  app: string;
  /**
   * Minimum level. When omitted, `LOG_LEVEL` is used and `info` is the final
   * fallback (an unusable `LOG_LEVEL` is reported once by a startup warning).
   */
  level?: LogLevel;
  /** Line sink override for tests. Never passed to business functions. */
  destination?: LogDestination;
}

/**
 * Logger bound to one module name. A module logger is created once at module
 * scope; the module name is the only static binding it carries and arbitrary
 * bindings are not part of the public surface.
 *
 * Correlation fields are NOT bound at creation time: they are read from the
 * active scope on every emission, so a logger created before (or outside) a
 * request scope still writes the correct `requestId`.
 */
export interface ModuleLogger {
  /**
   * Each level accepts business facts in `message` and an optional thrown value
   * in `error`, which is normalised into the safe allowlisted `error` field.
   * A logging failure (serialisation or sink) never propagates to the caller.
   */
  trace(message: string, error?: unknown): void;
  debug(message: string, error?: unknown): void;
  info(message: string, error?: unknown): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
  fatal(message: string, error?: unknown): void;
}

export interface Logging {
  createModuleLogger(module: string): ModuleLogger;
  /**
   * Canonical `requestId` of the scope that is active right now, `null` outside
   * an HTTP scope. Read from the immutable active scope on every call: it is
   * never cached and never derived from an incoming `x-request-id` header.
   */
  getRequestId(): string | null;
  /**
   * Wraps a named HTTP handler as one request scope. Every argument is forwarded
   * unchanged (including a framework `context.params` promise), the returned
   * response carries `x-request-id`, and exactly one completion line is written:
   * `info` below 400, `warn` for 4xx, `error` from 500. A thrown value is logged
   * inside the scope and rethrown as the identical object — never replaced by a
   * fallback response.
   *
   * `module` names the completion log module (`http` by default). The module
   * logger is created once when the wrapper is created, not per request.
   */
  withRequestContext<Args extends unknown[]>(
    handler: (...args: Args) => Response | Promise<Response>,
    module?: string
  ): (...args: Args) => Promise<Response>;
  /**
   * Runs `work` as one server-generated HTTP request scope. Opens the scope
   * only at the HTTP entry point: helpers, repositories and provider adapters
   * called from inside an existing scope must not open another one.
   */
  runWithRequestContext<T>(work: () => T): T;
  /**
   * Runs `work` as a job/worker/CLI execution scope with its own `executionId`,
   * keeping the enclosing `requestId` when the job was triggered from HTTP.
   */
  runWithExecutionContext<T>(work: () => T): T;
  /**
   * Runs `work` as an independent job/listener scope: `requestId` is `null` and
   * the `executionId` is new, never the caller's.
   */
  runDetachedExecutionContext<T>(work: () => T): T;
}

const DEFAULT_LEVEL: LogLevel = "info";

const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

/** Module name used for the package's own startup diagnostics. */
const DIAGNOSTIC_MODULE = "logging";

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Logging must never break business flow: serialisation failures and sink
 * throws are swallowed here. Asynchronous sink failures — an `error` event such
 * as `EPIPE` from a closed pipe — never reach this frame, so they are
 * neutralised by the destination guard in `destination.ts` instead. There is no
 * retry and no fallback write: a retry against a broken sink would recurse, and
 * writing elsewhere could duplicate lines. Once a sink is down those lines are
 * lost, so delivery is not guaranteed.
 */
function failSafe(write: () => void): void {
  try {
    write();
  } catch {
    // Intentionally ignored.
  }
}

interface ResolvedLevel {
  level: LogLevel;
  /** `true` when `LOG_LEVEL` is set but unusable and the default is used. */
  invalidEnvValue: boolean;
}

/**
 * Level precedence: explicit factory option, then `LOG_LEVEL`, then `info`.
 * An explicit option ignores the env entirely (including an invalid one, which
 * then needs no diagnostic). An empty/whitespace-only env value counts as
 * unset; any other unrecognised value falls back to `info` and is reported once
 * by the caller without echoing the raw value.
 */
function resolveLevel(options: LoggingOptions): ResolvedLevel {
  if (options.level !== undefined) {
    return { level: options.level, invalidEnvValue: false };
  }

  const fromEnv = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (fromEnv === undefined || fromEnv.length === 0) {
    return { level: DEFAULT_LEVEL, invalidEnvValue: false };
  }

  return isLogLevel(fromEnv)
    ? { level: fromEnv, invalidEnvValue: false }
    : { level: DEFAULT_LEVEL, invalidEnvValue: true };
}

/**
 * Creates the single root logger for a runtime. Pino base bindings replace
 * `pid`/`hostname`, `messageKey` replaces `msg`, and the level formatter keeps
 * the human-readable severity label instead of the numeric default.
 *
 * Only `app` is static. Correlation fields come from the `mixin`, which Pino
 * invokes on every active write — including writes through child (module)
 * loggers — so `requestId`/`executionId` reflect the scope that is active at
 * that moment. `executionId` is added only while an execution scope is open, so
 * process-scope lines keep the fixed envelope.
 */
export function createLogging(options: LoggingOptions): Logging {
  const destination: LogDestination = guardDestination(
    options.destination ?? process.stdout
  );
  const context = createLoggingContext();
  const resolved = resolveLevel(options);

  const root = pino(
    {
      level: resolved.level,
      base: { app: options.app },
      mixin() {
        const scope = context.current();
        const requestId = scope?.requestId ?? null;
        return scope?.executionId === undefined
          ? { requestId }
          : { requestId, executionId: scope.executionId };
      },
      messageKey: "message",
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      // Pino splices this partial JSON into the line, so the leading comma is
      // required and the default `time` key never appears.
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    destination
  );

  if (resolved.invalidEnvValue) {
    // One startup diagnostic through the logging pipeline itself, never a raw
    // env dump: the value may contain caller-supplied text worth keeping out of
    // logs, and the logger must not throw or exit on bad configuration.
    failSafe(() => {
      root
        .child({ module: DIAGNOSTIC_MODULE })
        .warn(`LOG_LEVEL tidak valid; memakai default ${DEFAULT_LEVEL}`);
    });
  }

  const createModuleLogger = (module: string): ModuleLogger => {
    const moduleLogger = root.child({ module });

    const writers: Record<
      LogLevel,
      (bindings: object, message: string) => void
    > = {
      trace: (bindings, message) => moduleLogger.trace(bindings, message),
      debug: (bindings, message) => moduleLogger.debug(bindings, message),
      info: (bindings, message) => moduleLogger.info(bindings, message),
      warn: (bindings, message) => moduleLogger.warn(bindings, message),
      error: (bindings, message) => moduleLogger.error(bindings, message),
      fatal: (bindings, message) => moduleLogger.fatal(bindings, message),
    };

    const emit = (level: LogLevel, message: string, error?: unknown): void => {
      failSafe(() => {
        // A disabled level must not even read the thrown value: projecting for
        // a line that is never written could execute hostile getters.
        if (!moduleLogger.isLevelEnabled(level)) {
          return;
        }
        // `error` is always the safe projection, never the raw thrown object,
        // and an absent error keeps the fixed 6-field envelope. The message is
        // redacted here because business facts, not raw payloads, belong in it.
        const bindings =
          error === undefined ? {} : { error: projectError(error) };
        writers[level](bindings, redactSensitiveText(message));
      });
    };

    return {
      trace: (message, error) => {
        emit("trace", message, error);
      },
      debug: (message, error) => {
        emit("debug", message, error);
      },
      info: (message, error) => {
        emit("info", message, error);
      },
      warn: (message, error) => {
        emit("warn", message, error);
      },
      error: (message, error) => {
        emit("error", message, error);
      },
      fatal: (message, error) => {
        emit("fatal", message, error);
      },
    };
  };

  return {
    createModuleLogger,
    getRequestId(): string | null {
      // Read per call: the active scope is immutable metadata, so there is no
      // cache to invalidate and the value cannot drift from the lines written
      // in the same scope.
      return context.current()?.requestId ?? null;
    },
    withRequestContext<Args extends unknown[]>(
      handler: (...args: Args) => Response | Promise<Response>,
      module?: string
    ): (...args: Args) => Promise<Response> {
      return createHttpRequestHandler(
        handler,
        { context, createModuleLogger },
        module ?? DEFAULT_HTTP_MODULE
      );
    },
    runWithRequestContext<T>(work: () => T): T {
      return context.runWithRequestContext(work);
    },
    runWithExecutionContext<T>(work: () => T): T {
      return context.runWithExecutionContext(work);
    },
    runDetachedExecutionContext<T>(work: () => T): T {
      return context.runDetachedExecutionContext(work);
    },
  };
}
