/**
 * Seam T — siklus Redemption lewat public lifecycle interface (ticket 07):
 * paid → consumed, confirmed cancel / definitive rejection → released sekali,
 * late paid → review tanpa reacquire. Real PostgreSQL, tanpa provider HTTP.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";

const { reserveRedemptionForOrder } = await import("./discount-reservation");
const { releaseReservedRedemption } = await import("./discount-lifecycle");
const { claimLatePaidOrder, claimPaidOrder, processLateSettlement, resolvePaymentOutcome } =
  await import("./order-finalize");
const { releaseConfirmedSalesOrderHold } = await import("./jubelio-sales-lifecycle");
const { finalizeRejectedCheckoutCreate } = await import("./checkout-recovery");
const { createLogger } = await import("./logger");

const url = process.env.DATABASE_URL;
const PREFIX = `discount-lifecycle-${crypto.randomUUID()}`;
const clientId = `${PREFIX}-client`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantId = `${PREFIX}-variant`;
const offerId = `${PREFIX}-offer`;
const revisionId = `${PREFIX}-revision`;
const benefitId = `${PREFIX}-benefit`;
const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const log = createLogger({ module: "discount-lifecycle-test" });

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
  "environment blocker: Redemption lifecycle flow NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Lifecycle flow tests NOT run — paid/cancel/late-paid safety remains UNVERIFIED. Exact blocker: ${schemaState.blocker}`
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
  offerName: "Lifecycle Coupon",
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

let orderSeq = 0;
async function createOrder(input: {
  status?: string;
  paymentStatus?: string;
} = {}): Promise<string> {
  orderSeq += 1;
  const orderId = `${PREFIX}-order-${orderSeq}`;
  await pool!.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, total,
       status, payment_status, expires_at)
     values ($1,$2,$3,'08123456789','fixture@example.test','150000','25000','138750',$4,$5,now() + interval '15 minutes')`,
    [
      orderId,
      clientId,
      branchId,
      input.status ?? "pending_payment",
      input.paymentStatus ?? "pending",
    ]
  );
  await pool!.query(
    `insert into branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock, on_order_stock, provider_reserved_stock, available_stock)
     values ($1,$2,5,0,1,0,0,5) on conflict (branch_id, product_variant_id) do nothing`,
    [branchId, variantId]
  );
  await pool!.query(
    `insert into order_item (id, order_id, variant_id, product_name, price, quantity,
       pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount, net_line_amount)
     values ($1,$2,$3,'Fixture','150000',1,1,'150000','0','25000','125000')`,
    [`${orderId}-item`, orderId, variantId]
  );
  return orderId;
}

async function reserveFor(orderId: string) {
  const result = await db!.transaction((tx) =>
    reserveRedemptionForOrder(tx, {
      orderId,
      clientId,
      verifiedEmail: true,
      candidate,
      deadline: new Date(Date.now() + 900_000),
      pricing,
      subtotalAfterMarkdown: pricing.subtotal,
    })
  );
  if (!result.ok) throw new Error(`fixture reserve failed: ${result.reason}`);
  return result.redemptionId;
}

async function insertOperation(input: {
  orderId: string;
  type: "create" | "cancel";
  status: string;
  salesOrderId?: number | null;
}) {
  await pool!.query(
    `insert into jubelio_sales_operation
       (id, order_id, type, status, reference, payload, sales_order_id, confirmed_at, hold_accounted_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,null)`,
    [
      `${PREFIX}-op-${crypto.randomUUID()}`,
      input.orderId,
      input.type,
      input.status,
      `OKCIR_${input.type.toUpperCase()}:${input.orderId}`,
      JSON.stringify({ type: input.type }),
      input.salesOrderId ?? null,
      input.status === "confirmed" ? new Date() : null,
    ]
  );
}

async function insertCheckoutRequest(orderId: string) {
  await pool!.query(
    `insert into checkout_request (id, client_id, request_key, fingerprint, order_id, result)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      `${PREFIX}-request-${crypto.randomUUID()}`,
      clientId,
      crypto.randomUUID(),
      "a".repeat(64),
      orderId,
      JSON.stringify({ version: 1, orderId }),
    ]
  );
}

async function redemption(orderId: string) {
  const rows = await pool!.query(
    `select id, status, benefit_amount, consumed_at, released_at from discount_redemption where order_id=$1`,
    [orderId]
  );
  return rows.rows[0] as
    | { id: string; status: string; benefit_amount: string; consumed_at: Date | null; released_at: Date | null }
    | undefined;
}

async function counters() {
  const usage = await pool!.query(
    `select reserved_count, consumed_count, reserved_amount, consumed_amount from discount_offer_usage where offer_id=$1`,
    [offerId]
  );
  const clients = await pool!.query(
    `select reserved_count, consumed_count, reserved_amount, consumed_amount from discount_client_usage where offer_id=$1`,
    [offerId]
  );
  return { usage: usage.rows[0], clients: clients.rows };
}

async function events(redemptionId: string) {
  const rows = await pool!.query(
    `select kind, count(*)::int as count from discount_redemption_event where redemption_id=$1 group by kind order by kind`,
    [redemptionId]
  );
  return Object.fromEntries(rows.rows.map((row) => [row.kind, row.count]));
}

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true)`,
    [clientId, "Lifecycle Fixture", `${clientId}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,$2,$3,'Test','Test')`,
    [branchId, "Lifecycle Fixture", PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,$2,$3,'150000')`,
    [productId, "Lifecycle Fixture", PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values ($1,$2,$3,'150000')`,
    [variantId, productId, PREFIX]
  );
  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values ($1,$2,'public','fixture')`,
    [offerId, `${offerId}-key`]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values ($1,$2,1,'Lifecycle Coupon','IDR','0',now(),'fixture')`,
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
  await pool.query(`delete from checkout_request where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from jubelio_sales_operation where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
  await pool.query(
    `update discount_offer_usage set reserved_count=0, consumed_count=0,
       reserved_amount='0', consumed_amount='0', version=1 where offer_id=$1`,
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
    await pool.query(`delete from checkout_request where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from jubelio_sales_operation where order_id like $1`, [`${PREFIX}%`]);
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
    await pool.query(`delete from product_variant where id=$1`, [variantId]);
    await pool.query(`delete from product where id=$1`, [productId]);
    await pool.query(`delete from branch_stock where branch_id=$1`, [branchId]);
    await pool.query(`delete from branch where id=$1`, [branchId]);
    await pool.query(`delete from client where id=$1`, [clientId]);
  } finally {
    await pool.end();
  }
});

describe("paid → consumed", () => {
  it("claimPaidOrder mengonsumsi sekali walau provider settlement belum ada", async () => {
    const orderId = await createOrder();
    const redemptionId = await reserveFor(orderId);
    const deadlineBefore = (
      await pool!.query(`select deadline from discount_redemption where order_id=$1`, [orderId])
    ).rows[0].deadline;

    expect(await claimPaidOrder(orderId, log, { paymentType: "qris", transactionId: "tx-1" })).toEqual({
      claimed: true,
    });
    const paid = await pool!.query(
      `select status, payment_status from orders where id=$1`,
      [orderId]
    );
    expect(paid.rows[0]).toEqual({ status: "processing", payment_status: "paid" });
    expect(await redemption(orderId)).toMatchObject({
      status: "consumed",
      consumed_at: expect.any(Date),
    });
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      consumed_count: 1,
      reserved_amount: "0.00",
      consumed_amount: "25000.00",
    });
    expect(await events(redemptionId)).toEqual({ consumed: 1, reserved: 1 });
    // Paid tidak memperpanjang deadline reservasi.
    const deadlineAfter = (
      await pool!.query(`select deadline from discount_redemption where order_id=$1`, [orderId])
    ).rows[0].deadline;
    expect(deadlineAfter.getTime()).toBe(deadlineBefore.getTime());

    // Duplicate callback: no double transition/counter/event.
    expect(await claimPaidOrder(orderId, log, { transactionId: "tx-1" })).toEqual({ claimed: false });
    expect(await events(redemptionId)).toEqual({ consumed: 1, reserved: 1 });
  });
});

describe("safe unpaid terminal → released", () => {
  it("confirmed cancel melepas kapasitas sekali lewat accounting SO", async () => {
    const orderId = await createOrder();
    const redemptionId = await reserveFor(orderId);
    await insertOperation({ orderId, type: "cancel", status: "confirmed", salesOrderId: 990_001 });

    await releaseConfirmedSalesOrderHold(orderId);
    expect(await redemption(orderId)).toMatchObject({ status: "released", released_at: expect.any(Date) });
    const state = await counters();
    expect(state.usage).toMatchObject({
      reserved_count: 0,
      consumed_count: 0,
      reserved_amount: "0.00",
      consumed_amount: "0.00",
    });
    expect(await events(redemptionId)).toEqual({ released: 1, reserved: 1 });

    // Replay of the confirmed cancel accounting: op is claimed, no second release.
    await releaseConfirmedSalesOrderHold(orderId);
    expect(await events(redemptionId)).toEqual({ released: 1, reserved: 1 });
  });

  it("definitive pre-apply rejection melepas hold+kapasitas sekali", async () => {
    const orderId = await createOrder();
    await insertCheckoutRequest(orderId);
    const redemptionId = await reserveFor(orderId);
    await insertOperation({ orderId, type: "create", status: "rejected" });

    await finalizeRejectedCheckoutCreate(orderId, log);
    expect(await redemption(orderId)).toMatchObject({ status: "released" });
    const failed = await pool!.query(`select status, payment_status from orders where id=$1`, [orderId]);
    expect(failed.rows[0]).toEqual({ status: "failed_payment", payment_status: "failed" });
    expect(await events(redemptionId)).toEqual({ released: 1, reserved: 1 });

    await finalizeRejectedCheckoutCreate(orderId, log);
    expect(await events(redemptionId)).toEqual({ released: 1, reserved: 1 });
  });

  it("attempt deny/cancel nonterminal tidak menyentuh Redemption", async () => {
    const orderId = await createOrder();
    await reserveFor(orderId);
    const before = await pool!.query(
      `select status, deadline, benefit_amount from discount_redemption where order_id=$1`,
      [orderId]
    );
    // The webhook classifies these as `defer` (no DB write, no extension).
    expect(resolvePaymentOutcome("deny")).toBe("defer");
    expect(resolvePaymentOutcome("cancel")).toBe("defer");
    expect(resolvePaymentOutcome("pending")).toBe("defer");
    expect(resolvePaymentOutcome("failure")).toBe("defer");
    const after = await pool!.query(
      `select status, deadline, benefit_amount from discount_redemption where order_id=$1`,
      [orderId]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("late settlement", () => {
  it("late paid setelah release: tetap released + satu review, fulfillment blocked", async () => {
    const orderId = await createOrder({ status: "failed_payment", paymentStatus: "failed" });
    const redemptionId = await reserveFor(orderId);
    await db!.transaction(async (tx) => {
      await releaseReservedRedemption(tx, {
        identity: { offerId, clientId, benefitAmount: "25000" },
        orderId,
        source: "jubelio-cancel",
        reason: "confirmed cancel",
      });
    });
    await insertOperation({ orderId, type: "cancel", status: "confirmed", salesOrderId: 990_002 });

    const result = await processLateSettlement(orderId, log, { transactionId: "tx-late-1" });
    expect(result.status).toBe("manual_review");
    const order = await pool!.query(
      `select status, payment_status, fulfillment_blocked_reason from orders where id=$1`,
      [orderId]
    );
    expect(order.rows[0]).toMatchObject({
      status: "processing",
      payment_status: "paid",
      fulfillment_blocked_reason: expect.stringContaining("manual reconciliation"),
    });
    expect(await redemption(orderId)).toMatchObject({ status: "released" });
    expect(await events(redemptionId)).toEqual({
      late_paid_review: 1,
      released: 1,
      reserved: 1,
    });
    const state = await counters();
    expect(state.usage).toMatchObject({ reserved_count: 0, consumed_count: 0 });

    // Duplicate webhook for the same transaction: no second review event.
    await processLateSettlement(orderId, log, { transactionId: "tx-late-1" });
    expect(await events(redemptionId)).toEqual({
      late_paid_review: 1,
      released: 1,
      reserved: 1,
    });
  });

  it("late paid dengan hold belum dilepas: consume hold dan tetap blocked", async () => {
    const orderId = await createOrder({ status: "failed_payment", paymentStatus: "failed" });
    const redemptionId = await reserveFor(orderId);
    await insertOperation({ orderId, type: "cancel", status: "dispatched_unknown", salesOrderId: 990_003 });

    const result = await processLateSettlement(orderId, log, { transactionId: "tx-late-2" });
    expect(result.status).toBe("manual_review");
    expect(await redemption(orderId)).toMatchObject({ status: "consumed" });
    expect(await events(redemptionId)).toEqual({ consumed: 1, reserved: 1 });
    const order = await pool!.query(
      `select payment_status, fulfillment_blocked_reason from orders where id=$1`,
      [orderId]
    );
    expect(order.rows[0].payment_status).toBe("paid");
    expect(order.rows[0].fulfillment_blocked_reason).toBeTruthy();
  });

  it("late paid dengan SO aktif tanpa cancel: guarded late claim mengonsumsi hold", async () => {
    const orderId = await createOrder({ status: "failed_payment", paymentStatus: "failed" });
    const redemptionId = await reserveFor(orderId);

    expect(await claimLatePaidOrder(orderId, log, { transactionId: "tx-late-3" })).toBe(true);
    expect(await redemption(orderId)).toMatchObject({ status: "consumed" });
    expect(await events(redemptionId)).toEqual({ consumed: 1, reserved: 1 });
    const order = await pool!.query(
      `select status, payment_status, fulfillment_blocked_reason from orders where id=$1`,
      [orderId]
    );
    expect(order.rows[0]).toEqual({
      status: "processing",
      payment_status: "paid",
      fulfillment_blocked_reason: null,
    });
  });
});
