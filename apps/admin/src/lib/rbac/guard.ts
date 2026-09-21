import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import {
  createLogger,
  requestLogger,
  serializeError,
  type Logger,
} from "@/lib/logger";
import {
  admissionDecision,
  authorizeLoaded,
  loadPolicy,
  type LoadedPolicy,
} from "./resolver";
import type { AuthorizeResult } from "@marketplace/db/src/rbac/policy";
import type { BranchScope } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: unified guard for admin API routes
// =========================================================
// Every policy-protected route seam uses this guard: 401 for a missing
// session, 403 with a stable code for admission/authorization denials,
// structured `warn` logs for contextual denials and `error` logs for
// unexpected failures. Cross-branch object IDs are mapped to 404 via
// `objectScopeViolation` so they do not disclose existence.

export interface PolicyContext {
  user: LoadedPolicy["user"];
  policy: LoadedPolicy;
  /** Successful authorization result with the server-pinned scope. */
  authorization: AuthorizeResult & { allowed: true };
}

export type GuardResult =
  | { ok: true; ctx: PolicyContext; logger: Logger }
  | { ok: false; response: NextResponse; logger: Logger };

export interface GuardOptions {
  /** Incoming request for request-scoped structured logging. */
  request?: NextRequest;
  /** Require a specific scope (e.g. edit-all for global re-sync). */
  requiredScope?: BranchScope | "global";
}

function jsonError(
  status: number,
  code: string,
  error: string
): NextResponse {
  return NextResponse.json(
    { success: false, error, code },
    { status }
  );
}

/**
 * Authorize the current session against the Current Policy for one
 * module/action. Reads the session and the DB-backed policy on every call.
 */
export async function guard(
  module: Parameters<typeof authorizeLoaded>[1],
  action: Parameters<typeof authorizeLoaded>[2],
  options: GuardOptions = {}
): Promise<GuardResult> {
  const logger = options.request
    ? requestLogger(options.request, { module, action })
    : createLogger({ module, action });

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      logger.warn("auth.unauthenticated", { outcome: "denied" });
      return {
        ok: false,
        logger,
        response: jsonError(401, "UNAUTHENTICATED", "Unauthorized"),
      };
    }

    const mustResetPassword = Boolean(
      (session.user as { mustResetPassword?: boolean }).mustResetPassword
    );
    if (mustResetPassword) {
      logger.warn("auth.must_reset_password", {
        outcome: "denied",
        userId: session.user.id,
      });
      return {
        ok: false,
        logger,
        response: jsonError(
          403,
          "MUST_RESET_PASSWORD",
          "Password reset required"
        ),
      };
    }

    const loaded = await loadPolicy(session.user.id);
    if (!loaded) {
      logger.warn("rbac.policy_unresolvable", {
        outcome: "denied",
        userId: session.user.id,
      });
      return {
        ok: false,
        logger,
        response: jsonError(
          403,
          "NO_ACCESS",
          "You do not have access to this resource"
        ),
      };
    }

    const admission = admissionDecision({
      isActive: loaded.user.isActive,
      roleId: loaded.role.id,
      roleExists: true,
      roleArchived: loaded.role.archived,
    });
    if (!admission.admitted) {
      logger.warn("rbac.admission_denied", {
        outcome: "denied",
        userId: loaded.user.id,
        roleId: loaded.role.id,
        reason: admission.reason,
      });
      return {
        ok: false,
        logger,
        response: jsonError(
          403,
          "NO_ACCESS",
          "You do not have access to this resource"
        ),
      };
    }

    const result = authorizeLoaded(
      loaded,
      module,
      action,
      options.requiredScope
    );
    if (!result.allowed) {
      logger.warn("rbac.authorization_denied", {
        outcome: "denied",
        userId: loaded.user.id,
        roleId: loaded.role.id,
        policyVersion: loaded.policyVersion,
        reason: result.reason,
      });
      return {
        ok: false,
        logger,
        response: jsonError(
          403,
          "DENIED",
          "You do not have access to this resource"
        ),
      };
    }

    return {
      ok: true,
      logger,
      ctx: {
        user: loaded.user,
        policy: loaded,
        authorization: result,
      },
    };
  } catch (error) {
    logger.error("rbac.guard_failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return {
      ok: false,
      logger,
      response: jsonError(500, "INTERNAL", "Internal server error"),
    };
  }
}

/**
 * Object-scope check: for own-branch scope the object must belong to the
 * server-pinned Home Branch; a missing/other branch is a cross-branch
 * reference (mapped to 404 so existence is not disclosed). All-branch and
 * global scope impose no branch restriction.
 */
export function objectScopeViolation(
  authorization:
    | { allowed: true; scope: "own_branch" | "all_branches" | "global"; homeBranchId?: string }
    | { allowed: false },
  objectBranchId: string | null | undefined
): "cross_branch" | null {
  if (!authorization.allowed) return null;
  if (authorization.scope === "own_branch") {
    return objectBranchId && objectBranchId === authorization.homeBranchId
      ? null
      : "cross_branch";
  }
  return null;
}

/** 404 response for cross-branch object references (never discloses existence). */
export function crossBranchNotFound(logger: Logger): NextResponse {
  logger.warn("rbac.object_not_found", {
    outcome: "denied",
    reason: "cross_branch",
  });
  return jsonError(404, "NOT_FOUND", "Not found");
}