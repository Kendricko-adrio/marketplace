import { NextResponse, type NextRequest } from "next/server";

import { createModuleLogger } from "@/lib/logger";
import { guard, type PolicyContext } from "@/lib/rbac/guard";
import type { ActionKey, ModuleKey } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: declarative route-guard adapter
// =========================================================
// A thin adapter over the unified policy `guard` for routes whose handlers
// are declared with `withPermission`. It replaces the deleted legacy
// `@/lib/auth-guard` wrapper: authorization now resolves from the DB-backed
// Current Policy on every request, and success/failure is logged through
// the structured logger (denials are logged by the guard itself).
//
// - 401 without a session, 403 with a stable code for policy denials.
// - Handler success is logged `info`; unexpected handler failures are
//   logged `error` and answered 500.
//
// Logging contract: the module logger is created once here; the RBAC
// module/action label travels in the `message` and the request id comes from
// the active HTTP scope. No logger is taken from (or handed to) the guard.

const log = createModuleLogger("rbac");

/**
 * Static, module-owned projection for a failed handler. The caught value may
 * carry driver/provider free text, so it is never logged; the caller still gets
 * the same 500 envelope.
 */
class RbacRouteLogError extends Error {
  constructor(label: string) {
    super(`rbac route handler gagal (${label})`);
    this.name = "RbacRouteLogError";
  }
}

export type RouteContext = { params: Promise<Record<string, string>> };

export interface PolicyRouteContext {
  user: PolicyContext["user"];
  policy: PolicyContext["policy"];
}

type Handler = (
  ctx: PolicyRouteContext,
  request: NextRequest,
  routeCtx?: RouteContext
) => Promise<Response>;

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/**
 * Policy-guarded route wrapper. Every invocation resolves the session and
 * the Current Policy from the database; denials are 401/403 with stable
 * codes and a structured `warn` log (inside `guard`).
 */
export function withPermission(
  handler: Handler,
  module: ModuleKey,
  action: ActionKey
): (request: NextRequest, routeCtx?: RouteContext) => Promise<Response> {
  return async (request: NextRequest, routeCtx?: RouteContext) => {
    const guardResult = await guard(module, action);
    if (!guardResult.ok) return guardResult.response;
    const { ctx } = guardResult;
    const label = `${module}.${action}`;
    try {
      const response = await handler(
        { user: ctx.user, policy: ctx.policy },
        request,
        routeCtx as RouteContext | undefined
      );
      if (isResponse(response) && response.status < 400) {
        log.info(`${label} (outcome success)`);
      } else {
        log.warn(
          `${label}.client_error (outcome denied, status ${
            isResponse(response) ? response.status : "unknown"
          })`
        );
      }
      return response;
    } catch {
      log.error(`${label}.failure (outcome error)`, new RbacRouteLogError(label));
      return NextResponse.json(
        { success: false, error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
