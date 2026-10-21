/**
 * Seam T — evaluasi Offer terpilih untuk preview/place (ticket 07).
 * Read-only di preview; di place-order fungsi yang sama dipanggil di dalam
 * transaksi di bawah lock Offer. Expected literal independen.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";

const { evaluateSelectedPublicOffer, mapOfferReasonToHttp } = await import(
  "./discount-selection"
);

const url = process.env.DATABASE_URL;
const PREFIX = `discount-selection-${crypto.randomUUID()}`;
const clientId = `${PREFIX}-client`;
const clientOther = `${PREFIX}-client-other`;
const pool = url ? new Pool({ connectionString: url, max: 3 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const NOW = new Date("2026-10-21T10:00:00.000Z");

async function probe() {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const r = await pool!.query(
      `select to_regclass('public.discount_redemption') is not null as ready`
    );
    return r.rows[0]?.ready
      ? { ready: true, blocker: "" }
      : { ready: false, blocker: "discount redemption schema missing" };
  } catch (error) {
    return { ready: false, blocker: error instanceof Error ? error.message : String(error) };
  }
}
const schemaState = await probe();

it.skipIf(schemaState.ready)(
  "environment blocker: selected-Offer evaluation NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Selected-Offer tests NOT run — eligibility remains UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

let offerId: string;
let pausedOfferId: string;
let minimumOfferId: string;
let capacityOfferId: string;
let clientLimitOfferId: string;

async function createOffer(input: {
  id: string;
  name: string;
  state?: string;
  minSubtotal?: string;
  quotaCount?: number;
  budgetAmount?: string;
  perClientLimit?: number;
}) {
  await pool!.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [input.id, `${input.id}-key`]
  );
  await pool!.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,$3,'IDR',$4,now(),'fixture')`,
    [`${input.id}-revision`, input.id, input.name, input.minSubtotal ?? "0"]
  );
  await pool!.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods','25000')`,
    [`${input.id}-benefit`, `${input.id}-revision`]
  );
  await pool!.query(
    `update discount_offer set state=$2, current_revision_id=$3, quota_count=$4, budget_amount=$5, per_client_limit=$6
      where id=$1`,
    [
      input.id,
      input.state ?? "enabled",
      `${input.id}-revision`,
      input.quotaCount ?? 100,
      input.budgetAmount ?? "1000000",
      input.perClientLimit ?? 1,
    ]
  );
  await pool!.query(`insert into discount_offer_usage (offer_id) values ($1)`, [input.id]);
}

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true), ($4,$5,$6,true)`,
    [clientId, "Selection Fixture", `${clientId}@example.test`, clientOther, "Selection Other", `${clientOther}@example.test`]
  );
  offerId = `${PREFIX}-offer`;
  pausedOfferId = `${PREFIX}-offer-paused`;
  minimumOfferId = `${PREFIX}-offer-minimum`;
  capacityOfferId = `${PREFIX}-offer-capacity`;
  clientLimitOfferId = `${PREFIX}-offer-client-limit`;
  await createOffer({ id: offerId, name: "Seleksi Aktif" });
  await createOffer({ id: pausedOfferId, name: "Seleksi Paused", state: "paused" });
  await createOffer({ id: minimumOfferId, name: "Seleksi Minimum", minSubtotal: "250001" });
  await createOffer({ id: capacityOfferId, name: "Seleksi Kapasitas", quotaCount: 1 });
  await createOffer({ id: clientLimitOfferId, name: "Seleksi Jatah", perClientLimit: 1 });

  await pool.query(
    `update discount_offer_usage set reserved_count=1, reserved_amount='25000' where offer_id=$1`,
    [capacityOfferId]
  );
  await pool.query(
    `insert into discount_client_usage (offer_id, client_id, consumed_count, consumed_amount)
     values ($1,$2,1,'25000')`,
    [clientLimitOfferId, clientId]
  );
}, 30_000);

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]);
    await pool.query(
      `update discount_offer set state='draft', current_revision_id=null where id like $1`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from client where id in ($1,$2)`, [clientId, clientOther]);
  } finally {
    await pool.end();
  }
});

function evaluate(offer: string, overrides: { subtotal?: string; verifiedEmail?: boolean; client?: string } = {}) {
  return evaluateSelectedPublicOffer(
    {
      offerId: offer,
      clientId: overrides.client ?? clientId,
      verifiedEmail: overrides.verifiedEmail ?? true,
      subtotalAfterMarkdown: overrides.subtotal ?? "250000",
      now: NOW,
    },
    db!
  );
}

describe("evaluateSelectedPublicOffer", () => {
  it("Offer enabled dengan fixed25000 memberi benefit aktual25000", async () => {
    const result = await evaluate(offerId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate).toMatchObject({
      offerId,
      offerName: "Seleksi Aktif",
      revisionId: `${offerId}-revision`,
      benefitId: `${offerId}-benefit`,
      fixedAmount: "25000",
      benefitAmount: "25000",
      policyVersion: 1,
    });
  });

  it("clipping memakai subtotal setelah Markdown", async () => {
    const result = await evaluate(offerId, { subtotal: "10000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.benefitAmount).toBe("10000");
  });

  it("paused/minimum/jatah/kuota gagal dengan reason yang benar", async () => {
    expect(await evaluate(pausedOfferId)).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
    expect(await evaluate(minimumOfferId)).toMatchObject({ ok: false, reason: "MINIMUM_NOT_MET" });
    expect(await evaluate(capacityOfferId)).toMatchObject({ ok: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(await evaluate(clientLimitOfferId)).toMatchObject({ ok: false, reason: "CAPACITY_UNAVAILABLE" });
    expect(await evaluate(offerId, { verifiedEmail: false })).toMatchObject({
      ok: false,
      reason: "EMAIL_VERIFICATION_REQUIRED",
    });
  });

  it("Offer tidak dikenal tidak membocorkan existence (OFFER_UNAVAILABLE)", async () => {
    expect(await evaluate(`${PREFIX}-unknown`)).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
  });

  it("read-only: tidak membuat redemption dan tidak mengubah counter", async () => {
    const before = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount from discount_offer_usage where offer_id=$1`,
      [offerId]
    );
    await evaluate(offerId);
    const after = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount from discount_offer_usage where offer_id=$1`,
      [offerId]
    );
    expect(after.rows).toEqual(before.rows);
    const redemptions = await pool!.query(
      `select count(*)::int as count from discount_redemption where offer_id=$1`,
      [offerId]
    );
    expect(redemptions.rows[0].count).toBe(0);
  });
});

describe("mapOfferReasonToHttp", () => {
  it("memetakan reason ke code/status kontrak §5.4", () => {
    expect(mapOfferReasonToHttp("CAPACITY_UNAVAILABLE")).toEqual({
      status: 409,
      code: "PROMO_CAPACITY_UNAVAILABLE",
    });
    expect(mapOfferReasonToHttp("MINIMUM_NOT_MET")).toEqual({
      status: 409,
      code: "PROMO_INELIGIBLE",
    });
    expect(mapOfferReasonToHttp("EMAIL_VERIFICATION_REQUIRED")).toEqual({
      status: 403,
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
    expect(mapOfferReasonToHttp("WINDOW_CLOSED")).toEqual({
      status: 409,
      code: "PROMO_UNAVAILABLE",
    });
  });
});
