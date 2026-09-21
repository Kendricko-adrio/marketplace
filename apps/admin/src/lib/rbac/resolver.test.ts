import "../../test-support/load-env";

import { describe, it, expect, beforeAll } from "vitest";

const url = process.env.DATABASE_URL;
const testDb = url ? drizzle(url, { schema }) : null;

import {
  admissionDecision,
  loadPolicy,
  toPolicy,
  type LoadedPolicy,
} from "./resolver";
import { authorize } from "@marketplace/db/src/rbac/policy";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@marketplace/db/src/schema";
import { ADMIN_SEED_GRANTS } from "@marketplace/db/src/rbac/seed-defaults";

// =========================================================
// Slice 3 — current-policy resolver + session admission.
// Pure admission decision + DB-backed loadPolicy against the seeded dev DB
// (skipped when the database is not reachable).
// =========================================================

const ADMISSION_BASE = {
  isActive: true,
  roleId: "role-1",
  roleArchived: false,
  roleExists: true,
};

describe("admissionDecision", () => {
  it("admits an active user with an active assigned Role", () => {
    expect(admissionDecision(ADMISSION_BASE)).toEqual({ admitted: true });
  });

  it("rejects an inactive user with a stable reason", () => {
    expect(admissionDecision({ ...ADMISSION_BASE, isActive: false })).toEqual({
      admitted: false,
      reason: "inactive_user",
    });
  });

  it("rejects a user assigned to an archived Role", () => {
    expect(admissionDecision({ ...ADMISSION_BASE, roleArchived: true })).toEqual({
      admitted: false,
      reason: "archived_role",
    });
  });

  it("rejects a missing Role assignment", () => {
    expect(admissionDecision({ ...ADMISSION_BASE, roleId: null })).toEqual({
      admitted: false,
      reason: "missing_assignment",
    });
  });

  it("rejects an assignment pointing at a deleted Role", () => {
    expect(admissionDecision({ ...ADMISSION_BASE, roleExists: false })).toEqual({
      admitted: false,
      reason: "missing_assignment",
    });
  });
});

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

// The policy seam needs the RBAC schema (db:push), not just a reachable
// server: skip cleanly when the schema has not been applied yet.
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

describe.skipIf(
  !((await dbReachable()) && (await rbacSchemaReady()))
)("loadPolicy (seeded dev DB)", () => {
  let adminUser: { id: string } | null = null;
  let ownerUser: { id: string } | null = null;

  beforeAll(async () => {
    const admin = await testDb!
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, "admin@store.com"))
      .limit(1);
    adminUser = admin[0] ?? null;
    const owner = await testDb!
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, "owner@store.com"))
      .limit(1);
    ownerUser = owner[0] ?? null;
  });

  it("resolves the seeded Admin's role identity, grants, home branch, and policy version", async () => {
    if (!adminUser) return;
    const loaded = await loadPolicy(adminUser.id, testDb!);
    expect(loaded).not.toBeNull();
    const p = loaded as LoadedPolicy;
    expect(p.role.key).toBe("admin");
    expect(p.role.isSystem).toBe(true);
    expect(p.role.archived).toBe(false);
    expect(p.role.version).toBe(1);
    expect(p.user.isActive).toBe(true);
    expect(p.user.homeBranchId).toBeTruthy();
    expect(p.policyVersion).toBe(p.role.version);
    const grantSet = p.role.grants.map((g) => `${g.module}:${g.action}:${g.scope}`);
    expect(grantSet).toEqual(
      expect.arrayContaining(
        ADMIN_SEED_GRANTS.map((g) => `${g.module}:${g.action}:${g.scope}`)
      )
    );
    expect(p.role.grants.length).toBe(ADMIN_SEED_GRANTS.length);
  });

  it("resolves the System Owner with no grant rows", async () => {
    if (!ownerUser) return;
    const loaded = await loadPolicy(ownerUser.id, testDb!);
    if (!loaded) return; // owner not bootstrapped in this environment
    expect(loaded.role.key).toBe("system_owner");
    expect(loaded.role.grants).toEqual([]);
  });

  it("returns null for an unknown user", async () => {
    expect(await loadPolicy("no-such-user-id", testDb!)).toBeNull();
  });

  it("authorizes via the pure policy after loading (owner bypass, admin own scope)", async () => {
    if (!adminUser) return;
    const loaded = (await loadPolicy(adminUser.id, testDb!)) as LoadedPolicy;
    const policy = toPolicy(loaded);
    // Admin has orders view-own: own scope pins the server-side Home Branch.
    const own = authorize(policy, "orders", "view");
    expect(own.allowed).toBe(true);
    if (own.allowed) {
      expect(own.scope).toBe("own_branch");
      expect(own.homeBranchId).toBe(loaded.user.homeBranchId);
    }
    // Admin has no global product re-sync grant.
    expect(authorize(policy, "products", "edit").allowed).toBe(false);
    // Admin cannot view roles (global module without a grant).
    expect(authorize(policy, "roles", "view").allowed).toBe(false);

    const owner = await testDb!
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, "owner@store.com"))
      .limit(1);
    if (owner[0]) {
      const ownerLoaded = (await loadPolicy(owner[0].id, testDb!)) as LoadedPolicy;
      if (ownerLoaded.role.key === "system_owner") {
        const ownerPolicy = toPolicy(ownerLoaded);
        expect(authorize(ownerPolicy, "roles", "edit").allowed).toBe(true);
        expect(
          authorize(ownerPolicy, "orders", "edit", "all_branches").allowed
        ).toBe(true);
      }
    }
  });
});