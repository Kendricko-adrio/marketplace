import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "crypto";
import { Pool } from "pg";

import {
  ADMIN_SEED_GRANTS,
  HQ_SEED_GRANTS,
  INITIAL_ROLE_KEYS,
} from "../rbac/seed-defaults";

// =========================================================
// Scratch-database migration rehearsal for the 0018 RBAC cutover.
//
// 0018 cannot be re-run on production data, so its guards are rehearsed on
// a disposable database built from the real migration chain (0000 → 0017)
// with pre-cutover legacy data:
//
//   1. Reserved-key squatters (custom Roles holding system_owner/hq/admin)
//      and malformed system rows must ABORT the migration — the cutover
//      must never attach Initial-Role grants or backfilled users to an
//      arbitrary custom Role via ON CONFLICT ("key") DO NOTHING.
//   2. Protected/colliding Names under the CANONICAL normalization
//      (trim + whitespace collapse + lowercase) must abort.
//   3. Unexpected legacy user.role values must abort.
//   4. The corrected admin_role_name_normalized_unique index must be
//      recreated with the canonical expression.
//   5. A clean cutover backfills role_id, repairs Initial-Role grants, and
//      drops the legacy column/table.
//
// Requires DATABASE_URL pointing at a PostgreSQL server with database-
// creation rights (the dev setup's postgres superuser). Skipped otherwise.
//
// Determinism notes:
//   - The scratch database name carries a per-process random suffix so two
//     vitest workers/files (or two concurrent suite runs) can never collide.
//   - The pre-0018 schema is established in beforeEach via ensurePre0018Schema
//     (rebuild only when actually missing), so no test depends on a prior
//     test's success; a failure is retried by the next test's setup.
//   - Migration/recreate operations get explicit generous timeouts — the
//     0000→0017 chain regularly exceeds Vitest's 5s default under
//     full-suite parallel load, which used to cascade into every dependent
//     test.
// =========================================================

const url = process.env.DATABASE_URL;
const DRIZZLE_DIR = path.resolve(import.meta.dirname, "../../drizzle");

const journal = JSON.parse(
  readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")
) as { entries: Array<{ idx: number; tag: string }> };

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

// Explicit timeouts (Vitest's 5s default is not enough for the 18-file
// migration chain once the whole unit suite runs in parallel).
const REBUILD_TIMEOUT_MS = 60_000; // scratch recreate + chain 0000→0017
const CUTOVER_TIMEOUT_MS = 30_000; // full 0018 cutover + assertions
const ABORT_TEST_TIMEOUT_MS = 15_000; // preflight-abort cases
const TEARDOWN_TIMEOUT_MS = 30_000; // close pools + force-drop

function poolFor(database: string | null): Pool {
  if (!url) throw new Error("DATABASE_URL not configured");
  const base = {
    max: 1,
    connectionTimeoutMillis: 10_000,
  };
  if (!database) return new Pool({ ...base, connectionString: url });
  const u = new URL(url);
  u.pathname = `/${database}`;
  return new Pool({ ...base, connectionString: u.toString() });
}

// Unique per process: parallel vitest files/workers or two concurrent runs
// of this suite each get their own scratch database, so DROP/CREATE against
// one run can never clobber another's.
const scratchName = url
  ? `${new URL(url).pathname.slice(1)}__mm18_rehearsal_${randomUUID().slice(0, 8)}`
  : null;

const adminPool = scratchName ? poolFor(null) : null;
// Mutable: the scratch pool is closed and recreated around every scratch
// database drop (see dropScratchDatabase) so no live connection is present
// when the database is force-dropped — otherwise PostgreSQL terminates it
// with 57P01 and pg surfaces that as an unhandled 'error' event.
let scratchPool: Pool | null = scratchName ? poolFor(scratchName) : null;

/** Close the scratch pool FIRST, then force-drop the scratch database. */
async function dropScratchDatabase(): Promise<void> {
  if (!adminPool || !scratchName) return;
  if (scratchPool) {
    await scratchPool.end().catch(() => undefined);
    scratchPool = null;
  }
  await adminPool.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
}

/** Rebuild a pristine scratch database with a fresh, connected pool. */
async function recreateScratchDatabase(): Promise<void> {
  await dropScratchDatabase();
  await adminPool!.query(`CREATE DATABASE "${scratchName}"`);
  scratchPool = poolFor(scratchName!);
}

/** True when the scratch database already carries the full pre-0018 schema. */
async function scratchSchemaReady(pool: Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query<{
      roles: boolean;
      perm: boolean;
      legacy: boolean;
    }>(
      `SELECT to_regclass('public.admin_role') IS NOT NULL AS roles,
              to_regclass('public.permission') IS NOT NULL AS perm,
              EXISTS (
                SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public."user"'::regclass
                  AND attname = 'role' AND NOT attisdropped
              ) AS legacy`
    );
    const row = rows[0];
    return !!row && row.roles && row.perm && row.legacy;
  } catch {
    // Database missing / not migrated yet / pool gone — treat as absent.
    return false;
  }
}

/**
 * Establish the required pre-0018 schema without relying on a prior test's
 * success: rebuild the scratch database only when the schema is actually
 * missing (or half-applied), so each test's setup is self-sufficient.
 */
async function ensurePre0018Schema(): Promise<void> {
  if (scratchPool && (await scratchSchemaReady(scratchPool))) return;
  await recreateScratchDatabase();
  await applyChainThrough0017(scratchPool!);
}

/** Apply every migration BEFORE the cutover (0000 … 0017) in journal order. */
async function applyChainThrough0017(pool: Pool): Promise<void> {
  for (const entry of journal.entries.filter((e) => e.idx < 18)) {
    const sql = readFileSync(
      path.join(DRIZZLE_DIR, `${entry.tag}.sql`),
      "utf8"
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const stmt of statements(sql)) {
        await client.query(stmt);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `rehearsal: applying ${entry.tag} failed: ${(error as Error).message}`
      );
    } finally {
      client.release();
    }
  }
}

interface Run0018Result {
  ok: boolean;
  message?: string;
}

/** Run ONLY the 0018 cutover file (single transaction, like drizzle-kit). */
async function run0018(pool: Pool): Promise<Run0018Result> {
  // Select 0018 explicitly by idx: using .at(-1) would silently retarget the
  // rehearsal to a future 0019 entry once the chain grows beyond 0018.
  const entry0018 = journal.entries.find((e) => e.idx === 18);
  if (!entry0018) throw new Error("rehearsal: journal entry idx 18 not found");
  const sql = readFileSync(
    path.join(DRIZZLE_DIR, `${entry0018.tag}.sql`),
    "utf8"
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements(sql)) {
      await client.query(stmt);
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    return { ok: false, message: (error as Error).message };
  } finally {
    client.release();
  }
}

// =========================================================
// Legacy pre-cutover fixtures
// =========================================================

interface RoleFixture {
  id?: string;
  key?: string | null;
  name: string;
  isSystem?: boolean;
  archivedAt?: Date | null;
  grants?: Array<{ module: string; action: string; scope: string | null }>;
}

async function insertRole(pool: Pool, fixture: RoleFixture): Promise<string> {
  const id = fixture.id ?? randomUUID();
  await pool.query(
    `INSERT INTO "admin_role" ("id", "key", "name", "is_system", "archived_at")
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      fixture.key ?? null,
      fixture.name,
      fixture.isSystem ?? false,
      fixture.archivedAt ?? null,
    ]
  );
  for (const grant of fixture.grants ?? []) {
    await pool.query(
      `INSERT INTO "admin_role_grant" ("id", "role_id", "module", "action", "scope")
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), id, grant.module, grant.action, grant.scope]
    );
  }
  return id;
}

async function insertLegacyUser(
  pool: Pool,
  opts: { role: string | null }
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "user" ("id", "name", "email", "role")
     VALUES ($1, $2, $3, $4)`,
    [id, `Rehearsal ${id.slice(0, 6)}`, `${id}@rehearsal.invalid`, opts.role]
  );
  return id;
}

async function clearLegacyData(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM "admin_role_grant"`);
  await pool.query(`DELETE FROM "user"`);
  await pool.query(`DELETE FROM "admin_role"`);
  await pool.query(`DELETE FROM "permission"`);
}

async function legacyColumnExists(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public."user"'::regclass
         AND attname = 'role' AND NOT attisdropped
     ) AS ok`
  );
  return rows[0]!.ok;
}

async function recreatedIndexDef(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'admin_role_name_normalized_unique'`
  );
  return rows[0]!.indexdef;
}

describe.skipIf(!url)("0018 cutover rehearsal (scratch database)", () => {
  // Self-sufficient setup: if a previous test (or run) left the scratch
  // schema missing or post-0018, rebuild it here instead of cascading.
  beforeEach(() => ensurePre0018Schema(), REBUILD_TIMEOUT_MS);

  it(
    "builds the pre-cutover scratch database from the real migration chain",
    async () => {
      await recreateScratchDatabase();
      await applyChainThrough0017(scratchPool!);
      const { rows } = await scratchPool!.query<{
        ok: boolean;
        perm: boolean;
      }>(
        `SELECT to_regclass('public.admin_role') IS NOT NULL AS ok,
                to_regclass('public.permission') IS NOT NULL AS perm`
      );
      expect(rows[0]!.ok).toBe(true);
      expect(rows[0]!.perm).toBe(true);
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    REBUILD_TIMEOUT_MS
  );

  // -------------------------------------------------------------
  // P1 fix (1): reserved keys must belong to the expected system identity
  // -------------------------------------------------------------
  it(
    "aborts when a CUSTOM role squats the reserved 'admin' key",
    async () => {
      await clearLegacyData(scratchPool!);
      const squatterId = await insertRole(scratchPool!, {
        key: "admin",
        name: "Store Admin",
        isSystem: false,
      });
      await insertLegacyUser(scratchPool!, { role: "admin" });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("reserved system key");

      // Nothing was written: the squatter is untouched, no system Roles were
      // inserted, and the legacy column survives.
      const { rows } = await scratchPool!.query<{ id: string; name: string }>(
        `SELECT "id", "name" FROM "admin_role"`
      );
      expect(rows).toEqual([{ id: squatterId, name: "Store Admin" }]);
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
      const users = await scratchPool!.query<{ role_id: string | null }>(
        `SELECT "role_id" FROM "user" LIMIT 1`
      );
      expect(users.rows[0]!.role_id).toBeNull();
    },
    ABORT_TEST_TIMEOUT_MS
  );

  it(
    "aborts when a reserved-key row lacks is_system",
    async () => {
      await clearLegacyData(scratchPool!);
      await insertRole(scratchPool!, {
        key: "hq",
        name: "HQ",
        isSystem: false,
      });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("reserved system key");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  it(
    "aborts when a reserved-key row carries the wrong display Name",
    async () => {
      await clearLegacyData(scratchPool!);
      await insertRole(scratchPool!, {
        key: "system_owner",
        name: "Administrator",
        isSystem: true,
      });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("reserved system key");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  it(
    "aborts when a reserved-key system Role is archived",
    async () => {
      await clearLegacyData(scratchPool!);
      await insertRole(scratchPool!, {
        key: "admin",
        name: "Admin",
        isSystem: true,
        archivedAt: new Date(),
      });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("reserved system key");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  // -------------------------------------------------------------
  // P1 fix (2): canonical normalized-Name collisions
  // -------------------------------------------------------------
  it(
    "aborts on a custom Role whose Name canonically normalizes to a protected Name (trimmed form)",
    async () => {
      await clearLegacyData(scratchPool!);
      // The legacy (0017) untrimmed preflight missed 'Admin ' — only the
      // canonical normalization catches it.
      await insertRole(scratchPool!, { key: null, name: "Admin " });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("normalized Role-Name collision");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  it(
    "aborts on two custom Roles sharing one canonical normalization",
    async () => {
      await clearLegacyData(scratchPool!);
      await insertRole(scratchPool!, { key: null, name: "Ops Team" });
      await insertRole(scratchPool!, { key: null, name: " ops team " });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("duplicate normalized Role-Name");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  // -------------------------------------------------------------
  // Legacy user.role preflight under the canonical normalization
  // -------------------------------------------------------------
  it(
    "aborts on a legacy user.role value that only differs by internal whitespace",
    async () => {
      await clearLegacyData(scratchPool!);
      await insertRole(scratchPool!, {
        key: "admin",
        name: "Admin",
        isSystem: true,
      });
      await insertRole(scratchPool!, { key: "hq", name: "HQ", isSystem: true });
      await insertLegacyUser(scratchPool!, { role: "H Q" });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("unexpected legacy user.role");
      expect(await legacyColumnExists(scratchPool!)).toBe(true);
    },
    ABORT_TEST_TIMEOUT_MS
  );

  // -------------------------------------------------------------
  // Happy path A: pre-existing, correctly-shaped system Roles
  // -------------------------------------------------------------
  it(
    "cuts over when correct system Roles already exist (idempotent, grants repaired, no custom-role leakage)",
    async () => {
      await clearLegacyData(scratchPool!);
      const ownerId = await insertRole(scratchPool!, {
        key: "system_owner",
        name: "System Owner",
        isSystem: true,
      });
      // Pre-existing (partially seeded) grant row — must NOT be duplicated.
      const hqId = await insertRole(scratchPool!, {
        key: "hq",
        name: "HQ",
        isSystem: true,
        grants: [
          HQ_SEED_GRANTS[0] as unknown as {
            module: string;
            action: string;
            scope: string;
          },
        ],
      });
      const adminId = await insertRole(scratchPool!, {
        key: "admin",
        name: "Admin",
        isSystem: true,
      });
      const customId = await insertRole(scratchPool!, {
        key: null,
        name: "Marketing",
      });

      const hqUserId = await insertLegacyUser(scratchPool!, { role: "  HQ  " });
      const adminUserId = await insertLegacyUser(scratchPool!, {
        role: "admin",
      });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(true);

      // System Role rows are retained untouched (same ids); the custom Role
      // survives with its key untouched.
      const roles = await scratchPool!.query<{
        id: string;
        key: string | null;
        name: string;
        is_system: boolean;
        archived_at: Date | null;
      }>(`SELECT "id", "key", "name", "is_system", "archived_at" FROM "admin_role"`);
      const byKey = new Map(roles.rows.map((r) => [r.key!, r]));
      expect(roles.rows).toHaveLength(4);
      expect(byKey.get("system_owner")!.id).toBe(ownerId);
      expect(byKey.get("hq")!.id).toBe(hqId);
      expect(byKey.get("admin")!.id).toBe(adminId);
      expect(byKey.get("admin")!.archived_at).toBeNull();
      const custom = roles.rows.find((r) => r.key === null)!;
      expect(custom.id).toBe(customId);
      expect(custom.name).toBe("Marketing");

      // Grant repair is idempotent: exactly the seed sets, no duplicates, and
      // NOTHING attached to the custom Role or the Owner.
      const grants = await scratchPool!.query<{ role_id: string }>(
        `SELECT "role_id" FROM "admin_role_grant"`
      );
      expect(grants.rows.filter((g) => g.role_id === hqId)).toHaveLength(
        HQ_SEED_GRANTS.length
      );
      expect(grants.rows.filter((g) => g.role_id === adminId)).toHaveLength(
        ADMIN_SEED_GRANTS.length
      );
      expect(grants.rows.filter((g) => g.role_id === ownerId)).toHaveLength(0);
      expect(grants.rows.filter((g) => g.role_id === customId)).toHaveLength(0);

      // Backfill used the legacy keys: '  HQ  ' → hq, 'admin' → admin.
      const assignments = await scratchPool!.query<{
        id: string;
        role_id: string;
      }>(`SELECT "id", "role_id" FROM "user"`);
      const byUser = new Map(assignments.rows.map((r) => [r.id, r.role_id]));
      expect(byUser.get(hqUserId)).toBe(hqId);
      expect(byUser.get(adminUserId)).toBe(adminId);

      // Legacy structures are gone.
      expect(await legacyColumnExists(scratchPool!)).toBe(false);
      const perm = await scratchPool!.query(
        `SELECT to_regclass('public.permission') IS NOT NULL AS ok`
      );
      expect(perm.rows[0]!.ok).toBe(false);

      // The recreated unique index carries the canonical expression.
      const indexdef = await recreatedIndexDef(scratchPool!);
      expect(indexdef).toMatch(/lower\(btrim\(regexp_replace\(/i);
      expect(indexdef).not.toMatch(/lower\(regexp_replace\(/i);
    },
    CUTOVER_TIMEOUT_MS
  );

  // -------------------------------------------------------------
  // Happy path B: clean cutover on a fresh chain (system Roles inserted)
  // -------------------------------------------------------------
  it(
    "cuts over a clean pre-cutover database (fresh system Roles + backfill)",
    async () => {
      // Rebuild a pristine scratch database from the real chain — this is the
      // second (final) migration-chain rebuild and gets the same explicit
      // timeout instead of Vitest's 5s default.
      await recreateScratchDatabase();
      await applyChainThrough0017(scratchPool!);

      const marketingId = await insertRole(scratchPool!, {
        key: null,
        name: "Marketing",
      });
      const hqUserId = await insertLegacyUser(scratchPool!, { role: "HQ" });
      const adminUserId = await insertLegacyUser(scratchPool!, { role: "admin" });

      const result = await run0018(scratchPool!);
      expect(result.ok).toBe(true);

      const roles = await scratchPool!.query<{
        key: string;
        name: string;
        is_system: boolean;
      }>(`SELECT "key", "name", "is_system" FROM "admin_role" WHERE "key" IS NOT NULL`);
      expect(roles.rows.map((r) => r.key).sort()).toEqual(
        [...INITIAL_ROLE_KEYS].sort()
      );
      expect(roles.rows.every((r) => r.is_system)).toBe(true);

      // Legacy display Names are preserved verbatim (System Owner / HQ / Admin).
      expect(roles.rows.map((r) => r.name).sort()).toEqual([
        "Admin",
        "HQ",
        "System Owner",
      ]);

      const adminId = (
        await scratchPool!.query<{ id: string }>(
          `SELECT "id" FROM "admin_role" WHERE "key" = 'admin'`
        )
      ).rows[0]!.id;
      const hqId = (
        await scratchPool!.query<{ id: string }>(
          `SELECT "id" FROM "admin_role" WHERE "key" = 'hq'`
        )
      ).rows[0]!.id;

      const byUser = new Map(
        (
          await scratchPool!.query<{ id: string; role_id: string }>(
            `SELECT "id", "role_id" FROM "user"`
          )
        ).rows.map((r) => [r.id, r.role_id])
      );
      expect(byUser.get(hqUserId)).toBe(hqId);
      expect(byUser.get(adminUserId)).toBe(adminId);

      // The custom Role receives NO grants (least-privilege cutover).
      const customGrants = await scratchPool!.query<{ role_id: string }>(
        `SELECT "role_id" FROM "admin_role_grant" WHERE "role_id" = $1`,
        [marketingId]
      );
      expect(customGrants.rows).toHaveLength(0);

      const indexdef = await recreatedIndexDef(scratchPool!);
      expect(indexdef).toMatch(/lower\(btrim\(regexp_replace\(/i);
      expect(indexdef).not.toMatch(/lower\(regexp_replace\(/i);
    },
    REBUILD_TIMEOUT_MS
  );
});

afterAll(async () => {
  // Close the scratch pool BEFORE dropping the database: a live connection
  // terminated by DROP ... WITH (FORCE) raises 57P01 ('terminating
  // connection due to administrator command') as an unhandled pg error.
  await dropScratchDatabase().catch(() => undefined);
  await scratchPool?.end().catch(() => undefined);
  await adminPool?.end().catch(() => undefined);
}, TEARDOWN_TIMEOUT_MS);