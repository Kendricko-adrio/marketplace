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

const {
  evaluateSelectedManualCode,
  evaluateSelectedOffer,
  evaluateSelectedPublicOffer,
  mapOfferReasonToHttp,
} = await import("./discount-selection");

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

const manualCodeId = `${PREFIX}-code-active`;
let offerId: string;
let pausedOfferId: string;
let minimumOfferId: string;
let capacityOfferId: string;
let clientLimitOfferId: string;
let manualOfferId: string;
let percentageOfferId: string;
let uncappedPercentageOfferId: string;
let manualInactiveCodeId: string;

async function createOffer(input: {
  id: string;
  name: string;
  state?: string;
  minSubtotal?: string;
  quotaCount?: number;
  budgetAmount?: string;
  perClientLimit?: number;
  activationKind?: "public" | "manual_only";
  /** Percentage goods (ticket 10); bila diisi, fixedAmount tidak dipakai. */
  rate?: string;
  capAmount?: string | null;
}) {
  await pool!.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,$3,'fixture')`,
    [input.id, `${input.id}-key`, input.activationKind ?? "public"]
  );
  await pool!.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,$3,'IDR',$4,now(),'fixture')`,
    [`${input.id}-revision`, input.id, input.name, input.minSubtotal ?? "0"]
  );
  if (input.rate) {
    await pool!.query(
      `insert into discount_benefit (id, revision_id, kind, scope, rate, cap_amount) values ($1,$2,'percentage_goods','goods',$3,$4)`,
      [`${input.id}-benefit`, `${input.id}-revision`, input.rate, input.capAmount ?? null]
    );
  } else {
    await pool!.query(
      `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods','25000')`,
      [`${input.id}-benefit`, `${input.id}-revision`]
    );
  }
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
  percentageOfferId = `${PREFIX}-offer-percentage`;
  uncappedPercentageOfferId = `${PREFIX}-offer-percentage-uncapped`;
  await createOffer({
    id: percentageOfferId,
    name: "Seleksi Persen Cap",
    rate: "10.000000",
    capAmount: "20000",
  });
  await createOffer({
    id: uncappedPercentageOfferId,
    name: "Seleksi Persen Tanpa Cap",
    rate: "12.5",
  });

  // Manual Promo Code (ticket 09): Offer manual_only + kode canonical,
  // kode nonaktif, dan kode milik Offer lain untuk membuktikan ownership.
  manualOfferId = `${PREFIX}-offer-manual`;
  manualInactiveCodeId = `${PREFIX}-code-inactive`;
  await createOffer({
    id: manualOfferId,
    name: "Seleksi Kode Manual",
    activationKind: "manual_only",
    quotaCount: 3,
  });
  await pool.query(
    `insert into discount_code (id, offer_id, canonical_code, state, actor_identity)
     values ($1,$2,'MANUAL17OK','active','fixture'), ($3,$4,'MANUAL17OFF','inactive','fixture')`,
    [manualCodeId, manualOfferId, manualInactiveCodeId, manualOfferId]
  );

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
    await pool.query(`delete from discount_code where offer_id like $1`, [`${PREFIX}%`]);
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
      benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" },
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

  it("percentage goods membawa rate/cap dan nominal floor/clip/cap pada subtotal450000", async () => {
    const capped = await evaluate(percentageOfferId, { subtotal: "450000" });
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.candidate.benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "10",
      capAmount: "20000",
    });
    expect(capped.candidate.benefitAmount).toBe("20000");

    const uncapped = await evaluate(uncappedPercentageOfferId, { subtotal: "450000" });
    expect(uncapped.ok).toBe(true);
    if (!uncapped.ok) return;
    expect(uncapped.candidate.benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "12.5",
      capAmount: null,
    });
    // 450000 × 12.5% = 56250
    expect(uncapped.candidate.benefitAmount).toBe("56250");
  });

  it("percentage dibulatkan floor dan benefit0 tidak eligible/tanpa usage", async () => {
    const floored = await evaluate(percentageOfferId, { subtotal: "100005" });
    expect(floored.ok).toBe(true);
    if (!floored.ok) return;
    expect(floored.candidate.benefitAmount).toBe("10000");

    // 3 × 12.5% = 0.375 → floor 0: benefit0 tidak pernah dipakai.
    const zero = await evaluate(uncappedPercentageOfferId, { subtotal: "3" });
    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(zero.reason).toBe("BENEFIT_UNAVAILABLE");
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

describe("Manual Promo Code resolution (ticket 09)", () => {
  function manual(input: {
    code: unknown;
    subtotal?: string;
    verifiedEmail?: boolean;
    client?: string;
  }) {
    return evaluateSelectedManualCode(
      {
        code: input.code,
        clientId: input.client ?? clientId,
        verifiedEmail: input.verifiedEmail ?? true,
        subtotalAfterMarkdown: input.subtotal ?? "250000",
        now: NOW,
      },
      db!
    );
  }

  it("literal trim/uppercase resolve ke Offer manual_only dan memakai benefit fixed yang sama", async () => {
    const result = await manual({ code: " manual17ok " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate).toMatchObject({
      offerId: manualOfferId,
      offerName: "Seleksi Kode Manual",
      activationKind: "manual_only",
      codeId: manualCodeId,
      benefitAmount: "25000",
    });
    // Engine publik tidak membuka Offer manual, dan channel manual tidak
    // membuka Offer publik walau codeId valid.
    expect(await evaluate(manualOfferId)).toMatchObject({
      ok: false,
      reason: "OFFER_UNAVAILABLE",
    });
    expect(
      await evaluateSelectedOffer(
        {
          offerId,
          clientId,
          verifiedEmail: true,
          subtotalAfterMarkdown: "250000",
          now: NOW,
          channel: "manual",
          codeId: manualCodeId,
        },
        db!
      )
    ).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
  });

  it("unknown/nonaktif/literal tidak sah = reason aman yang sama (tanpa discovery)", async () => {
    for (const code of [
      "neverissued17",
      "manual17off",
      "manual 17ok",
      "mánual17ok",
      "AB",
      "",
    ]) {
      expect(await manual({ code })).toMatchObject({
        ok: false,
        reason: "OFFER_UNAVAILABLE",
        message: "Promo ini sedang tidak tersedia.",
      });
    }
    // Kode valid milik Offer lain juga tidak membuka apa pun.
    expect(
      await evaluateSelectedOffer(
        {
          offerId: manualOfferId,
          clientId,
          verifiedEmail: true,
          subtotalAfterMarkdown: "250000",
          now: NOW,
          channel: "manual",
          codeId: `${PREFIX}-code-other`,
        },
        db!
      )
    ).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
  });

  it("kapasitas, minimum, verified email dan waktu memakai pemeriksaan bersama", async () => {
    expect(await manual({ code: "manual17ok", verifiedEmail: false })).toMatchObject({
      ok: false,
      reason: "EMAIL_VERIFICATION_REQUIRED",
    });
    await pool!.query(
      `update discount_offer_usage set reserved_count=3, reserved_amount='75000' where offer_id=$1`,
      [manualOfferId]
    );
    expect(await manual({ code: "manual17ok" })).toMatchObject({
      ok: false,
      reason: "CAPACITY_UNAVAILABLE",
    });
    await pool!.query(
      `update discount_offer_usage set reserved_count=0, reserved_amount='0' where offer_id=$1`,
      [manualOfferId]
    );
    await pool!.query(
      `update discount_offer_revision set end_at=$2 where id=$1`,
      [`${manualOfferId}-revision`, NOW]
    );
    expect(await manual({ code: "manual17ok" })).toMatchObject({
      ok: false,
      reason: "WINDOW_CLOSED",
    });
    await pool!.query(
      `update discount_offer_revision set end_at=null where id=$1`,
      [`${manualOfferId}-revision`]
    );
  });

  it("perubahan email akun tidak mereset usage atau mengubah jatah kode", async () => {
    const usageBefore = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [manualOfferId]
    );
    const before = await manual({ code: "manual17ok" });
    expect(before.ok).toBe(true);
    await pool!.query(`update client set email=$2 where id=$1`, [
      clientId,
      `changed-${PREFIX}@example.test`,
    ]);
    const after = await manual({ code: "manual17ok" });
    expect(after.ok).toBe(true);
    const usageAfter = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [manualOfferId]
    );
    expect(usageAfter.rows).toEqual(usageBefore.rows);
  });

  it("read-only: tidak membuat redemption/usage saat resolve kode", async () => {
    const before = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [manualOfferId]
    );
    await manual({ code: "manual17ok" });
    const after = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [manualOfferId]
    );
    expect(after.rows).toEqual(before.rows);
    const redemptions = await pool!.query(
      `select count(*)::int as count from discount_redemption where offer_id=$1`,
      [manualOfferId]
    );
    expect(redemptions.rows[0].count).toBe(0);
  });
});
