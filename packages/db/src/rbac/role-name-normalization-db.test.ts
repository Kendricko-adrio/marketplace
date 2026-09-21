import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

import { describe, expect, it, afterAll } from "vitest";
import { Pool } from "pg";

import { normalizeRoleName } from "./catalog";

// =========================================================
// DB seam: the admin_role_name_normalized_unique expression index must
// enforce EXACTLY the application's normalizeRoleName semantics (trim +
// whitespace collapse + lowercase) for ANY stored Name — including values
// written outside the application (manual SQL, pre-cutover data), where
// leading/trailing whitespace can reach the column.
// Requires the dev database with the RBAC schema — skipped when
// DATABASE_URL is not configured or unreachable.
// =========================================================

const url = process.env.DATABASE_URL;

async function dbReady(): Promise<boolean> {
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

const ready = await dbReady();

const pool = url ? new Pool({ connectionString: url, max: 1 }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!ready)("admin_role normalized-Name unique index (dev DB)", () => {
  it("uses the canonical trim + whitespace collapse + lowercase expression", async () => {
    const { rows } = await pool!.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'admin_role_name_normalized_unique'`
    );
    expect(rows).toHaveLength(1);
    // Canonical normalization: collapse runs of whitespace INSIDE a trim —
    // identical to packages/db/src/rbac/catalog.ts normalizeRoleName.
    // The legacy 0017 expression (lower(regexp_replace(...)) without btrim)
    // must no longer exist on the live schema.
    expect(rows[0]!.indexdef).toMatch(
      /lower\(btrim\(regexp_replace\(/i
    );
    expect(rows[0]!.indexdef).not.toMatch(
      /lower\(regexp_replace\(/i
    );
  });

  it("enforces uniqueness exactly like normalizeRoleName for a normalization sample matrix", async () => {
    // Extract the LIVE index expression and re-apply it to a throwaway probe
    // table, so the behavioral assertion is tied to the actual deployed
    // index definition — not to a copy of the expected SQL.
    //
    // A dedicated client (not pool.query) is REQUIRED: the pg pool rotates
    // the backend after a failed query, and temp tables are session-scoped.
    const { rows } = await pool!.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'admin_role_name_normalized_unique'`
    );
    const expr = /\((lower\(.*\))\)\s*$/.exec(rows[0]!.indexdef)?.[1];
    expect(expr).toBeDefined();

    const client = await pool!.connect();
    try {
      await client.query("DROP TABLE IF EXISTS pg_temp.zz_norm_probe");
      await client.query(
        `CREATE TEMP TABLE zz_norm_probe (
           id integer PRIMARY KEY,
           name text NOT NULL
         )`
      );
      await client.query(
        `CREATE UNIQUE INDEX zz_norm_probe_unique
         ON pg_temp.zz_norm_probe USING btree (${expr})`
      );

    // Every distinct name below must collide in the DB exactly when the
    // application's normalizeRoleName considers them equal.
    const samples = [
      "alpha",
      "ALPHA",
      "Alpha",
      " Alpha",
      "alpha ",
      "\talpha",
      "alpha\t",
      "beta",
      "beta  gamma",
      "BETA GAMMA",
      " beta\tgamma ",
      "delta",
      "Århus Ops",
      "århus ops ",
    ];

    const seenNormalized = new Set<string>();
    for (let i = 0; i < samples.length; i++) {
        const name = samples[i]!;
        const normalized = normalizeRoleName(name);
        const appSaysDuplicate = seenNormalized.has(normalized);

        let dbSaysDuplicate = false;
        try {
          await client.query(
            "INSERT INTO zz_norm_probe (id, name) VALUES ($1, $2)",
            [i, name]
          );
        } catch (error) {
          const code = (error as { code?: string }).code;
          expect(code, `unexpected DB error for ${JSON.stringify(name)}`).toBe(
            "23505"
          );
          dbSaysDuplicate = true;
        }

        expect(
          dbSaysDuplicate,
          `DB unique-index behavior for ${JSON.stringify(name)} must equal normalizeRoleName semantics`
        ).toBe(appSaysDuplicate);

        seenNormalized.add(normalized);
      }
    } finally {
      await client.query("DROP TABLE IF EXISTS pg_temp.zz_norm_probe");
      client.release();
    }
  });
});