import { randomUUID } from "crypto";

import bcrypt from "bcryptjs";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminAccounts,
  adminRoleGrants,
  adminRoles,
  adminSessions,
  branches,
  users,
} from "@/db";
import {
  SYSTEM_OWNER_KEY,
  type Grant,
  type GrantScope,
} from "@marketplace/db/src/rbac/catalog";
import { isGrantReduction } from "@marketplace/db/src/rbac/policy";
import { writeAuditEvent } from "./audit-writer";
import {
  mapConstraintError,
  RoleServiceError,
  type ActorContext,
} from "./roles-service";
import {
  planCreateUser,
  planDeactivateUser,
  planReactivateUser,
  planUpdateUser,
  type PlannerRole,
  type PlannerUser,
  type UsersPlanCode,
} from "./users-planner";

// =========================================================
// RBAC: Users service (DB-backed, slice 5)
// =========================================================
// Every mutation runs in one DB transaction: take the Owner-invariant
// advisory lock (pg_advisory_xact_lock — serializes the last-Owner count
// across DIFFERENT target rows), lock/re-read the target user
// row (SELECT … FOR UPDATE), validate the Role + Home Branch assignment
// through the pure planner, mutate, revoke sessions where required, and
// write an immutable audit event before commit. The advisory lock plus the
// user row lock ensure the last-Owner count is always read after earlier
// concurrent demotions/deactivations have committed.
//
// Users are soft-deactivated, never hard-deleted: identity, Role, Home
// Branch, and audit attribution are retained; email/username stay reserved
// across active AND inactive users; deactivation revokes every existing
// session transactionally and blocks future sign-in via the
// session-admission hook (isActive check in apps/admin/src/lib/auth.ts).

export { RoleServiceError };

const USER_EMAIL_UNIQUE_CONSTRAINT = "user_email_unique";
const USER_USERNAME_UNIQUE_CONSTRAINT = "user_username_unique";

/** Map surviving unique/FK constraint races into stable HTTP errors. */
export function mapUserConstraintError(error: unknown): RoleServiceError | null {
  const mapped = mapConstraintError(error);
  if (mapped) return mapped;
  const code = (error as { code?: string } | null)?.code;
  const constraint = (
    error as { constraint?: string | null } | null
  )?.constraint;
  if (
    code === "23505" &&
    (constraint === USER_EMAIL_UNIQUE_CONSTRAINT ||
      constraint === USER_USERNAME_UNIQUE_CONSTRAINT)
  ) {
    // Inactive users still reserve their email/username.
    return new RoleServiceError(
      409,
      "IDENTITY_CONFLICT",
      "Email or username is already in use"
    );
  }
  if (code === "23503") {
    return new RoleServiceError(
      400,
      "INVALID_REFERENCE",
      "Referenced Role or Branch does not exist"
    );
  }
  return null;
}

/** Run `run`, converting surviving constraint races into stable errors. */
async function withUserConstraintMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RoleServiceError) throw error;
    const mapped = mapUserConstraintError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RoleSummary {
  id: string;
  key: string | null;
  name: string;
  isSystem: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  username: string | null;
  displayUsername: string | null;
  email: string;
  isActive: boolean;
  mustResetPassword: boolean;
  emailVerified: boolean;
  role: RoleSummary | null;
  branch: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

// =========================================================
// Shared loaders
// =========================================================

export async function loadRoleForAssignment(
  executor: Executor,
  roleId: string
): Promise<{ role: typeof adminRoles.$inferSelect; grants: Grant[] } | null> {
  const rows = await executor
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1)
    .for("update");
  const role = rows[0];
  if (!role) return null;
  const grantRows = await executor
    .select({
      module: adminRoleGrants.module,
      action: adminRoleGrants.action,
      scope: adminRoleGrants.scope,
    })
    .from(adminRoleGrants)
    .where(eq(adminRoleGrants.roleId, roleId));
  const grants: Grant[] = grantRows.map((g) => ({
    module: g.module as Grant["module"],
    action: g.action as Grant["action"],
    scope: (g.scope ?? "global") as GrantScope,
  }));
  return { role, grants };
}

/** Read-only role lookup for the Owner classification of a target user. */
async function loadRoleKeyOnly(
  executor: Executor,
  roleId: string | null
): Promise<string | null> {
  if (!roleId) return null;
  const rows = await executor
    .select({ key: adminRoles.key })
    .from(adminRoles)
    .where(eq(adminRoles.id, roleId))
    .limit(1);
  return rows[0]?.key ?? null;
}

function plannerRole(
  row: typeof adminRoles.$inferSelect,
  grants: Grant[]
): PlannerRole {
  return {
    id: row.id,
    key: row.key,
    isSystem: row.isSystem,
    archived: row.archivedAt !== null,
    grants,
  };
}

function roleSummary(row: typeof adminRoles.$inferSelect): RoleSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    isSystem: row.isSystem,
  };
}

const USER_SELECT = {
  id: users.id,
  name: users.name,
  username: users.username,
  displayUsername: users.displayUsername,
  email: users.email,
  isActive: users.isActive,
  mustResetPassword: users.mustResetPassword,
  emailVerified: users.emailVerified,
  branchId: users.branchId,
  branchName: branches.name,
  branchCode: branches.code,
  roleId: adminRoles.id,
  roleKey: adminRoles.key,
  roleName: adminRoles.name,
  roleIsSystem: adminRoles.isSystem,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

type UserRow = {
  [K in keyof typeof USER_SELECT]: K extends keyof typeof users.$inferSelect
    ? typeof users.$inferSelect[K]
    : unknown;
};

function baseUserQuery(executor: Executor) {
  return executor
    .select(USER_SELECT)
    .from(users)
    .leftJoin(branches, eq(users.branchId, branches.id))
    .leftJoin(adminRoles, eq(users.roleId, adminRoles.id));
}

function toUserSummary(row: Record<string, unknown>): UserSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    username: (row.username as string | null) ?? null,
    displayUsername: (row.displayUsername as string | null) ?? null,
    email: row.email as string,
    isActive: row.isActive as boolean,
    mustResetPassword: row.mustResetPassword as boolean,
    emailVerified: row.emailVerified as boolean,
    role: row.roleId
      ? {
          id: row.roleId as string,
          key: (row.roleKey as string | null) ?? null,
          name: (row.roleName as string) ?? "",
          isSystem: (row.roleIsSystem as boolean) ?? false,
        }
      : null,
    branch: row.branchId
      ? {
          id: row.branchId as string,
          name: (row.branchName as string) ?? "",
          code: (row.branchCode as string) ?? "",
        }
      : null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

async function getUserDetailWithin(
  executor: Executor,
  id: string
): Promise<UserSummary | null> {
  const rows = await baseUserQuery(executor).where(eq(users.id, id)).limit(1);
  return rows[0] ? toUserSummary(rows[0]) : null;
}

// =========================================================
// Queries
// =========================================================

export interface ListUsersOptions {
  q?: string;
  /** Filter by assigned Role id. */
  roleId?: string;
  /** Filter by activity: true = active only, false = inactive only. */
  active?: boolean;
}

export async function listUsers(
  opts: ListUsersOptions = {}
): Promise<UserSummary[]> {
  const conditions = [];
  if (opts.q && opts.q.trim() !== "") {
    const term = `%${opts.q.trim()}%`;
    conditions.push(
      or(
        ilike(users.name, term),
        ilike(users.email, term),
        ilike(users.username, term)
      )!
    );
  }
  if (opts.roleId) {
    conditions.push(eq(users.roleId, opts.roleId));
  }
  if (opts.active !== undefined) {
    conditions.push(eq(users.isActive, opts.active));
  }

  const rows = await baseUserQuery(db)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt));

  return rows.map(toUserSummary);
}

export async function getUserDetail(id: string): Promise<UserSummary | null> {
  return getUserDetailWithin(db, id);
}

// =========================================================
// Password helpers (same convention as the legacy route)
// =========================================================

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";

function generatePassword(length = 16): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[arr[i] % PASSWORD_CHARS.length];
  }
  return out;
}

/** Generate a unique username from a display name across ALL users. */
async function generateUniqueUsername(
  executor: Executor,
  baseName: string,
  excludeId?: string
): Promise<string> {
  const base = baseName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9\s._-]/g, "")
    .replace(/[\s._-]+/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 30);

  const candidate = base || "user";
  let username = candidate;
  let suffix = 1;

  while (true) {
    const existing = await executor
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    const clash = existing.find((u) => u.id !== excludeId);
    if (!clash) return username;
    suffix += 1;
    username = `${candidate}${suffix}`;
  }
}

// =========================================================
// Last-Owner counting (transaction-safe)
// =========================================================

// Stable advisory-lock key for the last-Owner invariant. Every mutation
// whose plan can remove an active Owner (demotion/deactivation) takes this
// transaction-scoped lock FIRST — before any row lock — so concurrent
// mutations of DIFFERENT target rows serialize their invariant check: the
// second transaction counts only after the first has committed. A plain
// per-user row lock cannot provide this (different rows do not conflict).
// Transaction-level (`pg_advisory_xact_lock`) so the lock is released on
// commit/rollback without manual bookkeeping. Taking it before any row lock
// keeps a single lock order (advisory → user row → role row) and rules out
// deadlocks with roles-service (which locks role rows only).
// Exported so the DB-backed concurrency test can hold the EXACT same key in
// a manual half-open transaction and prove serialization deterministically.
export const OWNER_INVARIANT_LOCK_KEY = "rbac_last_active_owner";

async function lockOwnerInvariant(executor: Executor): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${OWNER_INVARIANT_LOCK_KEY}))`
  );
}

/** Active users holding the Owner Role other than `excludeUserId`. */
async function countOtherActiveOwners(
  executor: Executor,
  excludeUserId: string | null
): Promise<number> {
  const rows = await executor
    .select({ id: users.id })
    .from(users)
    .innerJoin(adminRoles, eq(users.roleId, adminRoles.id))
    .where(
      and(
        eq(adminRoles.key, SYSTEM_OWNER_KEY),
        eq(users.isActive, true),
        excludeUserId ? ne(users.id, excludeUserId) : undefined
      )
    );
  return rows.length;
}

// Stable messages per planner rejection code.
const PLAN_MESSAGES: Record<UsersPlanCode, string> = {
  BRANCH_REQUIRED: "Peran ini wajib memiliki cabang utama (Home Branch).",
  ROLE_NOT_USABLE: "Assigned Role is not available",
  OWNER_ASSIGNMENT_REQUIRED:
    "Only an active System Owner can manage the Owner Role assignment",
  CEILING_VIOLATION: "Assigned Role exceeds your authorization ceiling",
  SELF_ASSIGNMENT: "Anda tidak dapat mengubah peran Anda sendiri.",
  SELF_BRANCH: "Anda tidak dapat mengubah cabang utama Anda sendiri.",
  LAST_ACTIVE_OWNER: "The last active System Owner cannot be removed from the Owner Role",
  REASON_REQUIRED: "A reason is required for this change",
  REACTIVATION_BLOCKED:
    "Reactivation is blocked by the current policy (Role or Home Branch is no longer valid)",
};

function planStatus(code: UsersPlanCode): number {
  if (code === "LAST_ACTIVE_OWNER") return 409;
  if (
    code === "CEILING_VIOLATION" ||
    code === "OWNER_ASSIGNMENT_REQUIRED" ||
    code === "SELF_BRANCH"
  ) {
    return 403;
  }
  return 400;
}

function assertPlan(plan: { ok: boolean; code?: UsersPlanCode }): void {
  if (!plan.ok) {
    const code = plan.code as UsersPlanCode;
    throw new RoleServiceError(planStatus(code), code, PLAN_MESSAGES[code]);
  }
}

// =========================================================
// Create
// =========================================================

export interface CreateUserInput {
  name: string;
  email: string;
  roleId: string;
  /** Home Branch; required for every non-Owner Role. */
  branchId: string | null;
  passwordMode: "manual" | "generate";
  password?: string;
}

export interface CreateUserResult extends UserSummary {
  /** Plaintext password returned ONCE — never persisted. */
  password: string;
}

export async function createUser(
  actor: ActorContext,
  input: CreateUserInput
): Promise<CreateUserResult> {
  const finalPassword =
    input.passwordMode === "manual" ? input.password : generatePassword(16);
  if (!finalPassword || finalPassword.length < 8) {
    throw new RoleServiceError(
      400,
      "INVALID_PASSWORD",
      "Password minimal 8 karakter"
    );
  }
  const hashedPassword = await bcrypt.hash(finalPassword, 10);
  const email = input.email.toLowerCase();

  return withUserConstraintMapping(() =>
    db.transaction(async (tx) => {
      // Lock the assigned Role so a concurrent archive cannot invalidate the
      // assignment between validation and commit.
      const loaded = await loadRoleForAssignment(tx, input.roleId);
      if (!loaded) {
        throw new RoleServiceError(
          400,
          "INVALID_ROLE",
          "Assigned Role does not exist"
        );
      }

      assertPlan(
        planCreateUser({
          actor: {
            userId: actor.userId,
            isOwner: actor.isOwner,
            grants: actor.grants,
            roleId: actor.roleId,
          },
          role: plannerRole(loaded.role, loaded.grants),
          homeBranchId: input.branchId,
        })
      );

      // Validate the Home Branch exists when one is provided.
      if (input.branchId) {
        const branch = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.id, input.branchId))
          .limit(1);
        if (!branch.length) {
          throw new RoleServiceError(
            400,
            "INVALID_BRANCH",
            "Cabang tidak ditemukan."
          );
        }
      }

      // Reserved identity: email conflicts across active AND inactive users.
      const emailClash = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (emailClash.length) {
        throw new RoleServiceError(
          409,
          "IDENTITY_CONFLICT",
          "Email sudah digunakan."
        );
      }

      const username = await generateUniqueUsername(tx, input.name);

      const userId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        name: input.name,
        username,
        displayUsername: username,
        email,
        // Admins are created by authorized staff; no email verification flow.
        emailVerified: true,
        roleId: input.roleId,
        branchId: input.branchId,
        isActive: true,
        mustResetPassword: true, // force password change on first login
      });
      await tx.insert(adminAccounts).values({
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: hashedPassword,
      });

      await writeAuditEvent(tx, {
        actorId: actor.userId,
        action: "USER_CREATED",
        entityType: "user",
        entityId: userId,
        changes: {
          name: input.name,
          email,
          username,
          roleId: input.roleId,
          roleKey: loaded.role.key,
          branchId: input.branchId,
          isActive: true,
          mustResetPassword: true,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return {
        id: userId,
        name: input.name,
        username,
        displayUsername: username,
        email,
        isActive: true,
        mustResetPassword: true,
        emailVerified: true,
        role: roleSummary(loaded.role),
        branch: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: finalPassword,
      };
    })
  );
}

// =========================================================
// Update (identity + assignment)
// =========================================================

export interface UpdateUserInput {
  name?: string;
  email?: string;
  /** Assignment change; omit to keep the current assignment. */
  roleId?: string;
  branchId?: string | null;
  /** Required for assignment demotions (grant reductions). */
  reason: string | null;
}

export async function updateUser(
  actor: ActorContext,
  id: string,
  input: UpdateUserInput
): Promise<UserSummary> {
  return withUserConstraintMapping(() =>
    db.transaction(async (tx) => {
      // Serialize the last-Owner check against concurrent demotions or
      // deactivations of OTHER Owner rows (see lockOwnerInvariant).
      await lockOwnerInvariant(tx);

      // Lock the target user row so concurrent demotions/deactivations
      // serialize before the last-Owner check.
      const locked = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .for("update")
        .limit(1);
      const target = locked[0];
      if (!target) {
        throw new RoleServiceError(404, "NOT_FOUND", "User not found");
      }

      const currentLoaded = target.roleId
        ? await loadRoleForAssignment(tx, target.roleId)
        : null;

      const nextBranchId =
        input.branchId !== undefined ? input.branchId : target.branchId;

      let nextLoaded = currentLoaded;
      if (input.roleId && input.roleId !== target.roleId) {
        nextLoaded = await loadRoleForAssignment(tx, input.roleId);
        if (!nextLoaded) {
          throw new RoleServiceError(
            400,
            "INVALID_ROLE",
            "Assigned Role does not exist"
          );
        }
      }

      const otherActiveOwners = await countOtherActiveOwners(tx, id);

      assertPlan(
        planUpdateUser({
          actor: {
            userId: actor.userId,
            isOwner: actor.isOwner,
            grants: actor.grants,
            roleId: actor.roleId,
          },
          target: {
            id: target.id,
            email: target.email,
            roleId: target.roleId,
            roleKey: currentLoaded?.role.key ?? null,
            isActive: target.isActive,
            homeBranchId: target.branchId,
          },
          currentRole: currentLoaded
            ? plannerRole(currentLoaded.role, currentLoaded.grants)
            : null,
          nextRole: nextLoaded
            ? plannerRole(nextLoaded.role, nextLoaded.grants)
            : null,
          nextHomeBranchId: nextBranchId,
          otherActiveOwnerCount: otherActiveOwners,
          reason: input.reason,
        })
      );

      if (input.branchId) {
        const branch = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.id, input.branchId))
          .limit(1);
        if (!branch.length) {
          throw new RoleServiceError(
            400,
            "INVALID_BRANCH",
            "Cabang tidak ditemukan."
          );
        }
      }

      const email = input.email ? input.email.toLowerCase() : undefined;
      if (email && email !== target.email) {
        const clash = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), ne(users.id, id)))
          .limit(1);
        if (clash.length) {
          throw new RoleServiceError(
            409,
            "IDENTITY_CONFLICT",
            "Email sudah digunakan."
          );
        }
      }

      const updates: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name) updates.name = input.name;
      if (email) updates.email = email;
      if (input.roleId !== undefined) updates.roleId = input.roleId;
      if (input.branchId !== undefined) updates.branchId = input.branchId;

      await tx.update(users).set(updates).where(eq(users.id, id));

      const assignmentChanged =
        input.roleId !== undefined && input.roleId !== target.roleId;
      const branchChanged =
        input.branchId !== undefined && input.branchId !== target.branchId;

      if (assignmentChanged || branchChanged) {
        // Reassignment events carry old AND new Branch context.
        const demotion =
          currentLoaded && nextLoaded
            ? isGrantReduction(currentLoaded.grants, nextLoaded.grants)
            : false;
        const scope =
          target.branchId && nextBranchId && target.branchId !== nextBranchId
            ? "dual_branch"
            : target.branchId || nextBranchId
              ? "single_branch"
              : "global";
        await writeAuditEvent(tx, {
          actorId: actor.userId,
          action: "USER_UPDATED",
          entityType: "user",
          entityId: id,
          changes: {
            before: {
              roleId: target.roleId,
              roleKey: currentLoaded?.role.key ?? null,
              branchId: target.branchId,
            },
            after: {
              roleId: nextLoaded?.role.id ?? target.roleId,
              roleKey:
                nextLoaded?.role.key ?? currentLoaded?.role.key ?? null,
              branchId: nextBranchId,
            },
            demotion,
            reason: input.reason,
          },
          policyVersion: actor.policyVersion,
          branchScope: scope,
          // branchId carries the OLD Branch; relatedBranchId the new one.
          branchId: target.branchId,
          relatedBranchId: branchChanged ? nextBranchId : null,
        });
      } else if (input.name || input.email) {
        await writeAuditEvent(tx, {
          actorId: actor.userId,
          action: "USER_UPDATED",
          entityType: "user",
          entityId: id,
          changes: {
            before: { name: target.name, email: target.email },
            after: {
              name: input.name ?? target.name,
              email: email ?? target.email,
            },
          },
          policyVersion: actor.policyVersion,
          branchScope: "global",
        });
      }

      return (await getUserDetailWithin(tx, id))!;
    })
  );
}

// =========================================================
// Deactivate
// =========================================================

export async function deactivateUser(
  actor: ActorContext,
  id: string,
  reason: string | null
): Promise<UserSummary> {
  return withUserConstraintMapping(() =>
    db.transaction(async (tx) => {
      // Serialize the last-Owner check against concurrent demotions or
      // deactivations of OTHER Owner rows (see lockOwnerInvariant).
      await lockOwnerInvariant(tx);

      const locked = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .for("update")
        .limit(1);
      const target = locked[0];
      if (!target) {
        throw new RoleServiceError(404, "NOT_FOUND", "User not found");
      }
      if (!target.isActive) {
        throw new RoleServiceError(
          409,
          "USER_NOT_ACTIVE",
          "User is already deactivated"
        );
      }

      const roleKey = await loadRoleKeyOnly(tx, target.roleId);
      const otherActiveOwners = await countOtherActiveOwners(tx, id);

      assertPlan(
        planDeactivateUser({
          target: {
            id: target.id,
            email: target.email,
            roleId: target.roleId,
            roleKey,
            isActive: target.isActive,
            homeBranchId: target.branchId,
          },
          otherActiveOwnerCount: otherActiveOwners,
          reason,
        })
      );

      const now = new Date();
      await tx
        .update(users)
        .set({ isActive: false, updatedAt: now })
        .where(eq(users.id, id));

      // Deactivation revokes every existing session transactionally.
      await revokeUserSessions(tx, id);

      await writeAuditEvent(tx, {
        actorId: actor.userId,
        action: "USER_DEACTIVATED",
        entityType: "user",
        entityId: id,
        changes: {
          before: { isActive: true },
          after: { isActive: false },
          roleId: target.roleId,
          branchId: target.branchId,
          reason,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return (await getUserDetailWithin(tx, id))!;
    })
  );
}

// =========================================================
// Reactivate
// =========================================================

export async function reactivateUser(
  actor: ActorContext,
  id: string,
  reason: string | null
): Promise<UserSummary> {
  return withUserConstraintMapping(() =>
    db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .for("update")
        .limit(1);
      const target = locked[0];
      if (!target) {
        throw new RoleServiceError(404, "NOT_FOUND", "User not found");
      }
      if (target.isActive) {
        throw new RoleServiceError(
          409,
          "USER_NOT_INACTIVE",
          "User is not deactivated"
        );
      }

      const retained = target.roleId
        ? await loadRoleForAssignment(tx, target.roleId)
        : null;

      assertPlan(
        planReactivateUser({
          actor: {
            userId: actor.userId,
            isOwner: actor.isOwner,
            grants: actor.grants,
            roleId: actor.roleId,
          },
          role: retained
            ? plannerRole(retained.role, retained.grants)
            : null,
          homeBranchId: target.branchId,
        })
      );

      const now = new Date();
      await tx
        .update(users)
        .set({ isActive: true, updatedAt: now })
        .where(eq(users.id, id));

      await writeAuditEvent(tx, {
        actorId: actor.userId,
        action: "USER_REACTIVATED",
        entityType: "user",
        entityId: id,
        changes: {
          before: { isActive: false },
          after: { isActive: true },
          roleId: target.roleId,
          branchId: target.branchId,
          reason,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return (await getUserDetailWithin(tx, id))!;
    })
  );
}

// =========================================================
// Session revocation (centralized)
// =========================================================
// Better Auth stores admin sessions as rows in admin_session with no cookie
// cache configured, so every request resolves the session from the
// database: deleting the rows revokes the sessions immediately. This helper
// is the single revocation seam, used by deactivation inside the same
// transaction as the activity flip.

export async function revokeUserSessions(
  executor: Executor,
  userId: string
): Promise<void> {
  await executor.delete(adminSessions).where(eq(adminSessions.userId, userId));
}

// Keep the row-shape type referenced (query building is lazy and typed via
// USER_SELECT); avoids an unused-type lint failure.
export type { UserRow };