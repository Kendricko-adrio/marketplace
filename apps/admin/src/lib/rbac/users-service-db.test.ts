import "../../test-support/load-env";

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { randomUUID } from "crypto";

import * as schema from "@marketplace/db/src/schema";
import { SYSTEM_OWNER_KEY } from "@marketplace/db/src/rbac/catalog";

import {
  OWNER_INVARIANT_LOCK_KEY,
  RoleServiceError,
  deactivateUser,
  updateUser,
} from "./users-service";
import type { ActorContext } from "./roles-service";
import type { Grant } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// DB-backed users-service lifecycle regression (P1 security):
// - the LAST_ACTIVE_OWNER invariant must hold across CONCURRENT
//   demotions/deactivations of DIFFERENT Owner rows (the per-user
//   row lock alone does not serialize the last-Owner count);
// - a non-Owner actor with users:edit cannot pivot their own
//   Home Branch (self-branch pivot), while Owner recovery and
//   ordinary cross-user edits stay permitted.
//
// BASELINE-AWARENESS: the dev database may already contain REAL,
// non-fixture active Owners (e.g. the Owner bootstrapped by the
// documented final-validation sequence). These tests NEVER mutate,
// deactivate or delete non-fixture Owners. Instead they capture the
// baseline non-fixture active-Owner population up front, assert that
// fixture setup adds EXACTLY the two fixture Owners on top of it, and
// derive the postcondition from the baseline:
//   - baseline === 0: no Owner may be eliminated — exactly one race
//     participant must be refused with LAST_ACTIVE_OWNER and at least
//     one fixture Owner survives;
//   - baseline > 0: the invariant is satisfied by the ambient Owner,
//     so both fixture mutations succeed and the total active-Owner
//     population returns to the baseline with NO non-fixture identity
//     changes.
// The advisory-lock serialization itself is proven independently of
// ambient data by the controlled seam test at the bottom (a manual
// half-open transaction holding the exact service advisory-lock key).
//
// Skipped when the dev database (DATABASE_URL + RBAC schema) is not ready.
// Fixtures use the `zz-fx-run-` prefix and are cleaned in FK order; cleanup
// only ever touches run-prefixed fixture rows, never real data.
// =========================================================

const url = process.env.DATABASE_URL;
const testDb = url ? drizzle(url, { schema }) : null;

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

const PREFIX = "zz-fx-";
const RUN_PREFIX = "zz-fx-run-";
const run = `${RUN_PREFIX}${Date.now().toString(36)}`;

// Resolved at module scope (top-level await) so the skipIf guards below see
// real values — beforeAll would run too late for describe registration.
const systemRoles = testDb
  ? await testDb
      .select({ id: schema.adminRoles.id, key: schema.adminRoles.key })
      .from(schema.adminRoles)
  : [];
const ownerRoleId: string | null =
  systemRoles.find((r) => r.key === SYSTEM_OWNER_KEY)?.id ?? null;
const adminRoleId: string | null =
  systemRoles.find((r) => r.key === "admin")?.id ?? null;

// A real seeded user must act as the audit `userId` (FK).
const actorUserId: string | null = testDb
  ?
    (
      await testDb
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, "hqmanager"))
        .limit(1)
    )[0]?.id ?? null
  : null;

let branchId: string | null = null;
let branch2Id: string | null = null;
const createdUserIds: string[] = [];

// Baseline non-fixture active-Owner population, captured in beforeAll AFTER
// run-prefixed fixture cleanup and BEFORE any fixture Owner is created.
let baselineOwnerIds: string[] = [];

const actor: ActorContext = {
  userId: actorUserId ?? "fixture-actor",
  isOwner: true, // owner bypass: fixtures are not about the ceiling
  grants: [],
  roleId: null,
  policyVersion: 1,
};

beforeAll(async () => {
  if (!testDb) return;

  // Purge leftovers from interrupted runs of THIS test file (run-prefixed
  // fixture users only — never real data) so the baseline below is exact.
  const stale = await testDb
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      or(
        like(schema.users.email, `${RUN_PREFIX}%`),
        like(schema.users.username, `${RUN_PREFIX}%`)
      )
    );
  if (stale.length > 0) {
    await testDb
      .delete(schema.users)
      .where(inArray(schema.users.id, stale.map((u) => u.id)));
  }

  // Baseline: active Owners that exist BEFORE this run's fixtures. Real
  // bootstrapped Owners (if any) are recorded here and asserted untouched
  // afterwards; they are never mutated by these tests.
  baselineOwnerIds = await activeOwnerIds();

  // Home Branch fixtures (needed to demote an Owner onto a non-Owner Role,
  // and to attempt a self-branch pivot). Branch 2 is only used by the
  // self-branch tests and is cleaned in afterAll.
  branchId = randomUUID();
  await testDb.insert(schema.branches).values({
    id: branchId,
    name: `${PREFIX}branch ${run}`,
    code: `${run}-b1`,
    city: "Test City",
    address: "Test Address",
  });
  branch2Id = randomUUID();
  await testDb.insert(schema.branches).values({
    id: branch2Id,
    name: `${PREFIX}branch2 ${run}`,
    code: `${run}-b2`,
    city: "Test City 2",
    address: "Test Address 2",
  });
});

afterEach(async () => {
  if (!testDb || createdUserIds.length === 0) return;
  // Isolate each race: the next test must start from the SAME active-Owner
  // population (the captured non-fixture baseline) it would see on a fresh
  // DB. Only this run's fixture users are removed.
  await testDb
    .delete(schema.users)
    .where(inArray(schema.users.id, createdUserIds));
  createdUserIds.length = 0;
});

afterAll(async () => {
  if (!testDb) return;
  // FK order: users → branches.
  if (createdUserIds.length > 0) {
    await testDb
      .delete(schema.users)
      .where(inArray(schema.users.id, createdUserIds));
  }
  if (branchId) {
    await testDb.delete(schema.branches).where(eq(schema.branches.id, branchId));
  }
  if (branch2Id) {
    await testDb
      .delete(schema.branches)
      .where(eq(schema.branches.id, branch2Id));
  }
});

async function makeOwnerUser(
  tag: string,
  opts: { branchId?: string | null } = {}
): Promise<string> {
  const userId = randomUUID();
  await testDb!.insert(schema.users).values({
    id: userId,
    name: `${PREFIX}owner ${tag}`,
    email: `${run}-${tag}@fixture.invalid`,
    username: `${run}-${tag}`,
    displayUsername: `${run}-${tag}`,
    roleId: ownerRoleId!,
    branchId: opts.branchId ?? null,
    isActive: true,
    emailVerified: true,
  });
  createdUserIds.push(userId);
  return userId;
}

/** Fixture user assigned the (non-Owner) Admin Role with a Home Branch. */
async function makeAdminUser(
  tag: string,
  homeBranchId: string | null
): Promise<string> {
  const userId = randomUUID();
  await testDb!.insert(schema.users).values({
    id: userId,
    name: `${PREFIX}admin ${tag}`,
    email: `${run}-${tag}@fixture.invalid`,
    username: `${run}-${tag}`,
    displayUsername: `${run}-${tag}`,
    roleId: adminRoleId!,
    branchId: homeBranchId,
    isActive: true,
    emailVerified: true,
  });
  createdUserIds.push(userId);
  return userId;
}

/** Normalized grant set of a Role, as used by the service layer. */
async function loadRoleGrants(roleId: string): Promise<Grant[]> {
  const rows = await testDb!
    .select({
      module: schema.adminRoleGrants.module,
      action: schema.adminRoleGrants.action,
      scope: schema.adminRoleGrants.scope,
    })
    .from(schema.adminRoleGrants)
    .where(eq(schema.adminRoleGrants.roleId, roleId));
  return rows.map((g) => ({
    module: g.module as Grant["module"],
    action: g.action as Grant["action"],
    scope: (g.scope ?? "global") as Grant["scope"],
  }));
}

/** Active users holding the System Owner Role (whole-DB invariant view). */
async function activeOwnerIds(): Promise<string[]> {
  const rows = await testDb!
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.roleId, ownerRoleId!),
        eq(schema.users.isActive, true)
      )
    );
  return rows.map((r) => r.id);
}

/** Active-Owner IDs that are NOT fixtures of the current run. */
function nonFixtureOwnerIds(ids: string[]): string[] {
  return ids.filter((id) => !createdUserIds.includes(id));
}

/** Sorted-set equality for ID lists. */
function expectSameIdSet(actual: string[], expected: string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

/**
 * Setup precondition for every race: the fixture pair is added EXACTLY on
 * top of the captured baseline — the total active-Owner population is
 * baseline + {userA, userB} and no non-fixture Owner changed identity.
 */
async function expectFixturePairAdded(
  userA: string,
  userB: string
): Promise<void> {
  const all = await activeOwnerIds();
  expectSameIdSet(nonFixtureOwnerIds(all), baselineOwnerIds);
  expectSameIdSet(
    all.filter((id) => id === userA || id === userB),
    [userA, userB]
  );
  expect(all.length).toBe(baselineOwnerIds.length + 2);
}

/**
 * Derived postcondition for a two-participant Owner race, valid for ANY
 * baseline. `rejected` is the subset of allSettled results that rejected.
 */
async function expectOwnerInvariantPostcondition(
  userA: string,
  userB: string,
  results: PromiseSettledResult<unknown>[]
): Promise<void> {
  const rejected = results.filter((r) => r.status === "rejected");

  // The invariant itself: no non-fixture Owner identity changed.
  const survivors = await activeOwnerIds();
  expectSameIdSet(nonFixtureOwnerIds(survivors), baselineOwnerIds);

  if (baselineOwnerIds.length === 0) {
    // No Owner may be eliminated when the baseline is zero: with full
    // advisory-lock serialization exactly ONE mutation is refused (the
    // second transaction counts after the first has committed).
    expect(rejected.length).toBe(1);
    const error = (rejected[0] as PromiseRejectedResult)
      .reason as RoleServiceError;
    expect(error).toBeInstanceOf(RoleServiceError);
    expect(error.code).toBe("LAST_ACTIVE_OWNER");
    expect(error.status).toBe(409);

    // At least one fixture Owner survived as an active Owner.
    expect(survivors.length).toBe(1);
    expect(survivors.some((id) => id === userA || id === userB)).toBe(true);
  } else {
    // A pre-existing (non-fixture) Owner already satisfies the invariant,
    // so both fixture mutations succeed and the total active-Owner count
    // returns exactly to the baseline.
    expect(rejected.length).toBe(0);
    expect(survivors.length).toBe(baselineOwnerIds.length);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(
  !ready || !actorUserId || !ownerRoleId || !adminRoleId
)("users-service last-Owner invariant under concurrency (dev DB)", () => {
  it("two concurrent deactivations of DIFFERENT Owners leave the last-Owner invariant intact (LAST_ACTIVE_OWNER)", async () => {
    const userA = await makeOwnerUser("deact-a");
    const userB = await makeOwnerUser("deact-b");
    // The two fixtures were added exactly on top of the non-fixture baseline.
    await expectFixturePairAdded(userA, userB);

    const results = await Promise.allSettled([
      deactivateUser(actor, userA, "offboarding A"),
      deactivateUser(actor, userB, "offboarding B"),
    ]);

    await expectOwnerInvariantPostcondition(userA, userB, results);
  });

  it("a concurrent demotion + deactivation of different Owners leaves the last-Owner invariant intact (LAST_ACTIVE_OWNER)", async () => {
    const userA = await makeOwnerUser("mix-a", { branchId });
    const userB = await makeOwnerUser("mix-b");
    await expectFixturePairAdded(userA, userB);

    const results = await Promise.allSettled([
      updateUser(actor, userA, {
        roleId: adminRoleId!,
        branchId,
        reason: "handover",
      }),
      deactivateUser(actor, userB, "offboarding B"),
    ]);

    await expectOwnerInvariantPostcondition(userA, userB, results);
  });

  it("two concurrent demotions of DIFFERENT Owners leave the last-Owner invariant intact (LAST_ACTIVE_OWNER)", async () => {
    // Pure update-path race: both mutations are updateUser demotions of
    // different Owner rows. Without transaction serialization taken BEFORE
    // the last-Owner count, both transactions would count each other's
    // still-active Owner row and both would succeed — eliminating the last
    // Owner. The advisory lock forces the second count to observe the
    // first demotion's commit.
    const userA = await makeOwnerUser("demo-a", { branchId });
    const userB = await makeOwnerUser("demo-b", { branchId });
    await expectFixturePairAdded(userA, userB);

    const results = await Promise.allSettled([
      updateUser(actor, userA, {
        roleId: adminRoleId!,
        branchId,
        reason: "handover A",
      }),
      updateUser(actor, userB, {
        roleId: adminRoleId!,
        branchId,
        reason: "handover B",
      }),
    ]);

    await expectOwnerInvariantPostcondition(userA, userB, results);
  });

  // ========================================================
  // CONTROLLED SEAM — advisory-lock serialization, independent of
  // ambient dev data. A manual half-open transaction reproduces the
  // exact service pattern (advisory lock → row lock → mutate) on
  // FIXTURE rows only and holds it uncommitted via a deterministic
  // gate. The real service must (a) block on the SAME advisory lock
  // and (b) evaluate LAST_ACTIVE_OWNER against the state committed
  // by the earlier transaction — regardless of how many ambient
  // Owners exist.
  // ========================================================
  it("seam: the invariant advisory lock serializes the real service behind a half-open transaction and the count observes its commit", async () => {
    const userA = await makeOwnerUser("seam-a", { branchId });
    const userB = await makeOwnerUser("seam-b");
    await expectFixturePairAdded(userA, userB);

    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url!, max: 1 });
    const client = await pool.connect();

    let svcSettled = false;
    let svcError: unknown = null;
    let svc: Promise<void> = Promise.resolve();

    try {
      // Hold the invariant lock FIRST so the service call below deterministically
      // loses the race for it.
      await client.query("begin");
      // The EXACT stable key the service takes first (before any row lock).
      await client.query("select pg_advisory_xact_lock(hashtext($1::text))", [
        OWNER_INVARIANT_LOCK_KEY,
      ]);
      // Lock the row, then demote fixture Owner A to Admin — but DO NOT
      // commit yet. This mirrors updateUser's tx structure with the commit
      // withheld behind the gate below.
      await client.query('select id from public."user" where id = $1 for update', [
        userA,
      ]);
      await client.query(
        'update public."user" set role_id = $2, updated_at = now() where id = $1',
        [userA, adminRoleId!]
      );

      // Only NOW start the real service: it must be BLOCKED on the advisory
      // lock this transaction already holds, so it cannot even start its
      // invariant count until the commit/rollback below.
      svc = deactivateUser(actor, userB, "offboarding B").then(
        () => {
          svcSettled = true;
        },
        (e) => {
          svcSettled = true;
          svcError = e;
        }
      );

      await sleep(400);
      expect(svcSettled).toBe(false);

      // Release the gate: userA's demotion becomes committed BEFORE the
      // service's last-Owner count runs.
      await client.query("commit");
      await svc;

      const survivors = await activeOwnerIds();
      if (baselineOwnerIds.length === 0) {
        // No ambient Owner: once userA's demotion committed, userB was the
        // LAST active Owner, so the real service must refuse — proving the
        // count was evaluated AFTER the earlier transaction's commit.
        expect(svcError).toBeInstanceOf(RoleServiceError);
        const error = svcError as RoleServiceError;
        expect(error.code).toBe("LAST_ACTIVE_OWNER");
        expect(error.status).toBe(409);
        expectSameIdSet(survivors, [userB]);
      } else {
        // Ambient Owners satisfy the invariant, so userB's deactivation
        // proceeds against the committed state; the population returns to
        // baseline with no non-fixture identity changes.
        expect(svcError).toBeNull();
        expect(survivors.length).toBe(baselineOwnerIds.length);
        expectSameIdSet(nonFixtureOwnerIds(survivors), baselineOwnerIds);
      }
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
      await pool.end();
      // Always drain the service promise so a late rejection is observed
      // and can never surface as an unhandled rejection.
      await svc.catch(() => {});
    }
  });

  it("a non-Owner actor cannot reassign their own Home Branch (SELF_BRANCH 403, service level)", async () => {
    // End-to-end seam check of the self-branch pivot denial: the same
    // actor/target user, a non-Owner actor whose grants cover the assigned
    // Role (so only the self-branch rule can reject).
    const selfId = await makeAdminUser("self-branch", branchId);
    const adminGrants = await loadRoleGrants(adminRoleId!);
    const nonOwnerSelfActor: ActorContext = {
      userId: selfId,
      isOwner: false,
      grants: adminGrants,
      roleId: adminRoleId!,
      policyVersion: 1,
    };

    let error: unknown = null;
    try {
      await updateUser(nonOwnerSelfActor, selfId, {
        branchId: branch2Id,
        reason: null,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RoleServiceError);
    const svcError = error as RoleServiceError;
    expect(svcError.code).toBe("SELF_BRANCH");
    expect(svcError.status).toBe(403);

    // The Home Branch was NOT moved.
    const row = await testDb!
      .select({ branchId: schema.users.branchId })
      .from(schema.users)
      .where(eq(schema.users.id, selfId))
      .limit(1);
    expect(row[0]?.branchId).toBe(branchId);
  });

  it("a non-Owner actor may still move ANOTHER user's Home Branch (service level)", async () => {
    // Paired positive: the self-branch rule must not over-block ordinary
    // cross-user Home Branch administration within the actor's ceiling.
    const actorId = await makeAdminUser("cross-actor", branchId);
    const otherId = await makeAdminUser("cross-target", branchId);
    const adminGrants = await loadRoleGrants(adminRoleId!);
    const nonOwnerActor: ActorContext = {
      userId: actorId,
      isOwner: false,
      grants: adminGrants,
      roleId: adminRoleId!,
      policyVersion: 1,
    };

    await updateUser(nonOwnerActor, otherId, {
      branchId: branch2Id,
      reason: "staff relocation",
    });

    const row = await testDb!
      .select({ branchId: schema.users.branchId })
      .from(schema.users)
      .where(eq(schema.users.id, otherId))
      .limit(1);
    expect(row[0]?.branchId).toBe(branch2Id);
  });
});