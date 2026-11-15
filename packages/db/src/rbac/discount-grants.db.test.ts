import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

// =========================================================
// DB seam: admin_role_grant scope-shape CHECK for the discount
// administration modules (`discounts`, `discount_capacity`).
//
// The approved shape for both modules is exactly Global view + Global edit:
// they are separate grant-able capabilities (a promo editor may write
// discounts without being allowed capacity overrides), they carry no branch
// scope, and they have no delete action. The CHECK therefore has to ACCEPT
// the four global view/edit rows and REJECT delete as well as any
// own_branch/all_branches row with SQLSTATE 23514 — not store it and let the
// application layer reinterpret it.
//
// This test talks to the real table through real SQL (no drizzle wrapper), so
// the assertion is about the deployed constraint, not about the TypeScript
// catalog. Expected tuples come from the spec (§7.3), not from code.
//
// Fixture safety (the only rows this file ever writes or removes):
// - exactly TWO Role ids, both stable constants owned by THIS spec, used as
//   both id and name (inside the canonical 2–64 character Role Name rule);
// - cleanup touches only those two exact ids in FK order (grants → roles) and
//   is restricted to non-system Roles, so a prefix-wide scan, seeded Roles and
//   system Roles are never in scope;
// - nothing is mutated unless DATABASE_URL points at a database whose parsed
//   name starts with `marketplace_discounts_test_`.
// Skipped (no connection at all) when DATABASE_URL is absent or the RBAC
// tables do not exist.
// =========================================================

const url = process.env.DATABASE_URL;

// Cleanup deletes by exact id, so the database itself must be provably
// disposable. A configured DATABASE_URL outside the prefix is a hard error —
// never a skip — so the destructive path cannot run against a real database.
const TEST_DATABASE_PREFIX = "marketplace_discounts_test_";

function databaseNameOf(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const name = pathname.split("/")[0];
    return name ? name : null;
  } catch {
    return null;
  }
}

function assertDisposableDatabase(connectionString: string): void {
  const name = databaseNameOf(connectionString);
  if (name === null) {
    throw new Error(
      `[discount-grants] Cannot parse a database name out of DATABASE_URL; ` +
        `refusing to create or delete fixtures. Expected a database name ` +
        `starting with "${TEST_DATABASE_PREFIX}".`
    );
  }
  if (!name.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(
      `[discount-grants] Refusing to mutate database "${name}": this spec ` +
        `deletes its fixtures by exact id, so DATABASE_URL must point at a ` +
        `database whose name starts with "${TEST_DATABASE_PREFIX}".`
    );
  }
}

if (url) assertDisposableDatabase(url);

// One accept Role (rows that must persist) and one reject Role (rows that must
// be rejected, so a CHECK violation can never turn into a unique-tuple error).
// Constants, not per-run values: the fixture set is always the same two ids, so
// an interrupted run is repaired by the next run instead of leaking rows under
// a fresh time-based namespace.
const ACCEPT_ROLE_ID = "zz-fx-disc-grants-accept";
const REJECT_ROLE_ID = "zz-fx-disc-grants-reject";
const FIXTURE_ROLE_IDS: readonly string[] = [ACCEPT_ROLE_ID, REJECT_ROLE_ID];

/** Spec-owned grant id; grant rows are removed via their role_id. */
function grantId(
  roleId: string,
  tag: string,
  module: string,
  action: string,
  scope: string
): string {
  return `${roleId}-${tag}-${module}-${action}-${scope}`;
}

async function dbReady(): Promise<boolean> {
  if (!url) return false;
  const probe = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await probe.query(
      `select to_regclass('public.admin_role') is not null
          and to_regclass('public.admin_role_grant') is not null as ok`
    );
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    // Close the probe pool on BOTH paths: a throwing readiness query must not
    // leave an open connection behind. end() is best-effort so that a failure
    // while closing cannot escalate into a suite-level error.
    await probe.end().catch(() => undefined);
  }
}

const ready = await dbReady();

// Only created when the suite will actually run, so a skipped run never holds
// an open pool.
const pool = ready && url ? new Pool({ connectionString: url, max: 1 }) : null;

/**
 * Remove ONLY this spec's two exact fixture Roles, in FK order
 * (grants → roles). Both statements are id-scoped and skip system Roles, so
 * seeded Roles, system Roles and any other leftover rows are out of reach.
 */
async function deleteFixtureRoles(): Promise<void> {
  const ids = [...FIXTURE_ROLE_IDS];
  await pool!.query(
    `DELETE FROM admin_role_grant AS g
       USING admin_role AS r
      WHERE g.role_id = r.id
        AND r.id = ANY($1::text[])
        AND r.is_system = false`,
    [ids]
  );
  await pool!.query(
    `DELETE FROM admin_role WHERE id = ANY($1::text[]) AND is_system = false`,
    [ids]
  );
}

/** Insert one grant row as raw SQL so driver errors stay unwrapped. */
async function insertGrant(
  id: string,
  roleId: string,
  module: string,
  action: string,
  scope: string
): Promise<void> {
  await pool!.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, roleId, module, action, scope]
  );
}

/**
 * Assert that a CHECK constraint rejects the row with SQLSTATE 23514.
 * The constraint NAME is intentionally not pinned: either the existing
 * module-scope-shape CHECK or a dedicated discount-module CHECK may own the
 * rule, but the rejection must be a CHECK violation — never a NULL, FK, or
 * unique-tuple error. Rejected rows go to the dedicated reject Role, which
 * holds no accepted row for the same (module, action) tuple.
 */
async function expectCheckViolation(
  label: string,
  id: string,
  module: string,
  action: string,
  scope: string
): Promise<void> {
  let error: { code?: string; constraint?: string | null } | null = null;
  try {
    await insertGrant(id, REJECT_ROLE_ID, module, action, scope);
  } catch (caught) {
    error = caught as { code?: string; constraint?: string | null };
  }
  expect(
    error,
    `${label} must be rejected by a CHECK constraint`
  ).not.toBeNull();
  expect(error!.code, `${label} must fail with SQLSTATE 23514`).toBe("23514");
  expect(
    error!.constraint,
    `${label} must fail on a named CHECK constraint`
  ).toBeTruthy();

  // The rejected row must not have been stored.
  const { rows } = await pool!.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_role_grant WHERE id = $1`,
    [id]
  );
  expect(rows[0]!.count, `${label} must not persist a row`).toBe("0");
}

describe.skipIf(!ready)(
  "admin_role_grant discount-module scope shape (dev DB)",
  () => {
    beforeAll(async () => {
      if (!pool) return;
      // Re-entrant: clear the exact two ids first so an interrupted previous
      // run cannot turn the inserts below into a duplicate-key failure.
      await deleteFixtureRoles();
      for (const roleId of FIXTURE_ROLE_IDS) {
        await pool.query(
          `INSERT INTO admin_role (id, name, is_system, version)
           VALUES ($1, $2, false, 1)`,
          [roleId, roleId]
        );
      }
    });

    afterAll(async () => {
      if (!pool) return;
      try {
        await deleteFixtureRoles();
      } finally {
        await pool.end().catch(() => undefined);
      }
    });

    it("accepts the four approved global view/edit grants for discounts and discount_capacity", async () => {
      // Spec §7.3: both discount modules are Global Modules with exactly
      // view + edit — one row each, scope 'global', no delete.
      const approved = [
        ["discounts", "view"],
        ["discounts", "edit"],
        ["discount_capacity", "view"],
        ["discount_capacity", "edit"],
      ] as const;

      for (const [module, action] of approved) {
        await insertGrant(
          grantId(ACCEPT_ROLE_ID, "approved", module, action, "global"),
          ACCEPT_ROLE_ID,
          module,
          action,
          "global"
        );
      }

      const { rows } = await pool!.query<{
        module: string;
        action: string;
        scope: string | null;
      }>(
        `SELECT module, action, scope FROM admin_role_grant
         WHERE role_id = $1 AND module IN ('discounts', 'discount_capacity')`,
        [ACCEPT_ROLE_ID]
      );

      const stored = rows
        .map((row) => `${row.module}:${row.action}:${row.scope}`)
        .sort();
      expect(stored).toEqual([
        "discount_capacity:edit:global",
        "discount_capacity:view:global",
        "discounts:edit:global",
        "discounts:view:global",
      ]);
    });

    it("rejects delete and branch-scoped rows for the discount modules with 23514", async () => {
      // No delete action exists on either module (records are archived), and
      // neither module is branch-aware — a branch scope must never be stored.
      const rejected = [
        ["discounts", "delete", "global", "discounts has no delete"],
        ["discount_capacity", "delete", "global", "capacity has no delete"],
        ["discounts", "view", "own_branch", "discounts view is global"],
        ["discounts", "edit", "all_branches", "discounts edit is global"],
        ["discount_capacity", "view", "all_branches", "capacity view is global"],
        ["discount_capacity", "edit", "own_branch", "capacity edit is global"],
      ] as const;

      for (const [module, action, scope, label] of rejected) {
        await expectCheckViolation(
          label,
          grantId(REJECT_ROLE_ID, "rejected", module, action, scope),
          module,
          action,
          scope
        );
      }
    });

    it("keeps the existing module scope-shape rules unchanged", async () => {
      // Guard against a CHECK rewrite that widens or narrows existing modules:
      // branch modules keep explicit own/all scopes, global modules keep
      // global-only scopes.
      const accepted = [
        ["products", "view", "all_branches"],
        ["products", "edit", "all_branches"],
        ["orders", "view", "own_branch"],
        ["branches", "delete", "all_branches"],
        ["customers", "view", "global"],
        ["footer", "view", "global"],
      ] as const;

      for (const [module, action, scope] of accepted) {
        await insertGrant(
          grantId(ACCEPT_ROLE_ID, "existing", module, action, scope),
          ACCEPT_ROLE_ID,
          module,
          action,
          scope
        );
      }

      await expectCheckViolation(
        "global module with a branch scope",
        grantId(REJECT_ROLE_ID, "rejected", "pages", "view", "own_branch"),
        "pages",
        "view",
        "own_branch"
      );
      await expectCheckViolation(
        "branch module with a global scope",
        grantId(REJECT_ROLE_ID, "rejected", "analytics", "view", "global"),
        "analytics",
        "view",
        "global"
      );
    });
  }
);
