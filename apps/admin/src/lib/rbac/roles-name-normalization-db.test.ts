import "../../test-support/load-env";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, like, sql } from "drizzle-orm";

import * as schema from "@marketplace/db/src/schema";
import { normalizeRoleName } from "@marketplace/db/src/rbac/catalog";

import { createRole, type ActorContext } from "./roles-service";

// =========================================================
// RBAC review fix — Role-Name duplicate detection must use the SAME
// canonical normalization (trim + whitespace collapse + lowercase) as the
// application's normalizeRoleName, the DB unique expression index, and the
// 0018 cutover preflight.
//
// The service inserts trimmed names, so the pre-fix untrimmed duplicate
// query only diverges for stored Names that carry leading/trailing
// whitespace — i.e. rows written outside the application (manual SQL,
// pre-cutover data). These fixtures simulate exactly that: a raw row with a
// padded Name must collide with the padded-free application Name.
// Requires the dev database (DATABASE_URL + RBAC schema) — skipped
// otherwise. Fixtures use the `zz-fx-` prefix and are cleaned afterwards.
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

const run = `zz-fx-norm-${Date.now().toString(36)}`;
const actorUserId: string | null = ready
  ? (
      await testDb!
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1)
    )[0]?.id ?? null
  : null;

const actor: ActorContext = {
  userId: actorUserId ?? "fixture-actor",
  isOwner: true,
  grants: [],
  roleId: null,
  policyVersion: 1,
};

const createdRoleIds: string[] = [];

/**
 * Unwrap the Postgres driver error from the drizzle query wrapper.
 * drizzle-orm ≥0.44 rethrows driver failures as "Failed query: …" wrappers;
 * the pg error itself (with `code` / `constraint`) sits on the `cause` chain.
 */
function pgCause(error: unknown): {
  code?: string;
  constraint?: string | null;
} | null {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    const asError = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof asError.code === "string") {
      return {
        code: asError.code,
        constraint: typeof asError.constraint === "string" ? asError.constraint : null,
      };
    }
    current = asError.cause;
  }
  return null;
}

/**
 * Track a fixture Role id for cleanup — but ONLY after the row is proven to
 * exist. Bookkeeping must stay consistent with actual rows: a rejected
 * insert (e.g. the unique-index probe below) must never enter the list, or
 * the leftover check would count phantom fixtures.
 */
async function trackCreatedRole(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const rows = await testDb!
    .select({ id: schema.adminRoles.id })
    .from(schema.adminRoles)
    .where(eq(schema.adminRoles.id, id))
    .limit(1);
  if (rows.length === 1) createdRoleIds.push(id);
}

afterAll(async () => {
  if (!testDb) return;
  // Deterministic, transaction-safe cleanup: resolve the fixture set from
  // BOTH the tracked ids and the run prefix, intersect with rows that
  // actually exist, then delete in FK order (users → roles; grants cascade
  // with the role). A failed assertion can therefore never leak rows between
  // runs, and phantom ids are harmless.
  await testDb.transaction(async (tx) => {
    const stale = await tx
      .select({ id: schema.adminRoles.id })
      .from(schema.adminRoles)
      .where(like(schema.adminRoles.name, `%${run}%`));
    const candidateIds = [...new Set([...createdRoleIds, ...stale.map((r) => r.id)])];
    if (candidateIds.length === 0) return;
    const existing = await tx
      .select({ id: schema.adminRoles.id })
      .from(schema.adminRoles)
      .where(inArray(schema.adminRoles.id, candidateIds));
    const rowIds = existing.map((r) => r.id);
    if (rowIds.length === 0) return;
    await tx.delete(schema.users).where(inArray(schema.users.roleId, rowIds));
    await tx.delete(schema.adminRoles).where(inArray(schema.adminRoles.id, rowIds));
  });
});

/** Count active+archived Role rows canonically equal to `name`. */
async function countCanonicallyEqual(name: string): Promise<number> {
  const rows = await testDb!
    .select({ id: schema.adminRoles.id })
    .from(schema.adminRoles)
    .where(
      eq(
        sql`lower(btrim(regexp_replace(${schema.adminRoles.name}, '\\s+', ' ', 'g')))`,
        normalizeRoleName(name)
      )
    );
  return rows.length;
}

describe.skipIf(!ready || !actorUserId)(
  "roles-service duplicate-name query (canonical normalization, dev DB)",
  () => {
    it("flags a stored Name with leading/trailing whitespace as a duplicate (service pre-check)", async () => {
      // Simulate externally-written data: the stored Name is NOT trimmed.
      const padded = `  ${run}  `;
      const [inserted] = await testDb!
        .insert(schema.adminRoles)
        .values({
          id: randomUUID(),
          name: padded,
          isSystem: false,
          version: 1,
        })
        .returning({ id: schema.adminRoles.id });
      await trackCreatedRole(inserted?.id);

      // The application Name (trimmed) must be treated as the SAME Role
      // Name by the service duplicate query: create must answer 409.
      await expect(
        createRole(actor, { name: run })
      ).rejects.toMatchObject({ status: 409, code: "DUPLICATE_NAME" });

      // No second Role row was created under the same normalized Name.
      expect(await countCanonicallyEqual(run)).toBe(1);
    });

    it("reports an uppercase/whitespace variant as DUPLICATE_NAME without creating a row", async () => {
      const created = await createRole(actor, { name: `${run}-svc alpha` });
      await trackCreatedRole(created.id);

      await expect(
        createRole(actor, { name: `  ${run}-SVC   alpha ` })
      ).rejects.toMatchObject({ status: 409, code: "DUPLICATE_NAME" });

      expect(await countCanonicallyEqual(`${run}-svc alpha`)).toBe(1);
    });

    it("the DB unique index rejects an externally written padded duplicate (last line of defense)", async () => {
      const created = await createRole(actor, { name: `${run}-idx unique` });
      await trackCreatedRole(created.id);

      // The padded/uppercase variant is canonically equal to the stored Name
      // (`  X  ` → normalizeRoleName → same key), so the canonical DB
      // expression index must reject the external insert. Bookkeeping: the
      // id only enters the cleanup list if a row actually materialized — a
      // rejected insert leaves NO row.
      const dupId = randomUUID();
      let insertedId: string | null = null;
      let violation: { code?: string; constraint?: string | null } | null = null;
      try {
        const [dupRow] = await testDb!
          .insert(schema.adminRoles)
          .values({
            id: dupId,
            name: `  ${run}-IDX UNIQUE  `,
            isSystem: false,
            version: 1,
          })
          .returning({ id: schema.adminRoles.id });
        insertedId = dupRow?.id ?? null;
      } catch (error) {
        violation = pgCause(error);
      }
      // Only real rows are tracked; the rejected insert must leave nothing.
      await trackCreatedRole(insertedId);
      expect(insertedId).toBeNull();
      expect(violation?.code).toBe("23505");
      expect(violation?.constraint).toBe("admin_role_name_normalized_unique");
    });

    it("leaves no leftover fixture roles with the run prefix", async () => {
      const stale = await testDb!
        .select({ id: schema.adminRoles.id })
        .from(schema.adminRoles)
        .where(like(schema.adminRoles.name, `%${run}%`));
      // Everything created above is tracked for cleanup; anything untracked
      // here would leak between runs. Track the gap first (so afterAll can
      // still clean up if this assertion fails), then assert it is empty.
      for (const row of stale) {
        if (!createdRoleIds.includes(row.id)) {
          createdRoleIds.push(row.id);
        }
      }
      expect(stale.length).toBe(createdRoleIds.length);
    });
  }
);