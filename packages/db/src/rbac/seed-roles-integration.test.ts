import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./../schema";
import {
  INITIAL_ROLE_SEED,
  HQ_SEED_GRANTS,
  ADMIN_SEED_GRANTS,
} from "./seed-defaults";
import { SYSTEM_ROLE_KEYS } from "./catalog";

// =========================================================
// DB integration seam: a fresh reset+seed creates exactly the three Initial
// Roles, their normalized grant rows, and populates user `roleId` assignments.
// Requires the dev database (npm run db:reset && npm run db:seed) — skipped
// when DATABASE_URL is not configured or unreachable.
//
// The dev database is SHARED with the E2E suite, which legitimately leaves
// runtime rows behind (archived custom Roles, deactivated custom users).
// These tests therefore pin the seeded state through the SYSTEM flags and
// known keys / seeded emails — never by row count or table-wide predicates —
// so leftover custom rows cannot flip an assertion, and the assertions never
// delete data.
// =========================================================

const url = process.env.DATABASE_URL;
const d: ReturnType<typeof drizzle> | null = url
  ? drizzle(url, { schema })
  : null;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("select 1");
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

// The seeded-RBAC seam needs the RBAC schema AND seeded rows, not just a
// reachable server: skip cleanly when db:push/db:seed have not been run.
async function rbacSchemaReady(): Promise<boolean> {
  if (!url) return false;
  try {
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

const reachable = (await dbReachable()) && (await rbacSchemaReady());

describe.skipIf(!reachable)("seeded RBAC state (fresh reset+seed)", () => {

  it("creates exactly the three system Initial Roles", async () => {
    const roles = await d!.select().from(schema.adminRoles);

    // Custom Roles carry no key and isSystem=false, and archived Roles keep
    // their row — so exactness is pinned on the system flag + known keys,
    // not on the whole table.
    const systemRoles = roles.filter((r) => r.isSystem);
    expect(systemRoles.length).toBe(SYSTEM_ROLE_KEYS.length);
    expect(systemRoles.map((r) => r.key).sort()).toEqual(
      [...SYSTEM_ROLE_KEYS].sort()
    );
    expect(systemRoles.map((r) => r.name).sort()).toEqual([
      "Admin",
      "HQ",
      "System Owner",
    ]);
    // No archived or custom row may claim a system key: the exactly-three
    // system keys all belong to active, unarchived system Roles.
    const rowsWithSystemKey = await d!.select().from(schema.adminRoles).where(
      and(
        isNotNull(schema.adminRoles.key),
        inArray(schema.adminRoles.key, [...SYSTEM_ROLE_KEYS])
      )
    );
    expect(rowsWithSystemKey.map((r) => r.id).sort()).toEqual(
      systemRoles.map((r) => r.id).sort()
    );
    for (const role of systemRoles) {
      const seed = INITIAL_ROLE_SEED.find((s) => s.key === role.key);
      expect(seed).toBeDefined();
      expect(role.version).toBe(1);
      expect(role.archivedAt).toBeNull();
    }
  });

  it("stores the normalized HQ and Admin grants and no Owner grants", async () => {
    // Only the system Roles' grant rows are asserted — grant rows belong to
    // their roleId, so archived custom Roles (with their own grants) cannot
    // leak into these assertions.
    const systemRoles = await d!.select().from(schema.adminRoles).where(
      eq(schema.adminRoles.isSystem, true)
    );
    const byKey = new Map(systemRoles.map((r) => [r.key!, r]));

    const ownerGrants = await d!.select()
      .from(schema.adminRoleGrants)
      .where(eq(schema.adminRoleGrants.roleId, byKey.get("system_owner")!.id));
    expect(ownerGrants).toEqual([]);

    const hqGrants = await d!.select()
      .from(schema.adminRoleGrants)
      .where(eq(schema.adminRoleGrants.roleId, byKey.get("hq")!.id));
    expect(
      hqGrants.map((g) => ({ module: g.module, action: g.action, scope: g.scope }))
    ).toEqual(
      expect.arrayContaining(
        HQ_SEED_GRANTS.map((g) => ({
          module: g.module,
          action: g.action,
          scope: g.scope,
        }))
      )
    );
    expect(hqGrants.length).toBe(HQ_SEED_GRANTS.length);

    const adminGrants = await d!.select()
      .from(schema.adminRoleGrants)
      .where(eq(schema.adminRoleGrants.roleId, byKey.get("admin")!.id));
    expect(adminGrants.length).toBe(ADMIN_SEED_GRANTS.length);
    expect(
      adminGrants.every((g) => g.scope === "own_branch")
    ).toBe(true);
  });

  it("assigns the seeded Admin/HQ users through roleId", async () => {
    // The seeded users are identified by their known emails; runtime rows
    // (deactivated E2E users, custom Role assignments) are legitimate data
    // and must not be deleted, so table-wide user predicates are not used.
    const roles = await d!.select().from(schema.adminRoles).where(
      eq(schema.adminRoles.isSystem, true)
    );
    const byKey = new Map(roles.map((r) => [r.key!, r]));
    const adminRoleId = byKey.get("admin")!.id;
    const hqRoleId = byKey.get("hq")!.id;

    const seededUsers = await d!.select({
        id: schema.users.id,
        email: schema.users.email,
        roleId: schema.users.roleId,
        isActive: schema.users.isActive,
      })
      .from(schema.users)
      .where(inArray(schema.users.email, ["admin@store.com", "hq@store.com"]));

    expect(seededUsers.map((u) => u.email).sort()).toEqual([
      "admin@store.com",
      "hq@store.com",
    ]);
    for (const user of seededUsers) {
      expect(user.roleId).not.toBeNull();
      expect(user.isActive).toBe(true);
    }
    const adminUser = seededUsers.find((u) => u.email === "admin@store.com");
    const hqUser = seededUsers.find((u) => u.email === "hq@store.com");
    expect(adminUser?.roleId).toBe(adminRoleId);
    expect(hqUser?.roleId).toBe(hqRoleId);
  });
});