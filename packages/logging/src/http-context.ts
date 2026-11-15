import type { LoggingContext } from "./context.js";
import type { ModuleLogger } from "./logger.js";

/**
 * HTTP entry-point wrapper for the logging core (server-only).
 *
 * `Logging.withRequestContext` binds one module logger plus this instance's
 * scope manager and delegates here, so `logger.ts` keeps owning the Pino
 * envelope only and the core stays framework-free: the wrapper depends on Web
 * standard `Request`/`Response` alone (no Next.js import), which makes the same
 * seam usable for route handlers, webhooks and HTTP cron entries.
 *
 * Contract (plan §6.4):
 *
 * - exactly one request scope per invocation, opened through the owning
 *   instance's `AsyncLocalStorage` scope manager — never a module-level global;
 * - the canonical response `x-request-id` is the same server-generated UUID as
 *   `requestId` on every line written inside that scope; an incoming
 *   `x-request-id` header is never trusted as canonical identity;
 * - status, body stream, cache headers, cookies and redirect semantics pass
 *   through untouched;
 * - a thrown value is logged once inside the scope and rethrown as the identical
 *   object: no replacement response and no swallowed framework control-flow
 *   exception.
 */

/** Response header carrying the canonical request id. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Completion module used when `withRequestContext` is called without one. */
export const DEFAULT_HTTP_MODULE = "http";

/**
 * Method label used when an invocation carries no readable `Request` (a handler
 * may be declared without arguments while the framework still calls it with
 * runtime arguments).
 */
const UNKNOWN_METHOD = "HTTP";

/**
 * Dependencies the core composition injects: the scope manager and the module
 * logger factory of the same `createLogging` instance. Business code never
 * receives these — they exist only so the HTTP mechanism can reuse the
 * instance's context instead of a package-level singleton.
 */
export interface HttpRequestContextDeps {
  readonly context: LoggingContext;
  createModuleLogger(module: string): ModuleLogger;
}

/**
 * Completion level by response status: an expected 4xx outcome is a warning,
 * only a server-side failure is an error (plan §7.6).
 */
function completionLevel(status: number): "info" | "warn" | "error" {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

function isRequest(value: unknown): value is Request {
  return value instanceof Request;
}

/**
 * Method of the invocation's `Request`, read without touching the URL, query,
 * body or headers. Arguments are forwarded verbatim (including a framework
 * `context.params` promise), so the request is looked up instead of assumed to
 * be the first argument.
 */
function readMethod(args: readonly unknown[]): string {
  for (const arg of args) {
    if (isRequest(arg)) {
      return arg.method;
    }
  }
  return UNKNOWN_METHOD;
}

/** One completion line: method plus status, never a raw URL or payload. */
function logCompletion(
  log: ModuleLogger,
  method: string,
  status: number
): void {
  const message = `${method} ${status}`;
  const level = completionLevel(status);
  if (level === "error") {
    log.error(message);
    return;
  }
  if (level === "warn") {
    log.warn(message);
    return;
  }
  log.info(message);
}

/**
 * Returns a response carrying the canonical request id.
 *
 * A normal response has mutable headers, so the header is stamped in place: the
 * handler's status, header list (including repeated `Set-Cookie`) and body
 * stream stay exactly as produced. Guarded-immutable headers — the ones from
 * `Response.redirect()` and filtered `fetch()` responses reject every mutation
 * with a `TypeError` — are handled by rebuilding the response from a mutable
 * copy of its header list, which also preserves every `Set-Cookie` value.
 *
 * The body is handed over as a stream reference only: it is never read,
 * decoded, cloned or buffered here, so `bodyUsed` stays `false` and streaming
 * responses keep working.
 */
function withRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/**
 * Builds the wrapped handler: the module logger is created once here, at wrap
 * time, while the request scope is opened per invocation. Arguments are
 * forwarded unchanged, the handler and the completion line run in the same
 * scope, and the enclosing caller context is restored automatically when the
 * scope callback settles.
 */
export function createHttpRequestHandler<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
  deps: HttpRequestContextDeps,
  module: string
): (...args: Args) => Promise<Response> {
  const log = deps.createModuleLogger(module);

  return (...args: Args): Promise<Response> =>
    deps.context.runWithRequestContext(async (): Promise<Response> => {
      const requestId = deps.context.current()?.requestId;
      if (requestId === undefined || requestId === null) {
        // Unreachable: the scope was opened synchronously above. Reported
        // instead of inventing an id outside the scope manager.
        throw new Error("Scope request HTTP tidak aktif");
      }

      const method = readMethod(args);

      let response: Response;
      try {
        response = await handler(...args);
      } catch (error) {
        // Safe projection, written inside the scope so the failure line keeps
        // this request's requestId. The value itself is rethrown untouched.
        log.error(`${method} gagal diproses`, error);
        throw error;
      }

      logCompletion(log, method, response.status);
      return withRequestIdHeader(response, requestId);
    });
}
