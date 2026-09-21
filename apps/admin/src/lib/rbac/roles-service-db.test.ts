import "../../test-support/load-env";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

import * as schema from "@marketplace/db/src/schema";
import type { Grant } from "@marketplace/db/src/rbac/catalog";
import { SYSTEM_OWNER_KEY } from "@marketplace/db/src/rbac/catalog";

import {
  RoleServiceError,
  archiveRole,
  createRole,
  getRestoreReview,
  getRoleDetail,
  impactPreview,
  restoreRole,
  reviseRole,
  type ActorContext,
} from "./roles-service";

// =========================================================
// Slice 4 follow-up review — DB-backed roles-service regression.
// Pins the transactional archive/restore/impact seams against the dev DB:
// - audit events are ACTUALLY written (the writer awaits its insert);
// - archive re-checks active users inside its transaction;
// - archived Roles RETAIN their grant rows so restore review works;
// - the archive response reflects the retained grants and real counts;
// - restore revalidates retained grants and bumps the version.
// Skipped when the dev database (DATABASE_URL + RBAC schema) is not ready.
// Fixtures use the `zz-fx-` name prefix and are cleaned in FK order.
// =========================================================

const url = process.env.DATABASE_URL;
const testDb = url
  ? drizzle(url, { schema })
  : null;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("select 1");
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

async function rbacSchemaReady(): Promise<boolean> {
  if (!url) return false;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 1 });
    const result = await pool.query(
      "select to_regclass('public.admin_role') is not null as ok"
    );
    await pool.end();
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  }
}

const ready = (await dbReachable()) && (await rbacSchemaReady());

// A real seeded user must act as the audit `userId` (FK). The actor context
// itself is synthetic: owner bypass keeps setup independent of grants.
const actorUserId: string | null = ready
  ? (
      await testDb!
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, "hqmanager"))
        .limit(1)
    )[0]?.id ?? null
  : null;

const PREFIX = "zz-fx-";
const run = `zz-fx-run-${Date.now().toString(36)}`;

const g = (module: string, action: string, scope: string): Grant =>
  ({ module, action, scope } as unknown as Grant);

const actor: ActorContext = {
  userId: actorUserId ?? "fixture-actor",
  isOwner: true, // owner bypass: fixtures are not about the ceiling
  grants: [],
  roleId: null,
  policyVersion: 1,
};

// Created fixture Role ids, cleaned in FK order afterwards.
const createdRoleIds: string[] = [];
const createdUserIds: string[] = [];

async function makeRole(
  name: string,
  grants: Grant[]
): Promise<{ id: string; version: number }> {
  const created = await createRole(actor, {
    name,
    grants,
  });
  createdRoleIds.push(created.id);
  return { id: created.id, version: created.version };
}

/** Insert a minimal active user assigned to a Role (assignment fixture). */
async function assignUser(roleId: string): Promise<string> {
  const userId = randomUUID();
  await testDb!.insert(schema.users).values({
    id: userId,
    name: `${PREFIX}user`,
    email: `${run}-${userId}@fixture.invalid`,
    username: `${run}-${userId.slice(0, 8)}`,
    roleId,
    isActive: true,
  });
  createdUserIds.push(userId);
  return userId;
}

beforeAll(async () => {
  // Clean any leftovers from previous runs (FK order: users → roles).
  const staleRoles = await testDb!
    .select({ id: schema.adminRoles.id })
    .from(schema.adminRoles)
    .where(like(schema.adminRoles.name, `${PREFIX}%`));
  const staleIds = staleRoles.map((r) => r.id);
  if (staleIds.length > 0) {
    await testDb!.delete(schema.users).where(inArray(schema.users.roleId, staleIds));
    await testDb!
      .delete(schema.adminRoles)
      .where(inArray(schema.adminRoles.id, staleIds));
  }
});

afterAll(async () => {
  if (!testDb) return;
  // FK order: users → grants (cascade) → roles.
  if (createdRoleIds.length > 0) {
    await testDb
      .delete(schema.users)
      .where(inArray(schema.users.roleId, createdRoleIds));
    await testDb
      .delete(schema.adminRoles)
      .where(inArray(schema.adminRoles.id, createdRoleIds));
  }
  await testDb
    .delete(schema.users)
    .where(inArray(schema.users.id, createdUserIds.length > 0 ? createdUserIds : ["none"]));
});

describe.skipIf(!ready || !actorUserId)("roles-service archive/restore (dev DB)", () => {
  it("archives a Role with no active users, RETAINING its grant rows", async () => {
    const role = await makeRole(`${PREFIX}retain ${run}`, [
      g("homepage", "view", "global"),
      g("homepage", "edit", "global"),
    ]);
    const archived = await archiveRole(actor, role.id, "No longer needed");

    expect(archived.archived).toBe(true);
    // Follow-up review: the archive response reflects the retained grants
    // (not an empty set) so callers see what restore would review.
    expect(archived.grants).toEqual([
      { module: "homepage", action: "view", scope: "global" },
      { module: "homepage", action: "edit", scope: "global" },
    ]);
    expect(archived.activeUserCount).toBe(0);

    // The grant rows themselves survive the archive.
    const rows = await testDb!
      .select()
      .from(schema.adminRoleGrants)
      .where(eq(schema.adminRoleGrants.roleId, role.id));
    expect(rows).toHaveLength(2);
  });

  it("blocks archiving a Role that still has active users (re-checked in the transaction) and leaves it active", async () => {
    const role = await makeRole(`${PREFIX}occupied ${run}`, [
      g("pages", "view", "global"),
    ]);
    await assignUser(role.id);

    await expect(
      archiveRole(actor, role.id, "Should be blocked")
    ).rejects.toMatchObject({
      status: 409,
      code: "ROLE_HAS_ACTIVE_USERS",
    });

    const rows = await testDb!
      .select()
      .from(schema.adminRoles)
      .where(eq(schema.adminRoles.id, role.id))
      .limit(1);
    expect(rows[0]!.archivedAt).toBeNull();
    expect(rows[0]!.version).toBe(1); // no partial mutation
  });

  it("keeps the archived Role's name reserved", async () => {
    const role = await makeRole(`${PREFIX}reserved ${run}`, []);
    await archiveRole(actor, role.id, "Cleanup");

    await expect(
      createRole(actor, { name: `${PREFIX}RESERVED   ${run}` })
    ).rejects.toMatchObject({ status: 409, code: "DUPLICATE_NAME" });
    // The rejection means no new Role was created: the only Role row with
    // that (normalized) name is the archived original itself.
    const sameName = await testDb!
      .select({ id: schema.adminRoles.id })
      .from(schema.adminRoles)
      .where(
        eq(
          sql`lower(regexp_replace(${schema.adminRoles.name}, '\\s+', ' ', 'g'))`,
          `${PREFIX}reserved ${run}`
        )
      );
    expect(sameName.map((r) => r.id)).toEqual([role.id]);
  });

  it("restore review reads the RETAINED grants and classifies them under the current catalog", async () => {
    const role = await makeRole(`${PREFIX}review ${run}`, [
      g("customers", "view", "global"),
    ]);
    await archiveRole(actor, role.id, "Temporary archive");

    const review = await getRestoreReview(role.id);
    expect(review).not.toBeNull();
    expect(review!.role.archivedAt).not.toBeNull();
    expect(review!.validGrants).toEqual([
      { module: "customers", action: "view", scope: "global" },
    ]);
    expect(review!.invalidGrants).toEqual([]);
  });

  it("detail fetches an archived Role only with includeArchived (editor/restore-review contract)", async () => {
    const role = await makeRole(`${PREFIX}detail ${run}`, [
      g("pages", "view", "global"),
    ]);
    const archived = await archiveRole(actor, role.id, "Detail contract");

    // Default lookup excludes archived Roles (404 semantics for revise/impact).
    expect(await getRoleDetail(role.id)).toBeNull();
    // The documented contract: roles:view fetches an archived Role by id,
    // with the retained grants and the archive-bumped version, so the editor
    // can display the archived mode and the restore review.
    const detail = await getRoleDetail(role.id, { includeArchived: true });
    expect(detail).not.toBeNull();
    expect(detail!.archived).toBe(true);
    expect(detail!.archivedAt).not.toBeNull();
    expect(detail!.version).toBe(archived.version);
    expect(detail!.grants).toEqual([
      { module: "pages", action: "view", scope: "global" },
    ]);
  });

  it("restore revalidates the draft (rejects invalid grants), clears archivedAt, and bumps the version", async () => {
    const role = await makeRole(`${PREFIX}restore ${run}`, [
      g("footer", "view", "global"),
    ]);
    const archived = await archiveRole(actor, role.id, "Before restore");
    const archivedVersion = archived.version;

    // A grant the current catalog does not support (products edit-own) fails
    // revalidation without touching the Role.
    await expect(
      restoreRole(actor, role.id, {
        expectedVersion: archivedVersion,
        name: `${PREFIX}restore ${run}`,
        grants: [g("products", "edit", "own_branch")],
      })
    ).rejects.toMatchObject({ status: 400, code: "INVALID_GRANTS" });

    // A stale version is rejected.
    await expect(
      restoreRole(actor, role.id, {
        expectedVersion: archivedVersion - 1,
        name: `${PREFIX}restore ${run}`,
        grants: [g("footer", "view", "global")],
      })
    ).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });

    const restored = await restoreRole(actor, role.id, {
      expectedVersion: archivedVersion,
      name: `${PREFIX}restore ${run}`,
      grants: [g("footer", "view", "global"), g("footer", "edit", "global")],
    });
    expect(restored.archived).toBe(false);
    expect(restored.version).toBe(archivedVersion + 1);
    expect(restored.grants).toEqual([
      { module: "footer", action: "view", scope: "global" },
      { module: "footer", action: "edit", scope: "global" },
    ]);
  });

  it("create reports an unsupported grant as INVALID_GRANTS even outside the actor's ceiling", async () => {
    // A non-owner actor whose ceiling does not cover the module at all: the
    // catalog verdict (INVALID_GRANTS) must win over CEILING_VIOLATION.
    const limited: ActorContext = {
      userId: actorUserId ?? "fixture-actor",
      isOwner: false,
      grants: [
        g("roles", "view", "global"),
        g("roles", "edit", "global"),
        g("roles", "delete", "global"),
      ],
      roleId: null,
      policyVersion: 1,
    };
    await expect(
      createRole(limited, {
        name: `${PREFIX}noscope ${run}`,
        grants: [g("audit_log", "edit", "all_branches")],
      })
    ).rejects.toMatchObject({ status: 400, code: "INVALID_GRANTS" });
  });

  it("restore rejects a stale draft with STALE_VERSION before validating the draft", async () => {
    const role = await makeRole(`${PREFIX}stale ${run}`, [
      g("footer", "view", "global"),
    ]);
    const archived = await archiveRole(actor, role.id, "Stale gate");

    // Stale AND invalid draft (protected name + unsupported grant): the
    // stale verdict must win and nothing may be mutated.
    await expect(
      restoreRole(actor, role.id, {
        expectedVersion: archived.version - 1,
        name: "System Owner",
        grants: [g("products", "edit", "own_branch")],
      })
    ).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });

    const rows = await testDb!
      .select()
      .from(schema.adminRoles)
      .where(eq(schema.adminRoles.id, role.id))
      .limit(1);
    expect(rows[0]!.archivedAt).not.toBeNull();
    expect(rows[0]!.version).toBe(archived.version);
  });

  it("impact requires a draft grant set (no default-to-current no-op preview)", async () => {
    const role = await makeRole(`${PREFIX}impact ${run}`, [
      g("orders", "view", "all_branches"),
    ]);
    await assignUser(role.id);

    // Narrowing all→own: reduction presented as the loss of the broader
    // grant only, with the affected active-user count.
    const preview = await impactPreview(actor, role.id, {
      grants: [g("orders", "view", "own_branch")],
    });
    expect(preview).not.toBeNull();
    expect(preview!.reduction).toBe(true);
    expect(preview!.diff.removed).toEqual([
      { module: "orders", action: "view", scope: "all_branches" },
    ]);
    expect(preview!.diff.added).toEqual([]);
    expect(preview!.affectedActiveUsers).toBe(1);
    expect(preview!.role.version).toBe(1);
  });

  it("writes authorization audit events for real (revise: full before/after + policy version)", async () => {
    const role = await makeRole(`${PREFIX}audit ${run}`, [
      g("homepage", "view", "global"),
    ]);
    await reviseRole(actor, role.id, {
      expectedVersion: 1,
      name: `${PREFIX}audit renamed ${run}`,
      grants: [],
      reason: "Least-privilege cleanup",
    });

    const events = await testDb!
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "ROLE_UPDATED"),
          eq(schema.auditLogs.entityId, role.id)
        )
      );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[events.length - 1]!;
    expect(event.userId).toBe(actorUserId);
    expect(event.policyVersion).toBeGreaterThan(0);
    expect(event.branchScope).toBe("global");
    const changes = event.changes as {
      before: { name: string; grants: unknown[] };
      after: { name: string; grants: unknown[] };
      reason: string;
    };
    expect(changes.before.name).toBe(`${PREFIX}audit ${run}`);
    expect(changes.before.grants).toEqual([
      { module: "homepage", action: "view", scope: "global" },
    ]);
    expect(changes.after.name).toBe(`${PREFIX}audit renamed ${run}`);
    expect(changes.after.grants).toEqual([]);
    expect(changes.reason).toBe("Least-privilege cleanup");
  });

  it("writes ROLE_ARCHIVED audit events with the reason", async () => {
    const role = await makeRole(`${PREFIX}audit-arc ${run}`, []);
    await archiveRole(actor, role.id, "Archive reason");

    const events = await testDb!
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "ROLE_ARCHIVED"),
          eq(schema.auditLogs.entityId, role.id)
        )
      );
    expect(events.length).toBe(1);
    const changes = events[0]!.changes as { reason?: string };
    expect(changes.reason).toBe("Archive reason");
    expect(events[0]!.policyVersion).toBeGreaterThan(0);
  });
});