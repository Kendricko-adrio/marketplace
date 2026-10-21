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
  benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" },
});

const candidate = {
  offerId,
  offerName: "Fixture Coupon",
  revisionId,
  benefitId,
  policyVersion: 1,
  fixedAmount: "25000",
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

async function reserve(orderId: string, clientId: string) {
  return db!.transaction((tx) =>
    reserveRedemptionForOrder(tx, {
      orderId,
      clientId,
      verifiedEmail: true,
      candidate,
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
    await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
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
      benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" },
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
