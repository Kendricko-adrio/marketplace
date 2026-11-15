import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { createModuleLogger } from "@/lib/logger";
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
//
// Logging contract (maintainable-code §7): one module-scoped logger, no logger
// or `requestId` is returned to the caller or threaded through the call chain.
// The RBAC resource/action and the acting ids travel in the `message`; the
// correlation id comes from the active HTTP scope opened by the route handler.
// Actor ids are internal identifiers — no name, email, session material or
// free-text denial reason is ever written.

const log = createModuleLogger("rbac");

/**
 * Static, module-owned projection for the unexpected path of this guard.
 *
 * An unexpected failure can come from the auth provider or the policy query,
 * so its message/stack may carry free text (connection strings, provider
 * bodies). The caught value is therefore never handed to a log line: this
 * constant projection is the only thing the `error` field receives, while the
 * caller still gets the identical 500 envelope it got before.
 */
class RbacGuardLogError extends Error {
  constructor() {
    super("rbac guard tidak dapat menyelesaikan permintaan");
    this.name = "RbacGuardLogError";
  }
}

export interface PolicyContext {
  user: LoadedPolicy["user"];
  policy: LoadedPolicy;
  /** Successful authorization result with the server-pinned scope. */
  authorization: AuthorizeResult & { allowed: true };
}

export type GuardResult =
  | { ok: true; ctx: PolicyContext }
  | { ok: false; response: NextResponse };

export interface GuardOptions {
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
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      log.warn(
        `rbac.auth.unauthenticated (resource ${module}, action ${action}, outcome denied)`
      );
      return {
        ok: false,
        response: jsonError(401, "UNAUTHENTICATED", "Unauthorized"),
      };
    }

    const mustResetPassword = Boolean(
      (session.user as { mustResetPassword?: boolean }).mustResetPassword
    );
    if (mustResetPassword) {
      log.warn(
        `rbac.auth.must_reset_password (resource ${module}, action ${action}, userId ${session.user.id}, outcome denied)`
      );
      return {
        ok: false,
        response: jsonError(
          403,
          "MUST_RESET_PASSWORD",
          "Password reset required"
        ),
      };
    }

    const loaded = await loadPolicy(session.user.id);
    if (!loaded) {
      log.warn(
        `rbac.policy_unresolvable (resource ${module}, action ${action}, userId ${session.user.id}, outcome denied)`
      );
      return {
        ok: false,
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
      log.warn(
        `rbac.admission_denied (resource ${module}, action ${action}, userId ${loaded.user.id}, roleId ${loaded.role.id}, reason ${admission.reason}, outcome denied)`
      );
      return {
        ok: false,
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
      log.warn(
        `rbac.authorization_denied (resource ${module}, action ${action}, userId ${loaded.user.id}, roleId ${loaded.role.id}, policyVersion ${loaded.policyVersion}, reason ${result.reason}, outcome denied)`
      );
      return {
        ok: false,
        response: jsonError(
          403,
          "DENIED",
          "You do not have access to this resource"
        ),
      };
    }

    return {
      ok: true,
      ctx: {
        user: loaded.user,
        policy: loaded,
        authorization: result,
      },
    };
  } catch {
    // The caught value is intentionally not inspected for logging: it may carry
    // provider/auth free text. The static projection keeps the line diagnosable
    // without exporting it.
    log.error(
      `rbac.guard_failure (resource ${module}, action ${action}, outcome error)`,
      new RbacGuardLogError()
    );
    return {
      ok: false,
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
export function crossBranchNotFound(): NextResponse {
  log.warn("rbac.object_not_found (reason cross_branch, outcome denied)");
  return jsonError(404, "NOT_FOUND", "Not found");
}
