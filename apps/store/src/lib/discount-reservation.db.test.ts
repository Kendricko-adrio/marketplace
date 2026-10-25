/**
 * Seam T — reservation/consume/release races dan rollback (ticket 07).
 *
 * Real PostgreSQL (disposable DATABASE_URL). Semua assertion lewat public
 * module seam yang juga dipakai route, bukan private query. Barrier konkuren
 * memakai dua promise yang start bersamaan; PostgreSQL yang menyerialkan.
 *
 * A skip is not a pass: the visible blocker test fails when the schema is
 * missing.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";

const {
  consumeReservedRedemption,
  lockRedemptionOwners,
  recordLatePaidReview,
  releaseReservedRedemption,
} = await import("./discount-lifecycle");
const {
  reserveRedemptionForOrder,
  writeOrderDiscountAllocations,
} = await import("./discount-reservation");

const url = process.env.DATABASE_URL;
const PREFIX = `discount-reservation-${crypto.randomUUID()}`;
const clientA = `${PREFIX}-client-a`;
const clientB = `${PREFIX}-client-b`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantId = `${PREFIX}-variant`;
const variantB = `${PREFIX}-variant-2`;
const offerId = `${PREFIX}-offer`;
const revisionId = `${PREFIX}-revision`;
const benefitId = `${PREFIX}-benefit`;
const pctOfferId = `${PREFIX}-pct-offer`;
const pctRevisionId = `${PREFIX}-pct-revision`;
const pctBenefitId = `${PREFIX}-pct-benefit`;
const pool = url ? new Pool({ connectionString: url, max: 6 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;

async function probe() {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const r = await pool!.query(
      `select to_regclass('public.discount_redemption') is not null as ready`
    );
    return r.rows[0]?.ready
      ? { ready: true, blocker: "" }
      : { ready: false, blocker: "redemption schema missing — apply migrations 0043/0044" };
  } catch (error) {
    return { ready: false, blocker: error instanceof Error ? error.message : String(error) };
  }
}
const schemaState = await probe();

it.skipIf(schemaState.ready)(
  "environment blocker: Redemption reservation races NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Reservation race tests NOT run — reserve/consume/release safety remains UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

const pricing = evaluatePricing({
  fulfillmentMethod: "pickup",
  ppnRatePercent: "11",
  lines: [
    {
      variantId,
      quantity: 1,
      sourceUnitPrice: "150000",
      effectiveUnitPrice: "150000",
    },
  ],
  benefit: { kind: "fixed_goods" as const, paramsVersion: 1 as const, fixedAmount: "25000" },
});

const candidate = {
  offerId,
  offerName: "Fixture Coupon",
  activationKind: "public" as const,
  codeId: null,
  revisionId,
  benefitId,
  policyVersion: 1,
  benefit: { kind: "fixed_goods" as const, paramsVersion: 1 as const, fixedAmount: "25000" },
  benefitAmount: "25000",
  minSubtotal: "0",
  startAt: null,
  endAt: null,
};
const deadline = new Date("2026-10-21T12:00:00.000Z");

let orderSeq = 0;
async function createOrder(clientId: string): Promise<string> {
  orderSeq += 1;
  const orderId = `${PREFIX}-order-${orderSeq}`;
  await pool!.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, total)
     values ($1,$2,$3,'08123456789','fixture@example.test','150000','25000','138750')`,
    [orderId, clientId, branchId]
  );
  await pool!.query(
    `insert into order_item (id, order_id, variant_id, product_name, price, quantity,
       pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount, net_line_amount)
     values ($1,$2,$3,'Fixture','150000',1,1,'150000','0','25000','125000')`,
    [`${orderId}-item`, orderId, variantId]
  );
  return orderId;
}

async function reserve(
  orderId: string,
  clientId: string,
  candidateOverride: typeof candidate | {
    offerId: string;
    offerName: string;
    activationKind: "manual_only";
    codeId: string;
    revisionId: string;
    benefitId: string;
    policyVersion: number;
    benefit: { kind: "fixed_goods"; paramsVersion: 1; fixedAmount: string };
    benefitAmount: string;
    minSubtotal: string;
    startAt: null;
    endAt: null;
  } = candidate
) {
  return db!.transaction((tx) =>
    reserveRedemptionForOrder(tx, {
      orderId,
      clientId,
      verifiedEmail: true,
      candidate: candidateOverride,
      deadline,
      pricing,
      subtotalAfterMarkdown: pricing.subtotal,
    })
  );
}

async function race<T>(work: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = work.map((fn) => (async () => {
    await gate;
    return fn();
  })());
  release();
  return Promise.allSettled(running);
}

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true), ($4,$5,$6,true)`,
    [clientA, "Reserve A", `${clientA}@example.test`, clientB, "Reserve B", `${clientB}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,$2,$3,'Test','Test')`,
    [branchId, "Reserve Fixture", PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,$2,$3,'150000')`,
    [productId, "Reserve Fixture", PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values ($1,$2,$3,'150000'), ($4,$2,$5,'100000')`,
    [variantId, productId, PREFIX, variantB, `${PREFIX}-sku-2`]
  );
  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [offerId, `${offerId}-key`]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Fixture Coupon','IDR','0',now(),'fixture')`,
    [revisionId, offerId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values ($1,$2,'fixed_goods','goods','25000')`,
    [benefitId, revisionId]
  );
  await pool.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=100, budget_amount='1000000'
      where id=$1`,
    [offerId, revisionId]
  );
  await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [offerId]);

  // Percentage goods (ticket 10): rate10 cap20000, kuota/budget sama kontraknya.
  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [pctOfferId, `${pctOfferId}-key`]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Percentage Coupon','IDR','0',now(),'fixture')`,
    [pctRevisionId, pctOfferId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, rate, cap_amount)
     values ($1,$2,'percentage_goods','goods','10.000000','20000')`,
    [pctBenefitId, pctRevisionId]
  );
  await pool.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=100, budget_amount='1000000'
      where id=$1`,
    [pctOfferId, pctRevisionId]
  );
  await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [pctOfferId]);
}, 30_000);

beforeEach(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `delete from discount_redemption_event where redemption_id in (select id from discount_redemption where offer_id=$1)`,
    [offerId]
  );
  await pool.query(`delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from discount_redemption where offer_id=$1`, [offerId]);
  await pool.query(`delete from discount_client_usage where offer_id=$1`, [offerId]);
  // Fixture manual (ticket 09) memakai prefiks yang sama.
  await pool.query(
    `delete from discount_redemption_event where redemption_id in
       (select id from discount_redemption where offer_id like $1)`,
    [`${PREFIX}%`]
  );
  await pool.query(`delete from discount_redemption where offer_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
  await pool.query(
    `update discount_offer_usage set reserved_count=0, consumed_count=0,
       reserved_amount='0', consumed_amount='0', version=1 where offer_id=$1`,
    [offerId]
  );
  await pool.query(
    `update discount_offer set state='enabled', quota_count=100, budget_amount='1000000',
       per_client_limit=1 where id=$1`,
    [offerId]
  );
});

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(
      `delete from discount_redemption_event where redemption_id in (select id from discount_redemption where offer_id=$1)`,
      [offerId]
    );
    await pool.query(`delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_redemption where offer_id=$1`, [offerId]);
    await pool.query(`delete from discount_client_usage where offer_id=$1`, [offerId]);
    // Fixture ticket 09 (manual Offer) memakai id berprefiks sama; bersihkan
    // sebelum orders dihapus agar FK RESTRICT tidak menggagalkan cleanup.
    await pool.query(
      `delete from discount_redemption_event where redemption_id in
         (select id from discount_redemption where offer_id like $1)`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_redemption where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
    // Percentage fixture (ticket 10) memakai prefiks yang sama.
    await pool.query(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]);
    await pool.query(
      `update discount_offer set state='draft', current_revision_id=null where id like $1`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer_usage where offer_id=$1`, [offerId]);
    await pool.query(`delete from discount_benefit where revision_id=$1`, [revisionId]);
    await pool.query(
      `update discount_offer set state='draft', current_revision_id=null where id=$1`,
      [offerId]
    );
    await pool.query(`delete from discount_offer_revision where offer_id=$1`, [offerId]);
    await pool.query(`delete from discount_offer where id=$1`, [offerId]);
    await pool.query(`delete from product_variant where id in ($1,$2)`, [variantId, variantB]);
    await pool.query(`delete from product where id=$1`, [productId]);
    await pool.query(`delete from branch where id=$1`, [branchId]);
    await pool.query(`delete from client where id in ($1,$2)`, [clientA, clientB]);
  } finally {
    await pool.end();
  }
});

async function counters() {
  const usage = await pool!.query(
    `select reserved_count, consumed_count, reserved_amount, consumed_amount
       from discount_offer_usage where offer_id=$1`,
    [offerId]
  );
  const client = await pool!.query(
    `select client_id, reserved_count, consumed_count, reserved_amount, consumed_amount
       from discount_client_usage where offer_id=$1 order by client_id`,
    [offerId]
  );
  return { usage: usage.rows[0], clients: client.rows };
}

async function redemptionRows() {
  const result = await pool!.query(
    `select id, order_id, client_id, status, benefit_amount from discount_redemption
      where offer_id=$1 order by created_at`,
    [offerId]
  );
  return result.rows;
}

describe("reserveRedemptionForOrder — kapasitas tidak oversell", () => {
  it("dua akun berebut kuota terakhir: tepat satu reservasi penuh", async () => {
    await pool!.query(`update discount_offer set quota_count=1 where id=$1`, [offerId]);
    const orders = await Promise.all([createOrder(clientA), createOrder(clientB)]);
    const results = await race([
      () => reserve(orders[0], clientA),
      () => reserve(orders[1], clientB),
    ]);
    const values = results.map((result) =>
      result.status === "fulfilled" ? result.value : { ok: false, reason: "THREW" }
    );
    expect(values.filter((value) => value.ok)).toHaveLength(1);
    expect(values.filter((value) => !value.ok)).toHaveLength(1);
    expect(values.find((value) => !value.ok)).toMatchObject({
      ok: false,
      reason: "CAPACITY_UNAVAILABLE",
    });
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 1,
      consumed_count: 0,
      reserved_amount: "25000.00",
    });
    expect(await redemptionRows()).toHaveLength(1);
  });

  it("dua akun berebut budget terakhir: sisa15000 untuk benefit25000 ditolak, bukan diperkecil", async () => {
    await pool!.query(
      `update discount_offer set quota_count=100, budget_amount='25000' where id=$1`,
      [offerId]
    );
    const orders = await Promise.all([createOrder(clientA), createOrder(clientB)]);
    const results = await race([
      () => reserve(orders[0], clientA),
      () => reserve(orders[1], clientB),
    ]);
    const values = results.map((result) =>
      result.status === "fulfilled" ? result.value : { ok: false, reason: "THREW" }
    );
    expect(values.filter((value) => value.ok)).toHaveLength(1);
    expect(values.find((value) => !value.ok)).toMatchObject({
      reason: "CAPACITY_UNAVAILABLE",
    });
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_amount: "25000.00",
      consumed_amount: "0.00",
    });
    const redemptions = await redemptionRows();
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].benefit_amount).toBe("25000.00");
  });

  it("satu akun berebut jatah1: hanya satu reservasi", async () => {
    const orders = await Promise.all([createOrder(clientA), createOrder(clientA)]);
    const results = await race([
      () => reserve(orders[0], clientA),
      () => reserve(orders[1], clientA),
    ]);
    const values = results.map((result) =>
      result.status === "fulfilled" ? result.value : { ok: false, reason: "THREW" }
    );
    expect(values.filter((value) => value.ok)).toHaveLength(1);
    expect(values.find((value) => !value.ok)).toMatchObject({
      reason: "CAPACITY_UNAVAILABLE",
    });
    const state = await counters();
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]).toMatchObject({ reserved_count: 1, reserved_amount: "25000.00" });
  });

  it("jatah konfigurasi2: dari tiga reservasi paralel hanya dua diterima", async () => {
    await pool!.query(`update discount_offer set per_client_limit=2 where id=$1`, [offerId]);
    const orders = await Promise.all([
      createOrder(clientA),
      createOrder(clientA),
      createOrder(clientA),
    ]);
    const results = await race(orders.map((order) => () => reserve(order, clientA)));
    const values = results.map((result) =>
      result.status === "fulfilled" ? result.value : { ok: false, reason: "THREW" }
    );
    expect(values.filter((value) => value.ok)).toHaveLength(2);
    const state = await counters();
    expect(state.clients[0]).toMatchObject({ reserved_count: 2, reserved_amount: "50000.00" });
  });

  it("reservasi serial terhadap pause: Offer yang dipause tidak bisa direservasi", async () => {
    const orderId = await createOrder(clientA);
    const lockClient = await pool!.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(`select id from discount_offer where id=$1 for update`, [offerId]);
      const pending = reserve(orderId, clientA);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await lockClient.query(`update discount_offer set state='paused' where id=$1`, [offerId]);
      await lockClient.query("COMMIT");
      const result = await pending;
      expect(result).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
    } finally {
      lockClient.release();
    }
    expect(await redemptionRows()).toHaveLength(0);
  });

  it("pause hanya menghentikan reservasi baru: hold lama tetap snapshot dan tetap bisa release", async () => {
    const heldOrder = await createOrder(clientA);
    const held = await reserve(heldOrder, clientA);
    if (!held.ok) throw new Error("fixture reserve failed");

    // Pause an Offer with an existing hold: nothing is mass-cancelled, repriced
    // or force-released; the Redemption snapshot and capacity stay as they were.
    await pool!.query(`update discount_offer set state='paused' where id=$1`, [offerId]);
    const heldRows = await redemptionRows();
    expect(heldRows).toHaveLength(1);
    expect(heldRows[0]).toMatchObject({
      order_id: heldOrder,
      status: "reserved",
      benefit_amount: "25000.00",
    });

    // No NEW reservation can start while paused.
    const blockedOrder = await createOrder(clientB);
    expect(await reserve(blockedOrder, clientB)).toMatchObject({
      ok: false,
      reason: "OFFER_UNAVAILABLE",
    });
    expect(await redemptionRows()).toHaveLength(1);

    // The held order can still reach its authoritative terminal outcome: a safe
    // release returns capacity exactly once (pause never freezes lifecycle).
    await db!.transaction((tx) =>
      releaseReservedRedemption(tx, {
        identity: { offerId, clientId: clientA, benefitAmount: "25000" },
        orderId: heldOrder,
        source: "fixture-cancel",
        reason: "safe cancel while paused",
      })
    );
    const after = await redemptionRows();
    expect(after[0].status).toBe("released");
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      consumed_count: 0,
      reserved_amount: "0.00",
    });
  });
});

describe("lifecycle consume/release/review — tepat sekali", () => {
  async function reserved() {
    const orderId = await createOrder(clientA);
    const result = await reserve(orderId, clientA);
    if (!result.ok) throw new Error("fixture reserve failed");
    return { orderId, redemptionId: result.redemptionId };
  }

  it("consume sekali: paid tidak menggandakan counter/event", async () => {
    const { orderId, redemptionId } = await reserved();
    const identity = { offerId, clientId: clientA, benefitAmount: "25000" };
    const first = await db!.transaction(async (tx) => {
      await lockRedemptionOwners(tx, identity);
      return consumeReservedRedemption(tx, {
        identity,
        redemptionId,
        source: "midtrans",
        correlation: "tx-1",
      });
    });
    const second = await db!.transaction(async (tx) => {
      await lockRedemptionOwners(tx, identity);
      return consumeReservedRedemption(tx, {
        identity,
        redemptionId,
        source: "midtrans",
        correlation: "tx-1",
      });
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      consumed_count: 1,
      reserved_amount: "0.00",
      consumed_amount: "25000.00",
    });
    const events = await pool!.query(
      `select kind from discount_redemption_event where redemption_id=$1 order by created_at`,
      [redemptionId]
    );
    expect(events.rows.map((row) => row.kind)).toEqual(["reserved", "consumed"]);
    const row = await pool!.query(
      `select status from discount_redemption where order_id=$1`,
      [orderId]
    );
    expect(row.rows[0].status).toBe("consumed");
  });

  it("release sekali: counter kembali dan event released tunggal", async () => {
    const { orderId, redemptionId } = await reserved();
    const identity = { offerId, clientId: clientA, benefitAmount: "25000" };
    const release = () =>
      db!.transaction(async (tx) => {
        await lockRedemptionOwners(tx, identity);
        return releaseReservedRedemption(tx, {
          identity,
          orderId,
          source: "jubelio-cancel",
          reason: "confirmed cancel",
        });
      });
    expect(await release()).toBe(true);
    expect(await release()).toBe(false);
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      consumed_count: 0,
      reserved_amount: "0.00",
      consumed_amount: "0.00",
    });
    expect(state.clients[0]).toMatchObject({ reserved_count: 0, reserved_amount: "0.00" });
    const events = await pool!.query(
      `select kind from discount_redemption_event where redemption_id=$1 order by created_at`,
      [redemptionId]
    );
    expect(events.rows.map((row) => row.kind)).toEqual(["reserved", "released"]);
  });

  it("late paid setelah release: satu event review, tetap released, tanpa reacquire kapasitas", async () => {
    const { orderId, redemptionId } = await reserved();
    const identity = { offerId, clientId: clientA, benefitAmount: "25000" };
    await db!.transaction(async (tx) => {
      await lockRedemptionOwners(tx, identity);
      await releaseReservedRedemption(tx, {
        identity,
        orderId,
        source: "jubelio-cancel",
        reason: "confirmed cancel",
      });
    });
    const review = () =>
      db!.transaction(async (tx) =>
        recordLatePaidReview(tx, {
          orderId,
          correlation: "tx-late-1",
          reason: "Late payment after release",
        })
      );
    expect(await review()).toBe(true);
    expect(await review()).toBe(false);
    const row = await pool!.query(
      `select status from discount_redemption where id=$1`,
      [redemptionId]
    );
    expect(row.rows[0].status).toBe("released");
    const state = await counters();
    expect(state.usage).toMatchObject({ reserved_count: 0, consumed_count: 0 });
    const events = await pool!.query(
      `select kind, count(*)::int as count from discount_redemption_event
        where redemption_id=$1 group by kind order by kind`,
      [redemptionId]
    );
    expect(Object.fromEntries(events.rows.map((row) => [row.kind, row.count]))).toEqual({
      late_paid_review: 1,
      released: 1,
      reserved: 1,
    });
  });

  it("late paid saat hold belum dilepas: consume hold, bukan release", async () => {
    const { orderId, redemptionId } = await reserved();
    const identity = { offerId, clientId: clientA, benefitAmount: "25000" };
    const consumed = await db!.transaction(async (tx) => {
      await lockRedemptionOwners(tx, identity);
      return consumeReservedRedemption(tx, {
        identity,
        redemptionId,
        source: "midtrans",
        correlation: "tx-late-2",
        reason: "late payment with active cancel path",
      });
    });
    expect(consumed).toBe(true);
    const row = await pool!.query(
      `select status from discount_redemption where order_id=$1`,
      [orderId]
    );
    expect(row.rows[0].status).toBe("consumed");
    const state = await counters();
    expect(state.usage).toMatchObject({ reserved_count: 0, consumed_count: 1 });
  });

  it("rollback penuh: kegagalan setelah reserve tidak meninggalkan Redemption/usage/event", async () => {
    const orderId = await createOrder(clientA);
    await expect(
      db!.transaction(async (tx) => {
        const result = await reserveRedemptionForOrder(tx, {
          orderId,
          clientId: clientA,
          verifiedEmail: true,
          candidate,
          deadline,
          pricing,
          subtotalAfterMarkdown: pricing.subtotal,
        });
        if (!result.ok) throw new Error("reserve failed");
        throw new Error("simulated failure after reserve");
      })
    ).rejects.toThrow("simulated failure after reserve");
    expect(await redemptionRows()).toHaveLength(0);
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      reserved_amount: "0.00",
    });
    expect(state.clients).toHaveLength(0);
    const events = await pool!.query(
      `select count(*)::int as count from discount_redemption_event where redemption_id like $1`,
      [`${PREFIX}%`]
    );
    expect(events.rows[0].count).toBe(0);
  });
});

describe("writeOrderDiscountAllocations", () => {
  it("menyimpan Markdown dan offer_goods positif per line, tanpa allocation0", async () => {
    const orderId = await createOrder(clientA);
    const snapshot = evaluatePricing({
      fulfillmentMethod: "pickup",
      ppnRatePercent: "11",
      lines: [
        {
          variantId,
          quantity: 1,
          sourceUnitPrice: "300000",
          effectiveUnitPrice: "150000",
          markdownRevisionId: `${PREFIX}-markdown-revision`,
        },
        {
          variantId: variantB,
          quantity: 1,
          sourceUnitPrice: "100000",
          effectiveUnitPrice: "100000",
        },
      ],
      benefit: { kind: "fixed_goods" as const, paramsVersion: 1 as const, fixedAmount: "25000" },
    });
    await pool!.query(
      `insert into order_item (id, order_id, variant_id, product_name, price, quantity)
       values ($1,$2,$3,'Second','100000',1)`,
      [`${orderId}-item-2`, orderId, variantB]
    );
    const itemIds = new Map([
      [variantId, `${orderId}-item`],
      [variantB, `${orderId}-item-2`],
    ]);
    const reservation = await reserve(orderId, clientA);
    if (!reservation.ok) throw new Error("fixture reserve failed");

    await db!.transaction((tx) =>
      writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: itemIds,
        pricing: snapshot,
        redemption: { id: reservation.redemptionId, benefitId },
      })
    );

    const rows = await pool!.query(
      `select component, order_item_id, amount from order_discount_allocation
        where order_id=$1 order by component, amount desc`,
      [orderId]
    );
    expect(rows.rows).toEqual([
      { component: "markdown", order_item_id: `${orderId}-item`, amount: "150000.00" },
      { component: "offer_goods", order_item_id: `${orderId}-item`, amount: "15000.00" },
      { component: "offer_goods", order_item_id: `${orderId}-item-2`, amount: "10000.00" },
    ]);
  });
});

// =========================================================
// Seam T — reservasi Manual Promo Code memakai counters bersama (ticket 09)
// =========================================================
describe("reserveRedemptionForOrder — Manual Promo Code", () => {
  const manualOffer = `${PREFIX}-manual-offer`;
  const manualRevision = `${manualOffer}-revision`;
  const manualBenefit = `${manualOffer}-benefit`;
  const manualCode = `${PREFIX}-manual-code`;

  const manualCandidate = {
    offerId: manualOffer,
    offerName: "Manual Fixture",
    activationKind: "manual_only" as const,
    codeId: manualCode,
    revisionId: manualRevision,
    benefitId: manualBenefit,
    policyVersion: 1,
    benefit: { kind: "fixed_goods" as const, paramsVersion: 1 as const, fixedAmount: "25000" },
    benefitAmount: "25000",
    minSubtotal: "0",
    startAt: null,
    endAt: null,
  };

  beforeAll(async () => {
    if (!pool || !schemaState.ready) return;
    await pool.query(
      `insert into discount_offer (id, key, activation_kind, actor_identity)
       values ($1,$2,'manual_only','fixture')`,
      [manualOffer, `${manualOffer}-key`]
    );
    await pool.query(
      `insert into discount_offer_revision
         (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
       values ($1,$2,1,'Manual Fixture','IDR','0',now(),'fixture')`,
      [manualRevision, manualOffer]
    );
    await pool.query(
      `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount)
       values ($1,$2,'fixed_goods','goods','25000')`,
      [manualBenefit, manualRevision]
    );
    await pool.query(
      `update discount_offer set state='enabled', current_revision_id=$2,
         quota_count=1, budget_amount='1000000', per_client_limit=1 where id=$1`,
      [manualOffer, manualRevision]
    );
    await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [manualOffer]);
    await pool.query(
      `insert into discount_code (id, offer_id, canonical_code, state, actor_identity)
       values ($1,$2,$3,'active','fixture')`,
      [manualCode, manualOffer, "MANUALFIXTURE1"]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(
        `delete from discount_redemption_event where redemption_id in
           (select id from discount_redemption where offer_id=$1)`,
        [manualOffer]
      );
      await pool.query(`delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]);
      await pool.query(`delete from discount_redemption where offer_id=$1`, [manualOffer]);
      await pool.query(`delete from discount_client_usage where offer_id=$1`, [manualOffer]);
      await pool.query(`delete from discount_code where offer_id=$1`, [manualOffer]);
      await pool.query(`delete from discount_offer_usage where offer_id=$1`, [manualOffer]);
      await pool.query(`delete from discount_benefit where revision_id=$1`, [manualRevision]);
      await pool.query(
        `update discount_offer set state='draft', current_revision_id=null where id=$1`,
        [manualOffer]
      );
      await pool.query(`delete from discount_offer_revision where offer_id=$1`, [manualOffer]);
      await pool.query(`delete from discount_offer where id=$1`, [manualOffer]);
    } catch {
      // best-effort cleanup on the disposable database
    }
  });

  it("menyimpan tepat satu Redemption manual dengan code_id dan berbagi quota/per-account", async () => {
    const firstOrder = await createOrder(clientA);
    const first = await reserve(firstOrder, clientA, manualCandidate);
    expect(first).toMatchObject({ ok: true });

    const stored = await pool!.query(
      `select activation_kind, code_id, benefit_amount, status from discount_redemption
        where order_id=$1`,
      [firstOrder]
    );
    expect(stored.rows[0]).toMatchObject({
      activation_kind: "manual_only",
      code_id: manualCode,
      benefit_amount: "25000.00",
      status: "reserved",
    });

    const usage = await pool!.query(
      `select reserved_count, reserved_amount from discount_offer_usage where offer_id=$1`,
      [manualOffer]
    );
    expect(usage.rows[0]).toMatchObject({ reserved_count: 1, reserved_amount: "25000.00" });

    // Akun yang sama sudah memakai jatah per-account 1 → ditolak.
    const sameClient = await reserve(await createOrder(clientA), clientA, manualCandidate);
    expect(sameClient).toMatchObject({ ok: false, reason: "CAPACITY_UNAVAILABLE" });
    // Akun lain berebut quota global 1 yang sudah terpakai → ditolak.
    const otherClient = await reserve(await createOrder(clientB), clientB, manualCandidate);
    expect(otherClient).toMatchObject({ ok: false, reason: "CAPACITY_UNAVAILABLE" });

    const count = await pool!.query(
      `select count(*)::int as count from discount_redemption where offer_id=$1`,
      [manualOffer]
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("kode yang dinonaktifkan setelah preview menggugurkan reservasi tanpa usage parsial", async () => {
    await pool!.query(`update discount_offer_usage set reserved_count=0, reserved_amount='0' where offer_id=$1`, [
      manualOffer,
    ]);
    await pool!.query(`delete from discount_redemption where offer_id=$1`, [manualOffer]);
    await pool!.query(`delete from discount_client_usage where offer_id=$1`, [manualOffer]);
    await pool!.query(`update discount_code set state='inactive', version=version+1 where id=$1`, [
      manualCode,
    ]);
    const rejected = await reserve(await createOrder(clientB), clientB, manualCandidate);
    expect(rejected).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
    const usage = await pool!.query(
      `select reserved_count, consumed_count from discount_offer_usage where offer_id=$1`,
      [manualOffer]
    );
    expect(usage.rows[0]).toMatchObject({ reserved_count: 0, consumed_count: 0 });
    await pool!.query(`update discount_code set state='active', version=version+1 where id=$1`, [
      manualCode,
    ]);
  });
});


// =========================================================
// Seam T — percentage goods reservation (ticket 10)
// =========================================================
describe("reserveRedemptionForOrder — percentage goods cap opsional", () => {
  const pctPricing = evaluatePricing({
    fulfillmentMethod: "pickup",
    ppnRatePercent: "11",
    lines: [
      {
        variantId,
        quantity: 1,
        sourceUnitPrice: "450000",
        effectiveUnitPrice: "450000",
      },
    ],
    benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" },
  });

  const pctCandidate = {
    offerId: pctOfferId,
    offerName: "Percentage Coupon",
    activationKind: "public" as const,
    codeId: null,
    revisionId: pctRevisionId,
    benefitId: pctBenefitId,
    policyVersion: 1,
    benefit: { kind: "percentage_goods" as const, paramsVersion: 1 as const, rate: "10", capAmount: "20000" },
    benefitAmount: "20000",
    minSubtotal: "0",
    startAt: null,
    endAt: null,
  };

  it("rate10 cap20000 pada subtotal450000 mereservasi20000, menulis allocation exact, dan consume memakai nominal itu", async () => {
    // Literal independen spec §4.4: cap sekali per order.
    expect(pctPricing.subtotal).toBe("450000");
    expect(pctPricing.goodsDiscount).toBe("20000");
    expect(pctPricing.netGoods).toBe("430000");
    expect(pctPricing.ppnAmount).toBe("47300");
    expect(pctPricing.total).toBe("477300");

    const orderId = await createOrder(clientA);
    const result = await db!.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId: clientA,
        verifiedEmail: true,
        candidate: pctCandidate,
        deadline,
        pricing: pctPricing,
        subtotalAfterMarkdown: pctPricing.subtotal,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await pool!.query(
      `select benefit_amount, terms_snapshot->'benefit' as benefit, result_snapshot->'benefit' as result_benefit
         from discount_redemption where id=$1`,
      [result.redemptionId]
    );
    expect(row.rows[0].benefit_amount).toBe("20000.00");
    expect(row.rows[0].benefit).toEqual({ kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" });
    expect(row.rows[0].result_benefit).toEqual({ kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" });

    await db!.transaction(async (tx) => {
      await writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: new Map([[variantId, `${orderId}-item`]]),
        pricing: pctPricing,
        redemption: { id: result.redemptionId, benefitId: pctBenefitId },
      });
    });
    const allocation = await pool!.query(
      `select component, amount from order_discount_allocation where order_id=$1`,
      [orderId]
    );
    expect(allocation.rows).toEqual([{ component: "offer_goods", amount: "20000.00" }]);

    await db!.transaction((tx) =>
      consumeReservedRedemption(tx, {
        identity: { offerId: pctOfferId, clientId: clientA, benefitAmount: "20000" },
        orderId,
        redemptionId: result.redemptionId,
        source: "payment_settled",
      })
    );
    const usage = await pool!.query(
      `select reserved_count, consumed_count, reserved_amount, consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [pctOfferId]
    );
    expect(usage.rows[0]).toMatchObject({
      reserved_count: 0,
      consumed_count: 1,
      reserved_amount: "0.00",
      consumed_amount: "20000.00",
    });
  });
});
