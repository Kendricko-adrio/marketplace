import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { adminRoleGrants, adminRoles, users } from "@/db";
import type { Grant, GrantScope, ModuleKey } from "@marketplace/db/src/rbac/catalog";
import { authorizeLoaded, type LoadedPolicy } from "./rbac/resolver";

// =========================================================
// Shared bounded admin command plumbing
// =========================================================
// Extracted from the discount administration module so every admin writer uses
// the SAME bounded execution and the SAME in-transaction Current Policy re-read
// (spec §9.2 lock order). Nothing here is a second permission model: the shape
// is exactly `LoadedPolicy`, so `authorizeLoaded` is reused unchanged.

/** Bounded execution (spec §9.2): 2s lock wait, 5s statement ceiling. */
export const ADMIN_LOCK_TIMEOUT_MS = 2000;
export const ADMIN_STATEMENT_TIMEOUT_MS = 5000;
export const ADMIN_LOCK_TIMEOUT = `${ADMIN_LOCK_TIMEOUT_MS}ms`;
export const ADMIN_STATEMENT_TIMEOUT = `${ADMIN_STATEMENT_TIMEOUT_MS}ms`;

/** Hard floor for a request-scoped timeout override (spec §6.4: never 0). */
export const ADMIN_MIN_TIMEOUT_MS = 100;

export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BoundedTransactionOptions {
  isolationLevel?: "read committed" | "repeatable read" | "serializable";
  /**
   * Override budget sisa request (mis. chunked price apply). SELALU di-clamp ke
   * default (2s/5s) dan minimal 100ms, lalu dibulatkan ke integer ms.
   */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}

function clampTimeoutMs(
  value: number | undefined | null,
  ceilingMs: number
): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return ceilingMs;
  }
  const rounded = Math.round(value);
  if (rounded < ADMIN_MIN_TIMEOUT_MS) return ADMIN_MIN_TIMEOUT_MS;
  return Math.min(rounded, ceilingMs);
}

/**
 * Run one short admin transaction with bounded lock/statement timeouts. `SET`
 * does not accept bind parameters, so the values are inlined from the internal
 * constants (never from request input). An override only ever SHORTENS the
 * budget below the defaults; it can never extend it.
 */
export async function beginBoundedTransaction<T>(
  run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  options: BoundedTransactionOptions = {}
): Promise<T> {
  const lockTimeoutMs = clampTimeoutMs(options.lockTimeoutMs, ADMIN_LOCK_TIMEOUT_MS);
  const statementTimeoutMs = clampTimeoutMs(
    options.statementTimeoutMs,
    ADMIN_STATEMENT_TIMEOUT_MS
  );
  return db.transaction(
    async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = '${lockTimeoutMs}ms'`));
      await tx.execute(
        sql.raw(`set local statement_timeout = '${statementTimeoutMs}ms'`)
      );
      return run(tx);
    },
    options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined
  );
}

/**
 * Re-read the acting Admin User + Role + grants INSIDE the transaction with
 * SHARE locks (actor first, then Role). A concurrent revoke either commits
 * before this read (and denies) or waits for this transaction to finish.
 */
export async function loadActorPolicyInTransaction(
  tx: Executor,
  userId: string
): Promise<LoadedPolicy | null> {
  const actorRows = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      branchId: users.branchId,
      roleId: users.roleId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .for("share")
    .limit(1);
  const actor = actorRows[0];
  if (!actor) return null;

  const roleRows = await tx
    .select({
      id: adminRoles.id,
      key: adminRoles.key,
      name: adminRoles.name,
      isSystem: adminRoles.isSystem,
      version: adminRoles.version,
      archivedAt: adminRoles.archivedAt,
    })
    .from(adminRoles)
    .where(eq(adminRoles.id, actor.roleId))
    .for("share")
    .limit(1);
  const role = roleRows[0];
  if (!role) return null;

  const grantRows = await tx
    .select({
      module: adminRoleGrants.module,
      action: adminRoleGrants.action,
      scope: adminRoleGrants.scope,
    })
    .from(adminRoleGrants)
    .where(eq(adminRoleGrants.roleId, role.id));

  return {
    user: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      isActive: actor.isActive,
      homeBranchId: actor.branchId,
    },
    role: {
      id: role.id,
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
      archived: role.archivedAt !== null,
      version: role.version,
      grants: grantRows.map(
        (row): Grant => ({
          module: row.module as Grant["module"],
          action: row.action as Grant["action"],
          scope: (row.scope ?? "global") as GrantScope,
        })
      ),
    },
    policyVersion: role.version,
  };
}

/**
 * Global modules are granted globally or not at all: the System Owner bypass
 * carries no grant rows, so the scope is asserted on the authorizer RESULT
 * instead of being passed as a required scope.
 */
export function hasGlobalGrant(
  loaded: LoadedPolicy | null,
  module: ModuleKey,
  action: "view" | "edit"
): boolean {
  if (!loaded) return false;
  const result = authorizeLoaded(loaded, module, action);
  return result.allowed && result.scope === "global";
}

/** Branch scope helper for the additional `products:view all_branches` gate. */
export function hasAllBranchProductView(loaded: LoadedPolicy | null): boolean {
  if (!loaded) return false;
  const result = authorizeLoaded(loaded, "products", "view");
  return result.allowed && result.scope === "all_branches";
}

/** PostgreSQL SQLSTATE dari error, menelusuri `cause` karena Drizzle membungkus
 * error driver di `DrizzleQueryError` (top-level tidak punya `.code`). */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Map PostgreSQL concurrency/timeout SQLSTATEs onto one retryable failure. */
export function isRetryableDatabaseError(error: unknown): boolean {
  const code = sqlStateOf(error);
  return code === "55P03" || code === "57014" || code === "40001" || code === "40P01";
}

/** Map a unique-violation SQLSTATE; callers decide the domain code. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === "23505";
}

