/**
 * Seam T — subsidi ongkir: satu Redemption shipping tanpa item allocation,
 * budget/full capacity/per-account lifecycle berlaku, dan tidak ada slot goods
 * kedua. Real PostgreSQL (disposable DATABASE_URL); skip bukan pass.
 */
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";

const { reserveRedemptionForOrder, writeOrderDiscountAllocations } = await import(
  "./discount-reservation"
);
const { evaluateSelectedOffer } = await import("./discount-selection");

const url = process.env.DATABASE_URL;
const PREFIX = `discount-shipping-${crypto.randomUUID()}`;
const clientA = `${PREFIX}-client-a`;
const clientB = `${PREFIX}-client-b`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantId = `${PREFIX}-variant`;
const offerId = `${PREFIX}-offer`;
const revisionId = `${PREFIX}-revision`;
const benefitId = `${PREFIX}-benefit`;
const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const deadline = new Date("2026-10-21T12:00:00.000Z");

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
  "environment blocker: shipping subsidy reservations NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Shipping subsidy tests NOT run — allocation/usage safety remains UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

function shippingPricing(before: string, cap: string) {
  return evaluatePricing({
    fulfillmentMethod: "delivery",
    ppnRatePercent: "11",
    lines: [{ variantId, quantity: 1, sourceUnitPrice: "150000", effectiveUnitPrice: "150000" }],
    shippingBeforeSubsidy: before,
    providerQuotedShippingCost: before,
    benefit: { kind: "shipping", paramsVersion: 1, capAmount: cap },
  });
}

function candidate(amount: string) {
  return {
    offerId,
    offerName: "Fixture Shipping",
    activationKind: "public" as const,
    codeId: null,
    revisionId,
    benefitId,
    policyVersion: 1,
    benefit: { kind: "shipping" as const, paramsVersion: 1 as const, capAmount: "20000" },
    benefitAmount: amount,
    minSubtotal: "0",
    startAt: null,
    endAt: null,
  };
}

let orderSeq = 0;
async function createOrder(clientId: string): Promise<string> {
  orderSeq += 1;
  const orderId = `${PREFIX}-order-${orderSeq}`;
  await pool!.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, shipping_cost, total)
     values ($1,$2,$3,'08123456789','fixture@example.test','150000','0','10000','176500')`,
    [orderId, clientId, branchId]
  );
  await pool!.query(
    `insert into order_item (id, order_id, variant_id, product_name, price, quantity,
       pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount, net_line_amount)
     values ($1,$2,$3,'Fixture','150000',1,1,'150000','0','0','150000')`,
    [`${orderId}-item`, orderId, variantId]
  );
  return orderId;
}

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true), ($4,$5,$6,true)`,
    [clientA, "Ship A", `${clientA}@example.test`, clientB, "Ship B", `${clientB}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,$2,$3,'Test','Test')`,
    [branchId, "Ship Fixture", PREFIX]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,$2,$3,'150000')`,
    [productId, "Ship Fixture", PREFIX]
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
     values ($1,$2,1,'Fixture Shipping','IDR','0',now(),'fixture')`,
    [revisionId, offerId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, cap_amount)
     values ($1,$2,'shipping','shipping','20000')`,
    [benefitId, revisionId]
  );
  await pool.query(
    `update discount_offer set state='enabled', current_revision_id=$2, quota_count=5,
       budget_amount='30000', per_client_limit=1 where id=$1`,
    [offerId, revisionId]
  );
  await pool.query(`insert into discount_offer_usage (offer_id) values ($1)`, [offerId]);
}, 30_000);

beforeEach(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]
  );
  await pool.query(
    `delete from discount_redemption_event where redemption_id in
       (select id from discount_redemption where offer_id=$1)`, [offerId]
  );
  await pool.query(`delete from discount_redemption where offer_id=$1`, [offerId]);
  await pool.query(`delete from discount_client_usage where offer_id=$1`, [offerId]);
  await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
  await pool.query(
    `update discount_offer_usage set reserved_count=0, consumed_count=0,
       reserved_amount='0', consumed_amount='0', version=1 where offer_id=$1`, [offerId]
  );
  await pool.query(
    `update discount_offer set state='enabled', quota_count=5, budget_amount='30000',
       per_client_limit=1 where id=$1`, [offerId]
  );
}, 30_000);

afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(
      `delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]
    );
    await pool.query(
      `delete from discount_redemption_event where redemption_id in
         (select id from discount_redemption where offer_id=$1)`, [offerId]
    );
    await pool.query(`delete from discount_redemption where offer_id=$1`, [offerId]);
    await pool.query(`delete from discount_client_usage where offer_id=$1`, [offerId]);
    await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
    await pool.query(`update discount_offer set state='draft', current_revision_id=null where id=$1`, [offerId]);
    await pool.query(`delete from discount_benefit where revision_id=$1`, [revisionId]);
    await pool.query(`delete from discount_offer_revision where id=$1`, [revisionId]);
    await pool.query(`delete from discount_offer_usage where offer_id=$1`, [offerId]);
    await pool.query(`delete from discount_offer where id=$1`, [offerId]);
    await pool.query(`delete from product_variant where id=$1`, [variantId]);
    await pool.query(`delete from product where id=$1`, [productId]);
    await pool.query(`delete from client where id in ($1,$2)`, [clientA, clientB]);
    await pool.query(`delete from branch where id=$1`, [branchId]);
  } finally {
    await pool.end();
  }
}, 30_000);

describe("shipping subsidy reservation (seam T)", () => {
  it("menyimpan satu Redemption shipping + satu allocation offer_shipping tanpa item, bukan slot goods", async () => {
    if (!db) return;
    const pricing = shippingPricing("30000", "20000");
    const orderId = await createOrder(clientA);
    const result = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId: clientA,
        verifiedEmail: true,
        candidate: candidate("20000"),
        deadline,
        pricing,
        subtotalAfterMarkdown: pricing.subtotal,
        fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: "30000",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const redemptions = await pool!.query(
      `select status, benefit_amount::text as amount from discount_redemption where offer_id=$1`,
      [offerId]
    );
    expect(redemptions.rows).toEqual([{ status: "reserved", amount: "20000.00" }]);
    const usage = await pool!.query(
      `select reserved_count, reserved_amount::text as amount from discount_offer_usage where offer_id=$1`,
      [offerId]
    );
    expect(usage.rows[0]).toEqual({ reserved_count: 1, amount: "20000.00" });

    const orderItemId = `${orderId}-item`;
    await db.transaction((tx) =>
      writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: new Map([[variantId, orderItemId]]),
        pricing,
        redemption: { id: result.redemptionId, benefitId },
      })
    );
    const allocations = await pool!.query(
      `select component, order_item_id, amount::text as amount from order_discount_allocation
        where order_id=$1 order by component`, [orderId]
    );
    expect(allocations.rows).toEqual([
      { component: "offer_shipping", order_item_id: null, amount: "20000.00" },
    ]);
    // Subsidi TIDAK masuk goods disc_amount/line.
    const line = await pool!.query(
      `select goods_discount_amount::text as disc, net_line_amount::text as net from order_item where id=$1`,
      [orderItemId]
    );
    expect(line.rows[0]).toEqual({ disc: "0.00", net: "150000.00" });
  }, 30_000);

  it("per-account limit dan budget memakai nominal subsidi aktual; pickup disabled", async () => {
    if (!db) return;
    const pricing = shippingPricing("30000", "20000");
    const orderId = await createOrder(clientA);
    const reserved = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId: clientA,
        verifiedEmail: true,
        candidate: candidate("20000"),
        deadline,
        pricing,
        subtotalAfterMarkdown: pricing.subtotal,
        fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: "30000",
      })
    );
    expect(reserved.ok).toBe(true);

    const sameClient = await evaluateSelectedOffer({
      offerId, clientId: clientA, verifiedEmail: true,
      subtotalAfterMarkdown: "150000", fulfillmentMethod: "delivery",
      shippingBeforeSubsidy: "30000",
    });
    expect(sameClient.ok).toBe(false);
    if (!sameClient.ok) expect(sameClient.reason).toBe("CAPACITY_UNAVAILABLE");

    const pickup = await evaluateSelectedOffer({
      offerId, clientId: clientB, verifiedEmail: true,
      subtotalAfterMarkdown: "150000",
    });
    expect(pickup.ok).toBe(false);
    if (!pickup.ok) expect(pickup.reason).toBe("FULFILLMENT_NOT_ELIGIBLE");

    // Sisa budget 10000: subsidi 12000 ditolak utuh (bukan dipotong diam-diam).
    const budget = await evaluateSelectedOffer({
      offerId, clientId: clientB, verifiedEmail: true,
      subtotalAfterMarkdown: "150000", fulfillmentMethod: "delivery",
      shippingBeforeSubsidy: "12000",
    });
    expect(budget.ok).toBe(false);
    if (!budget.ok) expect(budget.reason).toBe("CAPACITY_UNAVAILABLE");

    const exact = await evaluateSelectedOffer({
      offerId, clientId: clientB, verifiedEmail: true,
      subtotalAfterMarkdown: "150000", fulfillmentMethod: "delivery",
      shippingBeforeSubsidy: "10000",
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.candidate.benefitAmount).toBe("10000");
  }, 30_000);
});
