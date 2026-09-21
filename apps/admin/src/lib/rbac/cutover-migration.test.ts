import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// =========================================================
// DB schema: slice-9 cutover migration 0018 guard (permanent)
// =========================================================
// The RBAC cutover cannot be re-run on production data: it must ALWAYS
// preflight (fail fast on reserved-key squatters, canonical normalized-Name
// collisions and unexpected legacy role values), backfill `user.role_id`
// from the legacy `user.role` key BEFORE enforcing NOT NULL, assert the
// backfill was complete, and only then drop the legacy column/table —
// without destructive CASCADE. drizzle-kit cannot express data backfill, so
// the hand-completed statements are load-bearing; this test pins their
// presence and their relative order so a future regeneration cannot
// silently lose them.
//
// 0017 is an already-applied audit migration: the corrected
// `admin_role_name_normalized_unique` expression (trim + whitespace collapse
// + lowercase — identical to the application's normalizeRoleName) is
// implemented safely INSIDE 0018 as a post-preflight drop/recreate, so the
// pinned statements here are the source of truth for that repair.
// =========================================================

const DRIZZLE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../packages/db/drizzle"
);

const journal = JSON.parse(
  readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")
) as { entries: Array<{ idx: number; tag: string }> };

const cutoverEntry = journal.entries.at(-1)!;

function readCutoverSql(): string {
  return readFileSync(path.join(DRIZZLE_DIR, `${cutoverEntry.tag}.sql`), "utf8");
}

/**
 * Split a drizzle migration file into its ordered statements, with comment
 * lines stripped so assertions only see executable SQL (the header/inline
 * commentary must not satisfy code pins).
 */
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

function findIndex(stmts: string[], re: RegExp): number {
  const idx = stmts.findIndex((s) => re.test(s));
  expect(idx, `expected a statement matching ${re}`).toBeGreaterThanOrEqual(0);
  return idx;
}

// The canonical Role-Name normalization in SQL: trim + whitespace collapse +
// lowercase — identical to packages/db/src/rbac/catalog.ts normalizeRoleName.
//
// Built from the LITERAL SQL fragment so the regex metacharacters in it
// (notably the '+' of the \\s+ quantifier) are matched literally instead of
// acting as regex quantifiers — a hand-escaped regex like /'\\s+'/ silently
// quantifies the plus and then never matches the SQL at all.
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CANONICAL_NORM = new RegExp(
  escapeRegExp("lower(btrim(regexp_replace(") +
    '(?:"name"|"role"|u\\."role"|"admin_role"\\."name")' +
    escapeRegExp(", '\\s+', ' ', 'g')))")
);

/** Same canonical normalization pinned to one specific column. */
const CANONICAL_NORM_ON = (column: string) =>
  new RegExp(escapeRegExp(canonicalNormOn(column)));

function canonicalNormOn(column: string): string {
  return `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;
}

describe("RBAC slice-9 cutover migration (0018)", () => {
  it("is the latest journal entry", () => {
    expect(cutoverEntry.idx).toBe(18);
    expect(readdirSync(DRIZZLE_DIR).some((f) => f.startsWith("0018_"))).toBe(
      true
    );
  });

  it("keeps a consistent journal/snapshot pair", () => {
    const snapshot = JSON.parse(
      readFileSync(
        path.join(
          DRIZZLE_DIR,
          "meta",
          `${String(cutoverEntry.idx).padStart(4, "0")}_snapshot.json`
        ),
        "utf8"
      )
    ) as {
      tables: Record<string, unknown>;
    };
    expect(snapshot.tables["public.permission"]).toBeUndefined();
    const userColumns = (
      snapshot.tables["public.user"] as {
        columns: Record<string, { notNull?: boolean }>;
      }
    ).columns;
    expect(userColumns["role"]).toBeUndefined();
    expect(userColumns["role_id"]?.notNull).toBe(true);
  });

  it("pins the corrected canonical normalization in the 0018 snapshot (0017 keeps its historical expression)", () => {
    const readSnapshotIndex = (idx: number) => {
      const snapshot = JSON.parse(
        readFileSync(
          path.join(DRIZZLE_DIR, "meta", `${String(idx).padStart(4, "0")}_snapshot.json`),
          "utf8"
        )
      ) as {
        tables: Record<
          string,
          {
            indexes?: Record<
              string,
              { columns: Array<{ expression?: string; isExpression?: boolean }> }
            >;
          }
        >;
      };
      return snapshot.tables["public.admin_role"].indexes![
        "admin_role_name_normalized_unique"
      ];
    };
    // The 0018 snapshot reflects the state AFTER 0018 recreated the index:
    // trim + whitespace collapse + lowercase (canonical normalizeRoleName).
    expect(readSnapshotIndex(18).columns).toEqual([
      {
        expression: `lower(btrim(regexp_replace("name", '\\s+', ' ', 'g')))`,
        isExpression: true,
        asc: true,
        nulls: "last",
      },
    ]);
    // 0017 is historical (already applied): its snapshot must keep the
    // original (untrimmed) expression.
    expect(readSnapshotIndex(17).columns[0]!.expression).toBe(
      `lower(regexp_replace("name", '\\s+', ' ', 'g'))`
    );
  });

  it("preflights RESERVED-KEY squatters before any write", () => {
    const stmts = statements(readCutoverSql());
    // A row holding a code-owned key must BE the expected system Role
    // identity (is_system, not archived, canonical Name) — otherwise the
    // cutover would attach Initial-Role grants and backfilled users to an
    // arbitrary custom Role via ON CONFLICT ("key") DO NOTHING.
    const keyIdentity = findIndex(stmts, /reserved system key|expected system Role/i);
    expect(stmts[keyIdentity]).toMatch(/"key" IN \('system_owner', 'hq', 'admin'\)/);
    // Expected identity: system-owned, not archived, correct canonical Name.
    expect(stmts[keyIdentity]).toMatch(/"is_system" IS TRUE/);
    expect(stmts[keyIdentity]).toMatch(/"archived_at" IS NULL/);
    expect(stmts[keyIdentity]).toMatch(/CASE "key"/);
    expect(stmts[keyIdentity]).toMatch(CANONICAL_NORM);
    expect(stmts[keyIdentity]).toMatch(/RAISE EXCEPTION/);
    const firstWrite = findIndex(stmts, /INSERT INTO|UPDATE |ALTER TABLE/);
    expect(keyIdentity).toBeLessThan(firstWrite);
  });

  it("preflights canonical normalized-Name collisions before any write", () => {
    const stmts = statements(readCutoverSql());
    const nameCollision = findIndex(stmts, /normalized Role-Name collision/i);
    // Uses the canonical normalization (trim + whitespace collapse + lower)
    // of the RECREATED unique index — not the legacy untrimmed 0017 form.
    expect(stmts[nameCollision]).toMatch(CANONICAL_NORM);
    expect(stmts[nameCollision]).not.toMatch(
      /lower\(regexp_replace/ // legacy form without btrim must be gone
    );
    // Only non-system Roles are flagged: rows already keyed to a system Role
    // make the insert a no-op and must not trip the preflight.
    expect(stmts[nameCollision]).toMatch(
      /"key" IS NULL OR "key" NOT IN \('system_owner', 'hq', 'admin'\)/
    );
    // The offender list must be NULL-safe: a keyless custom Role would
    // otherwise NULL out the string_agg concatenation entirely and evade
    // the preflight (the exact regression that made trimmed collisions
    // surface as a cryptic unique-index violation instead).
    expect(stmts[nameCollision]).toMatch(/COALESCE\(/);
    // The preflight must run BEFORE the pinned index is dropped/recreated:
    // a trimmed collision ('Admin ') has to raise the readable preflight
    // message, not fail later inside CREATE UNIQUE INDEX.
    const dropIndex = findIndex(
      stmts,
      /DROP INDEX IF EXISTS "admin_role_name_normalized_unique"/
    );
    expect(nameCollision).toBeLessThan(dropIndex);
    // The recreated unique index would also fail on two existing rows that
    // share one canonical normalization — caught with a readable error.
    const duplicateCheck = stmts.findIndex(
      (s) => /GROUP BY/.test(s) && /HAVING count\(\*\) > 1/.test(s)
    );
    expect(duplicateCheck).toBeGreaterThanOrEqual(0);
    expect(stmts[duplicateCheck]).toMatch(CANONICAL_NORM);
    expect(stmts[duplicateCheck]).toMatch(/RAISE EXCEPTION/);
    const firstWrite = findIndex(stmts, /INSERT INTO|UPDATE |ALTER TABLE/);
    expect(nameCollision).toBeLessThan(firstWrite);
    expect(duplicateCheck).toBeLessThan(firstWrite);
  });

  it("fails fast on unexpected legacy role values instead of silently demoting", () => {
    const stmts = statements(readCutoverSql());
    const legacyPreflight = findIndex(stmts, /unexpected legacy user\.role/);
    expect(stmts[legacyPreflight]).toMatch(/RAISE EXCEPTION/);
    // Guarded so a manually recovered database without the legacy column
    // does not crash the preflight itself.
    expect(stmts[legacyPreflight]).toMatch(/to_regclass/);
    // Only the known legacy values are accepted, with the SAME canonical
    // normalization (trim + whitespace collapse + lower) used everywhere else.
    expect(stmts[legacyPreflight]).toMatch(
      new RegExp(
        escapeRegExp(`${canonicalNormOn('"role"')} NOT IN ('hq', 'admin')`)
      )
    );
    const firstWrite = findIndex(stmts, /INSERT INTO|UPDATE |ALTER TABLE/);
    expect(legacyPreflight).toBeLessThan(firstWrite);
  });

  it("recreates the normalized-Name index with the canonical expression after the preflights and before any insert", () => {
    const stmts = statements(readCutoverSql());
    const dropIndex = findIndex(
      stmts,
      /DROP INDEX IF EXISTS "admin_role_name_normalized_unique"/
    );
    const createIndex = findIndex(
      stmts,
      /CREATE UNIQUE INDEX "admin_role_name_normalized_unique" ON "admin_role" USING btree/
    );
    // Exactly one index is dropped, and only this one.
    expect(
      stmts.filter((s) => /DROP INDEX/.test(s)).map((s) => s)
    ).toHaveLength(1);
    // The recreated expression is the canonical trim + whitespace collapse +
    // lowercase normalization (identical to the application's
    // normalizeRoleName and the service duplicate query).
    expect(stmts[createIndex]).toMatch(CANONICAL_NORM);
    // Repair order: preflights → drop → recreate → system-Role insert (the
    // first write of the migration).
    const firstWrite = findIndex(stmts, /INSERT INTO|UPDATE |ALTER TABLE/);
    const seedRoles = findIndex(stmts, /INSERT INTO "admin_role"/);
    expect(dropIndex).toBeGreaterThan(0);
    expect(dropIndex).toBeLessThan(createIndex);
    expect(createIndex).toBeLessThan(seedRoles);
    expect(seedRoles).toBe(firstWrite);
  });

  it("backfills role_id from the legacy role key before enforcing NOT NULL", () => {
    const stmts = statements(readCutoverSql());
    const backfill = findIndex(stmts, /SET\s+"role_id"\s*=\s*r\."id"/i);
    const nullAssert = findIndex(stmts, /"role_id" IS NULL;\s*$/m);
    const notNull = findIndex(
      stmts,
      /ALTER TABLE "user" ALTER COLUMN "role_id" SET NOT NULL/
    );
    const dropRole = findIndex(stmts, /DROP COLUMN IF EXISTS "role"/);
    const dropPermission = findIndex(stmts, /DROP TABLE IF EXISTS "permission"/);

    // Safe order: preflight → seed roles/grants → backfill → null assert →
    // NOT NULL → drop legacy column → drop legacy table.
    const seedRoles = findIndex(stmts, /INSERT INTO "admin_role"/);
    expect(backfill).toBeLessThan(nullAssert);
    expect(nullAssert).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(dropRole);
    expect(dropRole).toBeLessThan(dropPermission);
    expect(seedRoles).toBeLessThan(backfill);
  });

  it("asserts no NULL role_id remains before enforcing NOT NULL", () => {
    const stmts = statements(readCutoverSql());
    const notNull = findIndex(
      stmts,
      /ALTER TABLE "user" ALTER COLUMN "role_id" SET NOT NULL/
    );
    const assertBlock = stmts.findIndex(
      (s) => /"role_id" IS NULL/.test(s) && /RAISE EXCEPTION/.test(s)
    );
    expect(assertBlock).toBeGreaterThanOrEqual(0);
    expect(assertBlock).toBeLessThan(notNull);
    // The assertion counts NULLs and aborts on any remainder.
    expect(stmts[assertBlock]).toMatch(/SELECT count\(\*\) INTO/);
    expect(stmts[assertBlock]).toMatch(/IF remaining > 0 THEN/);
  });

  it("ensures the system Roles exist idempotently before the backfill", () => {
    const stmts = statements(readCutoverSql());
    const ensureRoles = findIndex(stmts, /INSERT INTO "admin_role"/);
    expect(stmts[ensureRoles]).toMatch(/ON CONFLICT \("key"\) DO NOTHING/);
    // Asserted key-by-key (a combined role-name union literal would trip the
    // legacy-cutover source guard).
    expect(stmts[ensureRoles]).toMatch(/'system_owner'/);
    expect(stmts[ensureRoles]).toMatch(/'hq'/);
    expect(stmts[ensureRoles]).toMatch(/'admin'/);
    const stmtsBefore = stmts.slice(0, ensureRoles);
    // Only preflight DO blocks and the guarded index drop/recreate may
    // precede the seed insert.
    expect(
      stmtsBefore.every(
        (s) =>
          /^DO \$preflight\$/.test(s) ||
          /^DROP INDEX IF EXISTS "admin_role_name_normalized_unique";?$/.test(s) ||
          /^CREATE UNIQUE INDEX "admin_role_name_normalized_unique" ON "admin_role" USING btree/.test(s)
      )
    ).toBe(true);
  });

  it("repairs missing Initial-Role grants idempotently (no deny-all backfill)", () => {
    const stmts = statements(readCutoverSql());
    const grantRepair = findIndex(stmts, /INSERT INTO "admin_role_grant"/);
    expect(stmts[grantRepair]).toMatch(/WHERE NOT EXISTS/);
    expect(stmts[grantRepair]).toMatch(/'own_branch'/);
    expect(stmts[grantRepair]).toMatch(/'all_branches'/);
    expect(stmts[grantRepair]).toMatch(/'global'/);
  });

  it("maps only canonically-normalized 'hq' to the privileged Role; every other value falls back to 'admin'", () => {
    const stmts = statements(readCutoverSql());
    const backfill = stmts.find((s) =>
      /SET\s+"role_id"\s*=\s*r\."id"/i.test(s)
    )!;
    // Canonical normalization (trim + whitespace collapse + lower) so 'HQ',
    // ' hq ', 'HQ\t' etc. map to the HQ Role — identical to the app.
    expect(backfill).toMatch(
      new RegExp(
        escapeRegExp("WHEN ") +
          escapeRegExp(canonicalNormOn('u."role"')) +
          escapeRegExp(" = 'hq' THEN 'hq'") +
          "[\\s\\S]*" +
          escapeRegExp("ELSE 'admin'") +
          "[\\s\\S]*END"
      )
    );
    // Legacy column is the mapping source: it must still exist at backfill
    // time (dropped only afterwards).
    expect(backfill).toMatch(/u\."role"/);
  });

  it("drops the legacy column/table without CASCADE and recovery-safely", () => {
    const sql = readCutoverSql();
    // No destructive cascade: an unforeseen dependent object must fail the
    // migration loudly instead of being silently destroyed.
    expect(sql).not.toMatch(/DROP TABLE [^;]*CASCADE/);
    expect(sql).not.toMatch(/CASCADE;?\s*$/m);
    // Tail drops are IF EXISTS so re-runs after manual recovery are safe.
    expect(sql).toMatch(/ALTER TABLE "user" DROP COLUMN IF EXISTS "role"/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS "permission"/);
  });

  it("never drops constraints or foreign keys (only the pinned index is recreated)", () => {
    const sql = readCutoverSql();
    expect(sql).not.toMatch(/DROP CONSTRAINT/);
    expect(sql).not.toMatch(/DROP FOREIGN KEY/);
  });
});
