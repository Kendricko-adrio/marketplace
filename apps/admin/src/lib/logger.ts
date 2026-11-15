import { createLogging } from "@marketplace/logging";
import type {
  Logging as CoreLogging,
  ModuleLogger as CoreModuleLogger,
} from "@marketplace/logging";

/**
 * Structured logging facade for the **admin** runtime.
 *
 * This module is the app-scoped layer over `@marketplace/logging` — the single
 * internal wrapper that owns Pino. It exports exactly one API surface:
 * `createModuleLogger`, `withRequestContext`, `getRequestId`,
 * `withExecutionContext`, `withDetachedExecutionContext`. One root instance per
 * app runtime, one child logger per module, and `requestId`/`executionId` read
 * from the active `AsyncLocalStorage` scope on every emission (never bound at
 * creation time).
 *
 * Rules for every call site: call `createModuleLogger` once at module scope,
 * never funnel a `logger` or `requestId` parameter (or a request object) through
 * a service/repository just for logging, and never add arbitrary bindings —
 * business facts belong in the `message`, correlation fields come from the
 * active scope.
 *
 * The previous custom engine (`createLogger`, `requestLogger`, `withRequestId`,
 * `serializeError`, free-form context bindings, per-call UUID fallback) was
 * removed once every call site migrated; `packages/logging/src/policy.test.ts`
 * guards against reintroducing it.
 */

if (typeof window !== "undefined") {
  // Fail fast rather than shipping a logger that cannot work: the core reads
  // Node builtins (`node:async_hooks`, `node:crypto`) and writes to stdout, so a
  // browser import is an authoring/build mistake. This is a runtime guard only;
  // a compile-time server boundary would need a framework-level import such as
  // `server-only`, which is deliberately not added here because it throws in
  // plain Node (CLI scripts and unit tests import this module).
  throw new Error(
    "lib/logger hanya untuk runtime server (admin): jangan diimpor dari client component"
  );
}

// ───────────────────── Application facade over @marketplace/logging ──────────

/** Value of the `app` field on every line written by this runtime. */
const APP_LABEL = "admin";

/**
 * Member this module adds to the runtime global.
 *
 * Next.js evaluates a module more than once (dev HMR, separate route-module
 * graphs), so a module-local singleton can create a second Pino root and a
 * second `AsyncLocalStorage`; a scope opened through one instance would then be
 * invisible to a logger built from the other. Memoising the instance on the
 * global keeps exactly one owner per app runtime.
 *
 * Only the instance is cached. A `requestId` is never stored here — it is read
 * from the active scope on every emission — and the member name is app-specific,
 * so a process hosting both apps never shares one root.
 */
interface RootLoggingRegistry {
  marketplaceLoggingAdminRoot?: CoreLogging;
}

/**
 * Returns this runtime's root logging instance, creating it on first evaluation.
 *
 * The single assertion below describes the global member this file adds: the
 * intersection keeps every existing global member typed, and no `any` or
 * `as unknown as` escape hatch is used.
 */
function resolveRootLogging(): CoreLogging {
  const registry = globalThis as typeof globalThis & RootLoggingRegistry;
  const cached = registry.marketplaceLoggingAdminRoot;
  if (cached !== undefined) {
    return cached;
  }
  const created = createLogging({ app: APP_LABEL });
  registry.marketplaceLoggingAdminRoot = created;
  return created;
}

/**
 * Root instance of this runtime, created once when the module is evaluated. The
 * destination is resolved when a line is written, not at import time, and the
 * root is never created per function or per request.
 */
const rootLogging = resolveRootLogging();

/**
 * Logger bound to one module name. Create it once at module scope; correlation
 * fields are resolved per emission, so a logger created before (or outside) a
 * request scope still writes the active `requestId`.
 */
export function createModuleLogger(module: string): CoreModuleLogger {
  return rootLogging.createModuleLogger(module);
}

/**
 * Wraps an HTTP handler as one request scope (route handler, webhook, HTTP
 * cron). Arguments — including a framework `params` promise — are forwarded
 * untouched, the response carries `x-request-id`, and a thrown value is logged
 * inside the scope and rethrown as the identical object.
 */
export function withRequestContext<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
  module?: string
): (...args: Args) => Promise<Response> {
  return rootLogging.withRequestContext(handler, module);
}

/** Canonical `requestId` of the active scope, `null` outside an HTTP scope. */
export function getRequestId(): string | null {
  return rootLogging.getRequestId();
}

/**
 * Runs `work` as a job/worker/CLI execution scope (alias of the core
 * `runWithExecutionContext`): a new `executionId`, keeping the enclosing
 * `requestId` when the job was triggered from HTTP.
 */
export function withExecutionContext<T>(work: () => T): T {
  return rootLogging.runWithExecutionContext(work);
}

/**
 * Runs `work` as an independent job/listener scope (alias of the core
 * `runDetachedExecutionContext`): `requestId` is `null` and the `executionId` is
 * new, never the caller's.
 */
export function withDetachedExecutionContext<T>(work: () => T): T {
  return rootLogging.runDetachedExecutionContext(work);
}
