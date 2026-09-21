import { randomUUID } from "crypto";

import { and, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { adminRoleGrants, adminRoles, users } from "@/db";
import {
  checkGrantCoverage,
  classifyGrantSet,
  isBranchModule,
  normalizeRoleName,
  roleNameNormalizedSql,
  SYSTEM_OWNER_KEY,
  validateGrants,
  validateRoleName,
  type Grant,
  type GrantScope,
} from "@marketplace/db/src/rbac/catalog";
import { grantDiff, withinCeiling, type GrantDiff } from "@marketplace/db/src/rbac/policy";
import { writeAuditEvent } from "./audit-writer";
import {
  planArchive,
  planRevision,
  type ArchiveInput,
  type PlannerActor,
  type PlannerRole,
} from "./roles-planner";
import type { LoadedPolicy } from "./resolver";

// =========================================================
// RBAC: Roles service (DB-backed)
// =========================================================
// Every mutation runs in one DB transaction: lock/re-read the Role row
// (SELECT … FOR UPDATE), check the expected optimistic version, validate the
// complete draft through the pure planner, replace the full grant set, bump
// the version, and write an immutable audit event before commit.
// Unique-constraint and lock races are converted into stable 409 responses.

export interface ActorContext {
  userId: string;
  isOwner: boolean;
  /** The actor's own effective grants (their authorization ceiling). */
  grants: Grant[];
  /** Role assigned to the actor (self-role protection). */
  roleId: string | null;
  /** Policy version in force for the actor when acting. */
  policyVersion: number;
}

export function buildActorContext(
  userId: string,
  policy: LoadedPolicy
): ActorContext {
  return {
    userId,
    isOwner: policy.role.key === SYSTEM_OWNER_KEY,
    grants: policy.role.grants,
    roleId: policy.role.id,
    policyVersion: policy.policyVersion,
  };
}

export class RoleServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// =========================================================
// Stable mapping of Postgres constraint races
// =========================================================
// Unique/check constraint violations that survive the in-transaction
// pre-checks (a concurrent duplicate insert can lose the race after the
// check passed) are converted into stable 409/400 responses instead of 500.
const NAME_UNIQUE_CONSTRAINT = "admin_role_name_normalized_unique";
const GRANT_TUPLE_UNIQUE_CONSTRAINT = "admin_role_grant_tuple_unique";

export function mapConstraintError(error: unknown): RoleServiceError | null {
  const code = (error as { code?: string } | null)?.code;
  const constraint = (
    error as { constraint?: string | null } | null
  )?.constraint;
  if (code === "23505") {
    if (constraint === NAME_UNIQUE_CONSTRAINT) {
      return new RoleServiceError(
        409,
        "DUPLICATE_NAME",
        "Role Name already in use"
      );
    }
    if (constraint === GRANT_TUPLE_UNIQUE_CONSTRAINT) {
      return new RoleServiceError(
        400,
        "INVALID_GRANTS",
        "Duplicate grant rows are not allowed"
      );
    }
    return new RoleServiceError(
      409,
      "CONFLICT",
      "The resource was modified concurrently"
    );
  }
  if (code === "23514") {
    return new RoleServiceError(
      400,
      "INVALID_GRANTS",
      "Grant set violates the database constraints"
    );
  }
  return null;
}

/** Run `run`, converting surviving constraint races into stable errors. */
async function withConstraintMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RoleServiceError) throw error;
    const mapped = mapConstraintError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

export interface RoleGrantRow {
  module: string;
  action: string;
  scope: GrantScope;
}

export interface RoleDetail {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  archived: boolean;
  archivedAt: Date | null;
  version: number;
  userCount: number;
  activeUserCount: number;
  grants: RoleGrantRow[];
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const GRANT_COLUMNS = {
  module: adminRoleGrants.module,
  action: adminRoleGrants.action,
  scope: adminRoleGrants.scope,
};

function toGrant(row: {
  module: string;
  action: string;
  scope: string | null;
}): Grant {
  return {
    module: row.module as Grant["module"],
    action: row.action as Grant["action"],
    scope: (row.scope ?? "global") as GrantScope,
  };
}

function toRoleDetail(
  row: typeof adminRoles.$inferSelect,
  grants: RoleGrantRow[],
  userCount: number,
  activeUserCount: number
): RoleDetail {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    version: row.version,
    userCount,
    activeUserCount,
    grants,
  };
}

async function loadGrants(executor: Executor, roleIds: readonly string[]) {
  if (roleIds.length === 0) return new Map<string, RoleGrantRow[]>();
  const rows = await executor
    .select({ roleId: adminRoleGrants.roleId, ...GRANT_COLUMNS })
    .from(adminRoleGrants)
    .where(inArray(adminRoleGrants.roleId, [...roleIds]));
  const map = new Map<string, RoleGrantRow[]>();
  for (const row of rows) {
    const list = map.get(row.roleId) ?? [];
    list.push({
      module: row.module,
      action: row.action,
      scope: (row.scope ?? "global") as GrantScope,
    });
    map.set(row.roleId, list);
  }
  return map;
}

async function loadUserCounts(
  executor: Executor,
  roleIds: readonly string[]
): Promise<Map<string, { userCount: number; activeUserCount: number }>> {
  const map = new Map<
    string,
    { userCount: number; activeUserCount: number }
  >();
  if (roleIds.length === 0) return map;
  const rows = await executor
    .select({
      roleId: users.roleId,
      userCount: sql<number>`count(*)::int`,
      activeUserCount: sql<number>`count(*) filter (where ${users.isActive})::int`,
    })
    .from(users)
    .where(inArray(users.roleId, [...roleIds]))
    .groupBy(users.roleId);
  for (const row of rows) {
    if (row.roleId) {
      map.set(row.roleId, {
        userCount: row.userCount,
        activeUserCount: row.activeUserCount,
      });
    }
  }
  return map;
}

/** Case-insensitive uniqueness predicate on the normalized Role Name. */
function normalizedNameCondition(name: string) {
  return sql`${roleNameNormalizedSql(adminRoles.name)} = ${normalizeRoleName(name)}`;
}

// =========================================================
// Queries
// =========================================================

export async function listRoles(opts: {
  q?: string;
  archived?: boolean;
}): Promise<RoleDetail[]> {
  const conditions = [];
  if (opts.archived === true) {
    conditions.push(sql`${adminRoles.archivedAt} is not null`);
  } else {
    // Default excludes archived Roles; an explicit filter shows them.
    conditions.push(isNull(adminRoles.archivedAt));
  }
  if (opts.q && opts.q.trim() !== "") {
    conditions.push(ilike(adminRoles.name, `%${opts.q.trim()}%`));
  }

  const rows = await db
    .select()
    .from(adminRoles)
    .where(and(...conditions))
    .orderBy(sql`${adminRoles.createdAt} asc`);

  const grantsByRole = await loadGrants(db, rows.map((r) => r.id));
  const counts = await loadUserCounts(db, rows.map((r) => r.id));

  return rows.map((row) =>
    toRoleDetail(
      row,
      grantsByRole.get(row.id) ?? [],
      counts.get(row.id)?.userCount ?? 0,
      counts.get(row.id)?.activeUserCount ?? 0
    )
  );
}

export async function getRoleDetail(
  id: string,
  opts: { includeArchived?: boolean } = {}
): Promise<RoleDetail | null> {
  const rows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.archivedAt !== null && !opts.includeArchived) return null;

  const grantsByRole = await loadGrants(db, [row.id]);
  const counts = await loadUserCounts(db, [row.id]);
  return toRoleDetail(
    row,
    grantsByRole.get(row.id) ?? [],
    counts.get(row.id)?.userCount ?? 0,
    counts.get(row.id)?.activeUserCount ?? 0
  );
}

// =========================================================
// Draft validation (shared by create/revise/restore)
// =========================================================

function assertNameValid(draftName: string, currentName?: string): string {
  const errors = validateRoleName(draftName);
  const renaming =
    currentName === undefined ||
    normalizeRoleName(draftName) !== normalizeRoleName(currentName);
  if (errors.includes("protected") && renaming) {
    throw new RoleServiceError(
      400,
      "PROTECTED_NAME",
      "That Role Name is reserved"
    );
  }
  if (errors.some((e) => e !== "protected")) {
    throw new RoleServiceError(400, "INVALID_NAME", "Invalid Role Name");
  }
  return normalizeRoleName(draftName);
}

function assertGrantsWellFormed(grants: readonly Grant[]): void {
  if (validateGrants(grants).length > 0) {
    throw new RoleServiceError(
      400,
      "INVALID_GRANTS",
      "Unsupported module/action/scope combination"
    );
  }
  if (checkGrantCoverage(grants).length > 0) {
    throw new RoleServiceError(
      400,
      "COVERAGE_VIOLATION",
      "Edit/delete grants must be covered by view in the same module"
    );
  }
}

function assertWithinCeiling(
  actor: ActorContext,
  grants: readonly Grant[]
): void {
  if (!withinCeiling(actor.isOwner, actor.grants, grants)) {
    throw new RoleServiceError(
      403,
      "CEILING_VIOLATION",
      "Proposed grants exceed your authorization ceiling"
    );
  }
}

async function assertNameAvailable(
  executor: Executor,
  name: string,
  excludeRoleId?: string
): Promise<void> {
  const conditions = [normalizedNameCondition(name)];
  if (excludeRoleId) {
    conditions.push(ne(adminRoles.id, excludeRoleId));
  }
  const clash = await executor
    .select({ id: adminRoles.id })
    .from(adminRoles)
    .where(and(...conditions))
    .limit(1);
  if (clash.length > 0) {
    throw new RoleServiceError(
      409,
      "DUPLICATE_NAME",
      "Role Name already in use"
    );
  }
}

async function insertGrants(
  executor: Executor,
  roleId: string,
  grants: readonly Grant[]
): Promise<void> {
  if (grants.length === 0) return;
  await executor.insert(adminRoleGrants).values(
    grants.map((grant) => ({
      id: randomUUID(),
      roleId,
      module: grant.module,
      action: grant.action,
      scope: isBranchModule(grant.module) ? grant.scope : "global",
    }))
  );
}

function plannerActor(actor: ActorContext): PlannerActor {
  return {
    isOwner: actor.isOwner,
    grants: actor.grants,
    roleId: actor.roleId,
  };
}

function plannerRole(row: typeof adminRoles.$inferSelect, grants: Grant[]): PlannerRole {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    archived: row.archivedAt !== null,
    version: row.version,
    grants,
  };
}

// =========================================================
// Create
// =========================================================

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  /** Complete final grant set; empty = deny-all draft. */
  grants?: Grant[];
  /** Optional clone source: copies its grants when `grants` is omitted. */
  cloneFromId?: string;
}

export async function createRole(
  actor: ActorContext,
  input: CreateRoleInput
): Promise<RoleDetail> {
  assertNameValid(input.name);
  assertWithinCeiling(actor, []);

  let grants: Grant[] = [];
  if (input.cloneFromId) {
    const source = await getRoleDetail(input.cloneFromId, {
      includeArchived: false,
    });
    if (!source) {
      throw new RoleServiceError(404, "NOT_FOUND", "Clone source not found");
    }
    // Cloning may not smuggle grants above the actor's ceiling.
    assertWithinCeiling(actor, source.grants.map(toGrant));
    grants = source.grants.map(toGrant);
  }
  if (input.grants) {
    // Catalog well-formedness gates the ceiling: an unsupported
    // module/action/scope is INVALID_GRANTS by contract, never a ceiling
    // verdict about a grant that does not exist in the catalog.
    assertGrantsWellFormed(input.grants);
    assertWithinCeiling(actor, input.grants);
    grants = [...input.grants];
  }

  return withConstraintMapping(() =>
    db.transaction(async (tx) => {
      await assertNameAvailable(tx, input.name);

      const roleId = randomUUID();
      await tx.insert(adminRoles).values({
        id: roleId,
        name: input.name.trim(),
        description: input.description ?? null,
        isSystem: false,
        version: 1,
      });
      await insertGrants(tx, roleId, grants);

      await writeAuditEvent(tx, {
        actorId: actor.userId,
        action: "ROLE_CREATED",
        entityType: "admin_role",
        entityId: roleId,
        changes: {
          name: input.name.trim(),
          description: input.description ?? null,
          grants,
          cloneFromId: input.cloneFromId ?? null,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      const created = await tx
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.id, roleId))
        .limit(1);
      return toRoleDetail(created[0], [...grants], 0, 0);
    })
  );
}

// =========================================================
// Revise
// =========================================================

export interface ReviseRoleInput {
  expectedVersion: number;
  name: string;
  description?: string | null;
  grants: Grant[];
  reason: string | null;
}

const PLAN_ERROR_STATUS: Record<string, number> = {
  ROLE_NOT_FOUND: 404,
  OWNER_IMMUTABLE: 403,
  SELF_ROLE_REVISION: 403,
  STALE_VERSION: 409,
  PROTECTED_NAME: 400,
  INVALID_NAME: 400,
  INVALID_GRANTS: 400,
  CEILING_VIOLATION: 403,
  COVERAGE_VIOLATION: 400,
  REDUCTION_REASON_REQUIRED: 400,
  SYSTEM_ROLE_NOT_ARCHIVABLE: 403,
  REASON_REQUIRED: 400,
  ROLE_HAS_ACTIVE_USERS: 409,
};

function planErrorToResponse(code: string, fallback: string): never {
  throw new RoleServiceError(
    PLAN_ERROR_STATUS[code] ?? 400,
    code,
    fallback
  );
}

export async function reviseRole(
  actor: ActorContext,
  roleId: string,
  input: ReviseRoleInput
): Promise<RoleDetail> {
  return withConstraintMapping(() =>
    db.transaction(async (tx) => {
    // Lock the Role row so concurrent revisions serialize on this Role.
    const locked = await tx
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId))
      .for("update")
      .limit(1);
    const role = locked[0];
    if (!role || role.archivedAt !== null) {
      throw new RoleServiceError(404, "NOT_FOUND", "Role not found");
    }

    const currentGrants = (await loadGrants(tx, [roleId]))
      .get(roleId)
      ?.map(toGrant) ?? [];

    const plan = planRevision({
      actor: plannerActor(actor),
      role: plannerRole(role, currentGrants),
      draft: {
        name: input.name,
        description: input.description ?? null,
        grants: input.grants,
      },
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });
    if (!plan.ok) {
      planErrorToResponse(plan.code, `Role revision rejected: ${plan.code}`);
    }

    if (plan.normalizedName !== normalizeRoleName(role.name)) {
      await assertNameAvailable(tx, input.name, roleId);
    }

    await tx.delete(adminRoleGrants).where(eq(adminRoleGrants.roleId, roleId));
    await insertGrants(tx, roleId, input.grants);
    await tx
      .update(adminRoles)
      .set({
        name: input.name.trim(),
        description: input.description ?? null,
        version: role.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(adminRoles.id, roleId));

    await writeAuditEvent(tx, {
      actorId: actor.userId,
      action: "ROLE_UPDATED",
      entityType: "admin_role",
      entityId: roleId,
      changes: {
        before: {
          name: role.name,
          description: role.description,
          grants: currentGrants,
        },
        after: {
          name: input.name.trim(),
          description: input.description ?? null,
          grants: input.grants,
        },
        diff: plan.diff,
        reduction: plan.reduction,
        reason: input.reason,
      },
      policyVersion: actor.policyVersion,
      branchScope: "global",
    });

    const updated = await tx
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId))
      .limit(1);
    const counts = await loadUserCounts(tx, [roleId]);
    return toRoleDetail(
      updated[0],
      [...input.grants],
      counts.get(roleId)?.userCount ?? 0,
      counts.get(roleId)?.activeUserCount ?? 0
    );
    })
  );
}

// =========================================================
// Impact preview
// =========================================================

export interface ImpactPreview {
  role: { id: string; name: string; version: number };
  reduction: boolean;
  diff: GrantDiff;
  /** Grants in the draft that the current catalog no longer supports. */
  invalidGrants: Grant[];
  affectedActiveUsers: number;
}

export async function impactPreview(
  actor: ActorContext,
  roleId: string,
  draft?: { name?: string; grants?: Grant[] }
): Promise<ImpactPreview | null> {
  const rows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1);
  const role = rows[0];
  if (!role || role.archivedAt !== null) return null;

  const currentGrants = (await loadGrants(db, [roleId])).get(roleId) ?? [];
  const afterGrants = draft?.grants?.map(toGrant) ?? currentGrants.map(toGrant);
  const diff = grantDiff(
    currentGrants.map(toGrant),
    afterGrants
  );
  const reduction = diff.removed.length > 0;

  const counts = await loadUserCounts(db, [roleId]);

  // Set-level classification (review fix): a mutation grant is only
  // "invalid" when the rest of the retained set cannot cover it. Per-grant
  // checks would flag products:edit:all as invalid even when
  // products:view:all is retained with it.
  const afterClassification = classifyGrantSet(afterGrants);

  return {
    role: { id: role.id, name: role.name, version: role.version },
    reduction,
    diff,
    /** Grants in the draft that the current catalog no longer supports. */
    invalidGrants: afterClassification.invalid,
    affectedActiveUsers: counts.get(roleId)?.activeUserCount ?? 0,
  };
}

// =========================================================
// Archive
// =========================================================

export async function archiveRole(
  actor: ActorContext,
  roleId: string,
  reason: string | null
): Promise<RoleDetail> {
  const rows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1);
  const role = rows[0];
  if (!role) {
    throw new RoleServiceError(404, "NOT_FOUND", "Role not found");
  }
  const counts = await loadUserCounts(db, [roleId]);
  const activeUserCount = counts.get(roleId)?.activeUserCount ?? 0;

  const archiveInput: ArchiveInput = {
    role: {
      id: role.id,
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
      archived: role.archivedAt !== null,
      version: role.version,
    },
    activeUserCount,
    reason,
  };
  const plan = planArchive(archiveInput);
  if (!plan.ok) {
    // Match the in-transaction active-user guard's human message: the
    // pre-check and the re-check reject with the same actionable text.
    planErrorToResponse(
      plan.code,
      plan.code === "ROLE_HAS_ACTIVE_USERS"
        ? "Reassign or deactivate the active users of this Role first"
        : `Role archive rejected: ${plan.code}`
    );
  }

  return withConstraintMapping(() =>
    db.transaction(async (tx) => {
    // Re-lock and re-check: the Role or its users may have changed.
    const locked = await tx
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId))
      .for("update")
      .limit(1);
    const current = locked[0];
    if (!current || current.archivedAt !== null) {
      throw new RoleServiceError(404, "NOT_FOUND", "Role not found");
    }
    // Active-user guard is re-checked INSIDE the transaction so a concurrent
    // assignment cannot slip past the pre-check between plan and commit.
    const txCounts = await loadUserCounts(tx, [roleId]);
    const txActiveUsers = txCounts.get(roleId)?.activeUserCount ?? 0;
    if (txActiveUsers > 0) {
      throw new RoleServiceError(
        409,
        "ROLE_HAS_ACTIVE_USERS",
        "Reassign or deactivate the active users of this Role first"
      );
    }
    // Grant rows are RETAINED on archive (only archivedAt flips) so the
    // restore review can present them as a review draft under the current
    // catalog and audit history keeps the archived authorization state.
    const retainedGrants = (await loadGrants(tx, [roleId])).get(roleId) ?? [];
    const archivedAt = new Date();
    await tx
      .update(adminRoles)
      .set({
        archivedAt,
        version: current.version + 1,
        updatedAt: archivedAt,
      })
      .where(eq(adminRoles.id, roleId));

    await writeAuditEvent(tx, {
      actorId: actor.userId,
      action: "ROLE_ARCHIVED",
      entityType: "admin_role",
      entityId: roleId,
      changes: {
        before: { name: current.name, grants: retainedGrants },
        reason,
      },
      policyVersion: actor.policyVersion,
      branchScope: "global",
    });

    // The archive response reflects the RETAINED grants so callers can see
    // what a restore would review, and the active-user count is real.
    return toRoleDetail(
      { ...current, archivedAt, version: current.version + 1 },
      retainedGrants,
      txCounts.get(roleId)?.userCount ?? 0,
      0
    );
    })
  );
}

// =========================================================
// Restore
// =========================================================

export interface RestoreReview {
  role: {
    id: string;
    name: string;
    description: string | null;
    version: number;
    archivedAt: Date | null;
  };
  /** Retained grants that still validate under the current catalog. */
  validGrants: Grant[];
  /** Retained grants the current catalog no longer supports. */
  invalidGrants: Grant[];
}

export async function getRestoreReview(
  roleId: string
): Promise<RestoreReview | null> {
  const rows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1);
  const role = rows[0];
  if (!role || role.archivedAt === null) return null;

  // Set-level classification (review fix): coverage is a set property, so
  // the retained set is classified as a whole � a mutation covered by the
  // valid remainder stays valid.
  const classification = classifyGrantSet(
    ((await loadGrants(db, [roleId])).get(roleId) ?? []).map(toGrant)
  );
  return {
    role: {
      id: role.id,
      name: role.name,
      description: role.description,
      version: role.version,
      archivedAt: role.archivedAt,
    },
    validGrants: classification.valid,
    invalidGrants: classification.invalid,
  };
}

export interface RestoreRoleInput {
  expectedVersion: number;
  name: string;
  description?: string | null;
  grants: Grant[];
}

export async function restoreRole(
  actor: ActorContext,
  roleId: string,
  input: RestoreRoleInput
): Promise<RoleDetail> {
  // Optimistic version gate FIRST (pre-transaction): a stale draft must be
  // rejected with STALE_VERSION without any draft validation or mutation —
  // the transaction below re-locks and re-checks the version for races
  // between this read and the commit.
  const currentRows = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    throw new RoleServiceError(404, "NOT_FOUND", "Role not found");
  }
  if (current.archivedAt === null) {
    throw new RoleServiceError(
      409,
      "ROLE_NOT_ARCHIVED",
      "Role is not archived"
    );
  }
  if (input.expectedVersion !== current.version) {
    throw new RoleServiceError(
      409,
      "STALE_VERSION",
      "The Role was modified by someone else"
    );
  }

  assertNameValid(input.name);
  // Catalog well-formedness gates the ceiling (same contract as create:
  // unsupported module/action/scope is INVALID_GRANTS).
  assertGrantsWellFormed(input.grants);
  assertWithinCeiling(actor, input.grants);

  return withConstraintMapping(() =>
    db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId))
      .for("update")
      .limit(1);
    const role = locked[0];
    if (!role) {
      throw new RoleServiceError(404, "NOT_FOUND", "Role not found");
    }
    if (role.archivedAt === null) {
      throw new RoleServiceError(
        409,
        "ROLE_NOT_ARCHIVED",
        "Role is not archived"
      );
    }
    if (input.expectedVersion !== role.version) {
      throw new RoleServiceError(
        409,
        "STALE_VERSION",
        "The Role was modified by someone else"
      );
    }

    // Name uniqueness includes archived Roles; the restored Role may keep
    // its own name, so exclude itself from the clash check.
    await assertNameAvailable(tx, input.name, roleId);

    await tx.delete(adminRoleGrants).where(eq(adminRoleGrants.roleId, roleId));
    await insertGrants(tx, roleId, input.grants);
    await tx
      .update(adminRoles)
      .set({
        name: input.name.trim(),
        description: input.description ?? null,
        archivedAt: null,
        version: role.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(adminRoles.id, roleId));

    await writeAuditEvent(tx, {
      actorId: actor.userId,
      action: "ROLE_RESTORED",
      entityType: "admin_role",
      entityId: roleId,
      changes: {
        before: { name: role.name, archivedAt: role.archivedAt },
        after: { name: input.name.trim(), grants: input.grants },
        policyVersionAfter: role.version + 1,
      },
      policyVersion: actor.policyVersion,
      branchScope: "global",
    });

    return toRoleDetail(
      { ...role, archivedAt: null, version: role.version + 1 },
      [...input.grants],
      0,
      0
    );
    })
  );
}