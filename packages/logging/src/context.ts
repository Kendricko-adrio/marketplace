import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Correlation metadata resolved at log-emission time.
 *
 * A scope object is created once per scope and never mutated, so a logger that
 * was created before the scope existed still reads the correct values when it
 * writes a line. Instances are frozen: a scope is immutable metadata, not a
 * mutable bag of bindings.
 */
export interface LogContext {
  /** Server-generated UUID for the HTTP request scope; `null` outside HTTP. */
  readonly requestId: string | null;
  /**
   * Server-generated UUID for a job/worker/CLI scope. Present only while an
   * execution scope is active: process-scope logs never carry a fake ID.
   */
  readonly executionId?: string;
}

/**
 * Scope manager owned by one `createLogging` instance. `AsyncLocalStorage` is
 * used (never `enterWith`) so concurrent scopes stay isolated. The enclosing
 * caller context is restored when the scope callback returns, including across
 * `await` boundaries.
 *
 * Note: `AsyncLocalStorage` does not cancel async resources on scope exit.
 * Resources created inside the scope (timers, sockets, listeners, queue work)
 * keep inheriting that context. Background work that outlives the scope — a
 * singleton listener created during the first request, for example — must open
 * its own execution scope instead of reusing the request context.
 */
export interface LoggingContext {
  /**
   * Runs `work` as the current HTTP request scope. The scope is propagated
   * across the async resources created inside the callback, its return value is
   * passed through untouched, and the enclosing caller context is restored
   * afterwards.
   */
  runWithRequestContext<T>(work: () => T): T;
  /**
   * Runs `work` as a job/worker/CLI execution scope: a new `executionId` is
   * created once for the scope while the enclosing `requestId` (if the job was
   * triggered from an HTTP entry, e.g. an HTTP cron) is preserved.
   */
  runWithExecutionContext<T>(work: () => T): T;
  /**
   * Runs `work` as an execution scope that must not inherit the caller's
   * correlation: `requestId` is `null` and `executionId` is new. Used by
   * independent jobs and background listeners created during a request.
   */
  runDetachedExecutionContext<T>(work: () => T): T;
  /** Scope active right now, `undefined` outside every scope. */
  current(): LogContext | undefined;
}

export function createLoggingContext(): LoggingContext {
  const storage = new AsyncLocalStorage<LogContext>();

  return {
    runWithRequestContext<T>(work: () => T): T {
      const scope: LogContext = Object.freeze({ requestId: randomUUID() });
      return storage.run(scope, work);
    },
    runWithExecutionContext<T>(work: () => T): T {
      const scope: LogContext = Object.freeze({
        requestId: storage.getStore()?.requestId ?? null,
        executionId: randomUUID(),
      });
      return storage.run(scope, work);
    },
    runDetachedExecutionContext<T>(work: () => T): T {
      const scope: LogContext = Object.freeze({
        requestId: null,
        executionId: randomUUID(),
      });
      return storage.run(scope, work);
    },
    current(): LogContext | undefined {
      return storage.getStore();
    },
  };
}
