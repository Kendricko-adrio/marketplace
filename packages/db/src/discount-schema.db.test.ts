import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

// =========================================================
// Seam D (SQL) — discount administration constraints.
//
// Every assertion here is made through real SQL against the deployed tables
// (`discount_offer`, `discount_offer_revision`, `discount_offer_usage`), never
// against the TypeScript catalog or a private helper, so a rule that only
// exists in Drizzle source is not "verified" by this file. Expected values come
// from the spec (§4.3 count bounds, §8.2 publication completeness, §8.4 Offer
// state/pointer ownership), not from the code under test.
//
// The two regressions this file pins:
//   1. a PUBLISHED revision with name + min_subtotal but a NULL currency used
//      to be accepted, because `currency = 'IDR'` is NULL (not false) for a
//      NULL currency and NULL passes a CHECK;
//   2. a count/quota of 1000000001 — inside the approved §4.3 maximum
//      2147483647 — used to be rejected by a hardcoded 1000000000 bound.
//
// Fixture safety: the only rows written are the two Offer identities, their two
// revisions and their two usage projections below, all with constant ids. Rows
// are removed by exact id / exact owner in FK order, never by prefix-wide or
// table-wide deletion. Because the cleanup is destructive, DATABASE_URL must
// name a provably disposable database; anything else is a hard error, never a
// silent skip.
// =========================================================

const url = process.env.DATABASE_URL;

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
      `[discount-schema] Cannot parse a database name out of DATABASE_URL; ` +
        `refusing to create or delete fixtures. Expected a database name ` +
        `starting with "${TEST_DATABASE_PREFIX}".`
    );
  }
  if (!name.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(
      `[discount-schema] Refusing to mutate database "${name}": this spec ` +
        `deletes its fixtures by exact id, so DATABASE_URL must point at a ` +
        `database whose name starts with "${TEST_DATABASE_PREFIX}".`
    );
  }
}

if (url) assertDisposableDatabase(url);

// Constant identities, not per-run values: an interrupted run is repaired by
// the next run instead of leaking rows under a fresh time-based namespace.
const OFFER_A = "zz-fx-disc-schema-offer-a";
const OFFER_B = "zz-fx-disc-schema-offer-b";
const REV_A = "zz-fx-disc-schema-rev-a";
const REV_B = "zz-fx-disc-schema-rev-b";
const OWNED_OFFERS: readonly string[] = [OFFER_A, OFFER_B];
const REV_PCT = "zz-fx-disc-schema-rev-pct";
const OWNED_REVISIONS: readonly string[] = [REV_A, REV_B, REV_PCT];
/** Immutable attribution literal; no seeded admin user is required or touched
 * (the actor FK is nullable and `actor_identity` is the durable identity). */
const ACTOR = "zz-fx-disc-schema-actor";
/** §4.3 count/quantity maximum, quoted from the spec rather than from code. */
const COUNT_MAX = 2147483647;
/** Inside the approved maximum but above the bound that used to be hardcoded. */
const COUNT_INSIDE_MAX_ABOVE_OLD = 1000000001;

async function dbReady(): Promise<boolean> {
  if (!url) return false;
  const probe = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await probe.query(
      `select to_regclass('public.discount_offer') is not null
          and to_regclass('public.discount_offer_revision') is not null
          and to_regclass('public.discount_benefit') is not null
          and to_regclass('public.discount_offer_usage') is not null as ok`
    );
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    // Close on both paths; a throwing readiness probe must not leak a pool.
    await probe.end().catch(() => undefined);
  }
}

const ready = await dbReady();
const pool = ready && url ? new Pool({ connectionString: url, max: 2 }) : null;

type SqlError = { code?: string; constraint?: string | null };

async function captureError(run: () => Promise<unknown>): Promise<SqlError | null> {
  try {
    await run();
    return null;
  } catch (caught) {
    return caught as SqlError;
  }
}

/** Assert a CHECK rejection (SQLSTATE 23514) on a NAMED constraint. */
async function expectCheckViolation(
  label: string,
  run: () => Promise<unknown>
): Promise<SqlError> {
  const error = await captureError(run);
  expect(error, `${label} harus ditolak`).not.toBeNull();
  expect(error!.code, `${label} harus gagal dengan SQLSTATE 23514`).toBe("23514");
  expect(
    error!.constraint,
    `${label} harus gagal pada CHECK constraint bernama`
  ).toBeTruthy();
  return error!;
}

function insertRevision(
  id: string,
  offerId: string,
  revisionNo: number,
  terms: {
    name: string | null;
    currency: string | null;
    minSubtotal: string | null;
    published: boolean;
  }
): Promise<unknown> {
  return pool!.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END, $8)`,
    [id, offerId, revisionNo, terms.name, terms.currency, terms.minSubtotal, terms.published, ACTOR]
  );
}

/**
 * Remove ONLY this spec's rows, in FK order: clear the owned current-revision
 * pointers first (the pointer is RESTRICT and `discount_offer_live_requirements`
 * forbids a non-draft Offer without one, so the state is cleared with it), then
 * usage, then revisions, then the Offer identities.
 */
async function deleteOwnedFixtures(): Promise<void> {
  await pool!.query(
    `UPDATE discount_offer SET state = 'draft', current_revision_id = NULL
      WHERE id = ANY($1::text[])`,
    [OWNED_OFFERS]
  );
  await pool!.query(
    `DELETE FROM discount_offer_usage WHERE offer_id = ANY($1::text[])`,
    [OWNED_OFFERS]
  );
  await pool!.query(
    `DELETE FROM discount_benefit WHERE revision_id = ANY($1::text[])`,
    [OWNED_REVISIONS]
  );
  await pool!.query(
    `DELETE FROM discount_offer_revision
      WHERE offer_id = ANY($1::text[]) OR id = ANY($2::text[])`,
    [OWNED_OFFERS, OWNED_REVISIONS]
  );
  await pool!.query(`DELETE FROM discount_offer WHERE id = ANY($1::text[])`, [
    OWNED_OFFERS,
  ]);
}

/**
 * Baseline: two live public Offers, each with one COMPLETE published revision
 * and a zeroed usage projection. The Offer is inserted as a draft first because
 * the revision's `offer_id` FK needs the Offer to exist while the Offer's
 * composite `(id, current_revision_id)` FK needs the revision to exist — the
 * only legal order is draft(pointer NULL) → revision → publish the pointer.
 */
async function insertOwnedFixtures(): Promise<void> {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [OFFER_A, REV_A],
    [OFFER_B, REV_B],
  ];
  for (const [offerId, revisionId] of rows) {
    await pool!.query(
      `INSERT INTO discount_offer
         (id, key, activation_kind, state, current_revision_id, quota_count, per_client_limit, actor_identity)
       VALUES ($1, $2, 'public', 'draft', NULL, NULL, 1, $3)`,
      [offerId, `${offerId}-key`, ACTOR]
    );
    await insertRevision(revisionId, offerId, 1, {
      name: "Diskon uji SQL",
      currency: "IDR",
      minSubtotal: "0",
      published: true,
    });
    await pool!.query(
      `UPDATE discount_offer
          SET state = 'enabled', current_revision_id = $2, quota_count = 10
        WHERE id = $1`,
      [offerId, revisionId]
    );
    await pool!.query(
      `INSERT INTO discount_offer_usage
         (offer_id, reserved_count, consumed_count, reserved_amount, consumed_amount, version)
       VALUES ($1, 0, 0, '0', '0', 1)`,
      [offerId]
    );
    await pool!.query(
      `INSERT INTO discount_benefit
         (id, revision_id, kind, scope, fixed_amount, params_version)
       VALUES ($1, $2, 'fixed_goods', 'goods', '25000', 1)`,
      [`${revisionId}-benefit`, revisionId]
    );
  }
}

async function offerRow(offerId: string) {
  const { rows } = await pool!.query<{
    state: string;
    current_revision_id: string | null;
    quota_count: number | null;
    per_client_limit: number;
  }>(
    `SELECT state, current_revision_id, quota_count, per_client_limit
       FROM discount_offer WHERE id = $1`,
    [offerId]
  );
  return rows[0]!;
}

async function usageRow(offerId: string) {
  const { rows } = await pool!.query<{
    reserved_count: number;
    consumed_count: number;
  }>(
    `SELECT reserved_count, consumed_count
       FROM discount_offer_usage WHERE offer_id = $1`,
    [offerId]
  );
  return rows[0]!;
}

describe.skipIf(!ready)(
  "discount administration schema constraints (disposable DB)",
  () => {
    beforeEach(async () => {
      if (!pool) return;
      // Re-entrant: an interrupted previous run is repaired before fixtures are
      // re-created, so this never becomes a duplicate-key failure.
      await deleteOwnedFixtures();
      await insertOwnedFixtures();
    });

    afterAll(async () => {
      if (!pool) return;
      await deleteOwnedFixtures();
      await pool.end();
    });

    it("accepts a complete published revision (baseline control)", async () => {
      // The fixtures written for every test are themselves a publication; if
      // this row could not be stored, the rejection tests below would prove
      // nothing. Expected: two published revisions, one per owned Offer.
      const { rows } = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discount_offer_revision
          WHERE offer_id = ANY($1::text[]) AND published_at IS NOT NULL`,
        [OWNED_OFFERS]
      );
      expect(rows[0]!.count).toBe("2");
    });

    it("stores exactly one fixed-goods benefit per published revision (baseline control)", async () => {
      // The fixtures are themselves a legal publication (one fixed benefit per
      // revision). If this control could not be stored, the rejection tests
      // below would prove nothing.
      const { rows } = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discount_benefit
          WHERE revision_id = ANY($1::text[])
            AND kind = 'fixed_goods' AND scope = 'goods'
            AND fixed_amount = '25000' AND params_version = 1`,
        [OWNED_REVISIONS]
      );
      expect(rows[0]!.count).toBe("2");
    });

    it("accepts percentage_goods rate/cap and rejects mixed or out-of-range shapes", async () => {
      // Ticket 10: one typed benefit per revision, shape exact per kind. A
      // percentage row carries rate/cap and NO fixed nominal; mixed fields,
      // rate 0/>100 and cap 0 are refused by the shape CHECK, not defaulted.
      await insertRevision(REV_PCT, OFFER_A, 99, {
        name: "Diskon persentase uji SQL",
        currency: "IDR",
        minSubtotal: "0",
        published: true,
      });
      await pool!.query(
        `INSERT INTO discount_benefit
           (id, revision_id, kind, scope, rate, cap_amount, params_version)
         VALUES ('zz-fx-ben-pct', $1, 'percentage_goods', 'goods', '10.000000', '20000', 1)`,
        [REV_PCT]
      );
      const { rows } = await pool!.query<{ rate: string; cap_amount: string; fixed_amount: string | null }>(
        `SELECT rate, cap_amount, fixed_amount FROM discount_benefit WHERE id = 'zz-fx-ben-pct'`
      );
      expect(rows[0]).toEqual({ rate: "10.000000", cap_amount: "20000.00", fixed_amount: null });

      const invalid: ReadonlyArray<{ label: string; rate: string | null; cap: string | null; fixed: string | null }> = [
        { label: "percentage dengan fixed_amount", rate: "10", cap: null, fixed: "1000" },
        { label: "rate 0", rate: "0", cap: null, fixed: null },
        { label: "rate di atas 100", rate: "100.5", cap: null, fixed: null },
        { label: "rate NULL", rate: null, cap: null, fixed: null },
        { label: "cap 0", rate: "10", cap: "0", fixed: null },
        { label: "cap pecahan", rate: "10", cap: "20000.50", fixed: null },
      ];
      let index = 0;
      for (const testCase of invalid) {
        index += 1;
        const revisionId = `${REV_PCT}-invalid-${index}`;
        await insertRevision(revisionId, OFFER_A, 100 + index, {
          name: "Invalid percentage",
          currency: "IDR",
          minSubtotal: "0",
          published: true,
        });
        const error = await expectCheckViolation(testCase.label, () =>
          pool!.query(
            `INSERT INTO discount_benefit
               (id, revision_id, kind, scope, fixed_amount, rate, cap_amount, params_version)
             VALUES ($1, $2, 'percentage_goods', 'goods', $3, $4, $5, 1)`,
            [`${revisionId}-benefit`, revisionId, testCase.fixed, testCase.rate, testCase.cap]
          )
        );
        expect(error.code).toBe("23514");
      }
    });

    it("rejects a second benefit for the same revision", async () => {
      // Spec §8.1: exactly ONE typed benefit per revision. The unique index is
      // the physical guarantee; a second row is a write-path bug, not a merge.
      const error = await captureError(() =>
        pool!.query(
          `INSERT INTO discount_benefit
             (id, revision_id, kind, scope, fixed_amount, params_version)
           VALUES ('zz-fx-disc-schema-rev-a-benefit-2', $1, 'fixed_goods', 'goods', '10000', 1)`,
          [REV_A]
        )
      );
      expect(error, "benefit kedua harus ditolak").not.toBeNull();
      expect(error!.code).toBe("23505");
    });

    it("rejects an unknown benefit kind, scope, params version, or non-positive nominal", async () => {
      // Unknown kinds are refused, never defaulted to fixed goods (spec §8.2).
      const cases: ReadonlyArray<{
        label: string;
        id: string;
        kind: string;
        scope: string;
        amount: string;
        paramsVersion: number;
      }> = [
        { label: "kind percentage_goods", id: "zz-fx-ben-reject-kind", kind: "percentage_goods", scope: "goods", amount: "25000", paramsVersion: 1 },
        { label: "scope shipping", id: "zz-fx-ben-reject-scope", kind: "fixed_goods", scope: "shipping", amount: "25000", paramsVersion: 1 },
        { label: "params_version 2", id: "zz-fx-ben-reject-params", kind: "fixed_goods", scope: "goods", amount: "25000", paramsVersion: 2 },
        { label: "nominal 0", id: "zz-fx-ben-reject-zero", kind: "fixed_goods", scope: "goods", amount: "0", paramsVersion: 1 },
        { label: "nominal negatif", id: "zz-fx-ben-reject-negative", kind: "fixed_goods", scope: "goods", amount: "-1", paramsVersion: 1 },
        { label: "nominal pecahan", id: "zz-fx-ben-reject-fraction", kind: "fixed_goods", scope: "goods", amount: "1000.50", paramsVersion: 1 },
      ];
      for (const testCase of cases) {
        const error = await expectCheckViolation(testCase.label, () =>
          pool!.query(
            `INSERT INTO discount_benefit
               (id, revision_id, kind, scope, fixed_amount, params_version)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [testCase.id, REV_A, testCase.kind, testCase.scope, testCase.amount, testCase.paramsVersion]
          )
        );
        expect(error.code).toBe("23514");
      }
    });

    it("rejects a benefit whose revision does not exist", async () => {
      const error = await captureError(() =>
        pool!.query(
          `INSERT INTO discount_benefit
             (id, revision_id, kind, scope, fixed_amount, params_version)
           VALUES ('zz-fx-ben-reject-orphan', 'zz-fx-missing-revision', 'fixed_goods', 'goods', '25000', 1)`
        )
      );
      expect(error, "benefit tanpa revision harus ditolak").not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("rejects a published revision whose currency is NULL", async () => {
      // Regression: `currency = 'IDR'` is NULL — not false — for a NULL
      // currency, so with only that term the CHECK passed and an incomplete
      // publication could be stored. Name and min_subtotal ARE set here, so
      // currency is the only missing term.
      const error = await expectCheckViolation(
        "published revision dengan currency NULL",
        () =>
          insertRevision("zz-fx-disc-schema-rev-reject-null-currency", OFFER_A, 2, {
            name: "Diskon tanpa mata uang",
            currency: null,
            minSubtotal: "0",
            published: true,
          })
      );
      expect(error.constraint).toBe("discount_offer_revision_published_complete");

      const { rows } = await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discount_offer_revision
          WHERE offer_id = $1`,
        [OFFER_A]
      );
      expect(rows[0]!.count, "rejected revision must not persist").toBe("1");
    });

    it("rejects a published revision in a currency other than IDR", async () => {
      await expectCheckViolation(
        "published revision dengan currency USD",
        () =>
          insertRevision("zz-fx-disc-schema-rev-reject-usd", OFFER_A, 2, {
            name: "Diskon mata uang asing",
            currency: "USD",
            minSubtotal: "0",
            published: true,
          })
      );
    });

    it("keeps an incomplete unpublished draft revision legal", async () => {
      // Drafts are explicitly allowed to be incomplete (no name, no currency,
      // no minimum). Only publication requires the terms.
      await expect(
        insertRevision("zz-fx-disc-schema-rev-draft", OFFER_A, 2, {
          name: null,
          currency: null,
          minSubtotal: null,
          published: false,
        })
      ).resolves.toBeDefined();
    });

    it("accepts quota_count and per_client_limit up to the §4.3 maximum", async () => {
      // Regression: 1000000001 is inside the approved maximum 2147483647 and
      // must not be rejected by a narrower hardcoded bound.
      for (const value of [COUNT_INSIDE_MAX_ABOVE_OLD, COUNT_MAX]) {
        await expect(
          pool!.query(
            `UPDATE discount_offer SET quota_count = $2 WHERE id = $1`,
            [OFFER_A, value]
          ),
          `quota_count ${value} harus diterima`
        ).resolves.toBeDefined();
        expect((await offerRow(OFFER_A)).quota_count, String(value)).toBe(value);

        await expect(
          pool!.query(
            `UPDATE discount_offer SET per_client_limit = $2 WHERE id = $1`,
            [OFFER_A, value]
          ),
          `per_client_limit ${value} harus diterima`
        ).resolves.toBeDefined();
        expect((await offerRow(OFFER_A)).per_client_limit, String(value)).toBe(
          value
        );
      }
    });

    it("rejects a quota_count that is zero or above the int4 maximum", async () => {
      // A quota is a POSITIVE integer: 0 is a CHECK violation. A value above
      // 2147483647 cannot be representable at all, so Postgres refuses it
      // (22003) or a CHECK refuses it (23514) — what must never happen is a
      // silent clamp.
      await expectCheckViolation("quota_count 0", () =>
        pool!.query(`UPDATE discount_offer SET quota_count = 0 WHERE id = $1`, [
          OFFER_A,
        ])
      );
      const overflow = await captureError(() =>
        pool!.query(`UPDATE discount_offer SET quota_count = 2147483648 WHERE id = $1`, [
          OFFER_A,
        ])
      );
      expect(overflow, "quota_count di atas batas harus ditolak").not.toBeNull();
      expect(["23514", "22003"]).toContain(overflow!.code);
      expect((await offerRow(OFFER_A)).quota_count, "tidak boleh di-clamp").toBe(10);
    });

    it("rejects a per_client_limit below one", async () => {
      await expectCheckViolation("per_client_limit 0", () =>
        pool!.query(
          `UPDATE discount_offer SET per_client_limit = 0 WHERE id = $1`,
          [OFFER_A]
        )
      );
      expect((await offerRow(OFFER_A)).per_client_limit).toBe(1);
    });

    it("accepts usage counters up to the §7.1 maximum and rejects negatives", async () => {
      for (const value of [COUNT_INSIDE_MAX_ABOVE_OLD, COUNT_MAX]) {
        await expect(
          pool!.query(
            `UPDATE discount_offer_usage SET reserved_count = $2 WHERE offer_id = $1`,
            [OFFER_A, value]
          ),
          `reserved_count ${value} harus diterima`
        ).resolves.toBeDefined();
        await expect(
          pool!.query(
            `UPDATE discount_offer_usage SET consumed_count = $2 WHERE offer_id = $1`,
            [OFFER_A, value]
          ),
          `consumed_count ${value} harus diterima`
        ).resolves.toBeDefined();
        const row = await usageRow(OFFER_A);
        expect(row.reserved_count).toBe(value);
        expect(row.consumed_count).toBe(value);
      }

      await expectCheckViolation("reserved_count negatif", () =>
        pool!.query(
          `UPDATE discount_offer_usage SET reserved_count = -1 WHERE offer_id = $1`,
          [OFFER_A]
        )
      );
      await expectCheckViolation("consumed_count negatif", () =>
        pool!.query(
          `UPDATE discount_offer_usage SET consumed_count = -1 WHERE offer_id = $1`,
          [OFFER_A]
        )
      );
    });

    it("rejects a current revision pointer owned by another Offer", async () => {
      // The pointer is a COMPOSITE ownership FK (id, current_revision_id) →
      // (offer_id, id): pointing Offer B at Offer A's published revision must
      // fail with 23503, not silently rebind the publication.
      const error = await captureError(() =>
        pool!.query(
          `UPDATE discount_offer SET current_revision_id = $2 WHERE id = $1`,
          [OFFER_B, REV_A]
        )
      );
      expect(error, "pointer lintas Offer harus ditolak").not.toBeNull();
      expect(error!.code).toBe("23503");
      expect(
        (await offerRow(OFFER_B)).current_revision_id,
        "pointer lama harus bertahan"
      ).toBe(REV_B);
    });

    it("requires a current revision for every non-draft state, and allows the delete-only draft reset", async () => {
      // Seeder reset semantics: clearing the pointer ALONE on an enabled,
      // paused or archived Offer violates discount_offer_live_requirements, so
      // the development reset must clear the state with it. This is the SQL
      // contract behind that ordering (no app path ever restores `draft`).
      for (const state of ["enabled", "paused", "archived"]) {
        const error = await expectCheckViolation(
          `${state} tanpa current revision`,
          () =>
            pool!.query(
              `UPDATE discount_offer SET state = $2, current_revision_id = NULL WHERE id = $1`,
              [OFFER_B, state]
            )
        );
        expect(error.constraint).toBe("discount_offer_live_requirements");
      }

      await expect(
        pool!.query(
          `UPDATE discount_offer SET state = 'draft', current_revision_id = NULL WHERE id = $1`,
          [OFFER_B]
        ),
        "reset draft + pointer NULL harus diterima"
      ).resolves.toBeDefined();
      const row = await offerRow(OFFER_B);
      expect(row.state).toBe("draft");
      expect(row.current_revision_id).toBeNull();
    });
  }
);
