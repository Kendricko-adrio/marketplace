/**
 * Ticket 13 — regresi cross-slice (seam L + T), real PostgreSQL disposable.
 *
 * Slices 03 (Markdown), 06/10 (benefit fixed/percentage), 09 (Manual Promo Code),
 * 10 (percentage + cap), 11 (subsidi ongkir) dan 07/12 (reservasi/kapasitas)
 * bertemu di satu keranjang: Markdown per baris + TEPAT satu slot Offer, qty>1,
 * multi-line, pickup/delivery. Expected literal dihitung independen dari rumus
 * §4.2, bukan dari engine yang sedang diuji.
 *
 * Yang dibuktikan:
 * - manual × percentage (kombinasi yang baru ada setelah ticket 09 + 10):
 *   bentuk benefit + rate/cap tersimpan, nominal floor/clip/cap, allocation
 *   whole-line/largest remainder tepat, snapshot pricing L == snapshot order.
 * - public × fixed dengan Markdown: clipping memakai subtotal setelah Markdown.
 * - manual × shipping delivery: original/subsidi/net/quote/payable terpisah,
 *   satu allocation offer_shipping tanpa item dan tanpa goods.
 * - publish revisi (admin) dan pause sesudah preview menggugurkan konfirmasi
 *   tanpa meninggalkan order/usage parsial.
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
  evaluateSelectedManualCode,
  evaluateSelectedPublicOffer,
} = await import("./discount-selection");
const { reserveRedemptionForOrder, lockAndEvaluateOfferReservation, writeOrderDiscountAllocations } =
  await import("./discount-reservation");
const { lockRedemptionOwners, consumeReservedRedemption } = await import("./discount-lifecycle");

const url = process.env.DATABASE_URL;
const PREFIX = `discounts-integration-${crypto.randomUUID()}`;
const clientId = `${PREFIX}-client`;
const branchId = `${PREFIX}-branch`;
const productId = `${PREFIX}-product`;
const variantA = `${PREFIX}-variant-a`;
const variantB = `${PREFIX}-variant-b`;

const manualPercentOfferId = `${PREFIX}-offer-manual-percent`;
const manualPercentRevisionId = `${manualPercentOfferId}-revision`;
const manualPercentBenefitId = `${manualPercentOfferId}-benefit`;
const manualPercentCodeId = `${manualPercentOfferId}-code`;
const MANUAL_PERCENT_CODE = "INTEG12CAP";

const manualShippingOfferId = `${PREFIX}-offer-manual-shipping`;
const manualShippingRevisionId = `${manualShippingOfferId}-revision`;
const manualShippingBenefitId = `${manualShippingOfferId}-benefit`;
const manualShippingCodeId = `${manualShippingOfferId}-code`;
const MANUAL_SHIPPING_CODE = "INTEGONGKIR";

const publicFixedOfferId = `${PREFIX}-offer-public-fixed`;
const publicFixedRevisionId = `${publicFixedOfferId}-revision`;
const publicFixedBenefitId = `${publicFixedOfferId}-benefit`;

const markdownRevisionA = `${PREFIX}-markdown-revision-a`;

const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const deadline = new Date("2026-10-21T12:00:00.000Z");
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
  "environment blocker: cross-slice discounts integration NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Cross-slice discounts integration NOT run — UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

// Keranjang bersama semua kasus: Markdown pada baris A, baris B tanpa Markdown.
//   A: source150000 → effective120000 × 2 = 240000 (markdown 60000)
//   B: source50000 × 3 = 150000
//   source subtotal 450000, markdown 60000, subtotal setelah Markdown 390000.
const CART_LINES = [
  {
    variantId: variantA,
    quantity: 2,
    sourceUnitPrice: "150000",
    effectiveUnitPrice: "120000",
    markdownRevisionId: markdownRevisionA,
  },
  {
    variantId: variantB,
    quantity: 3,
    sourceUnitPrice: "50000",
    effectiveUnitPrice: "50000",
  },
] as const;

function pricingFor(benefit: Parameters<typeof evaluatePricing>[0]["benefit"], input?: {
  fulfillmentMethod?: "pickup" | "delivery";
  shippingBeforeSubsidy?: string;
}) {
  return evaluatePricing({
    fulfillmentMethod: input?.fulfillmentMethod ?? "pickup",
    ppnRatePercent: "11",
    lines: [...CART_LINES],
    ...(input?.shippingBeforeSubsidy !== undefined
      ? {
          shippingBeforeSubsidy: input.shippingBeforeSubsidy,
          providerQuotedShippingCost: input.shippingBeforeSubsidy,
        }
      : {}),
    benefit,
  });
}

let orderSeq = 0;
async function createOrder(items: Array<{ variantId: string; price: string; quantity: number }>) {
  orderSeq += 1;
  const orderId = `${PREFIX}-order-${orderSeq}`;
  await pool!.query(
    `insert into orders (id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, total)
     values ($1,$2,$3,'08123456789','integration@example.test','390000','0','410700')`,
    [orderId, clientId, branchId]
  );
  const itemIds = new Map<string, string>();
  for (const [index, item] of items.entries()) {
    const itemId = `${orderId}-item-${index}`;
    itemIds.set(item.variantId, itemId);
    await pool!.query(
      `insert into order_item
         (id, order_id, variant_id, product_name, price, quantity,
          pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount, net_line_amount)
       values ($1,$2,$3,'Fixture',$4,$5,1,$4,'0','0',$6)`,
      [itemId, orderId, item.variantId, item.price, item.quantity, item.price]
    );
  }
  return { orderId, itemIds };
}

async function counterState() {
  const [usage] = (
    await pool!.query(
      `select reserved_count, consumed_count, reserved_amount::text as reserved_amount,
              consumed_amount::text as consumed_amount
         from discount_offer_usage where offer_id=$1`,
      [manualPercentOfferId]
    )
  ).rows;
  const redemptions = await pool!.query(
    `select count(*)::int as count from discount_redemption where offer_id=$1`,
    [manualPercentOfferId]
  );
  return { usage, redemptionCount: redemptions.rows[0].count };
}

beforeAll(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `insert into client (id, name, email, email_verified) values ($1,'Integrasi',$2,true)`,
    [clientId, `${clientId}@example.test`]
  );
  await pool.query(
    `insert into branch (id, name, code, city, address) values ($1,'Integrasi','INTEG','Test','Test')`,
    [branchId]
  );
  await pool.query(
    `insert into product (id, name, slug, base_price) values ($1,'Integrasi',$2,'150000')`,
    [productId, PREFIX]
  );
  await pool.query(
    `insert into product_variant (id, product_id, sku, price) values
       ($1,$3,'INTEG-A','150000'), ($2,$3,'INTEG-B','50000')`,
    [variantA, variantB, productId]
  );

  await pool.query(
    `insert into discount_offer (id, key, activation_kind, actor_identity) values
       ($1,$2,'manual_only','fixture'),
       ($3,$4,'manual_only','fixture'),
       ($5,$6,'public','fixture')`,
    [
      manualPercentOfferId,
      `${manualPercentOfferId}-key`,
      manualShippingOfferId,
      `${manualShippingOfferId}-key`,
      publicFixedOfferId,
      `${publicFixedOfferId}-key`,
    ]
  );
  await pool.query(
    `insert into discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
     values
       ($1,$2,1,'Manual Persen 12.5 (maks 20rb)','IDR','0',now(),'fixture'),
       ($3,$4,1,'Manual Ongkir 20rb','IDR','0',now(),'fixture'),
       ($5,$6,1,'Publik Hemat 25','IDR','0',now(),'fixture')`,
    [
      manualPercentRevisionId,
      manualPercentOfferId,
      manualShippingRevisionId,
      manualShippingOfferId,
      publicFixedRevisionId,
      publicFixedOfferId,
    ]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, rate, cap_amount) values
       ($1,$2,'percentage_goods','goods','12.5','20000')`,
    [manualPercentBenefitId, manualPercentRevisionId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, cap_amount) values
       ($1,$2,'shipping','shipping','20000')`,
    [manualShippingBenefitId, manualShippingRevisionId]
  );
  await pool.query(
    `insert into discount_benefit (id, revision_id, kind, scope, fixed_amount) values
       ($1,$2,'fixed_goods','goods','25000')`,
    [publicFixedBenefitId, publicFixedRevisionId]
  );
  await pool.query(
    `update discount_offer
        set state='enabled', current_revision_id=case id
              when $1 then $2 when $3 then $4 else $5 end,
            quota_count=10, budget_amount='1000000', per_client_limit=5
      where id in ($1,$3,$6)`,
    [
      manualPercentOfferId,
      manualPercentRevisionId,
      manualShippingOfferId,
      manualShippingRevisionId,
      publicFixedRevisionId,
      publicFixedOfferId,
    ]
  );
  await pool.query(
    `insert into discount_offer_usage (offer_id) values ($1),($2),($3)`,
    [manualPercentOfferId, manualShippingOfferId, publicFixedOfferId]
  );
  await pool.query(
    `insert into discount_code (id, offer_id, canonical_code, state, actor_identity) values
       ($1,$2,$3,'active','fixture'), ($4,$5,$6,'active','fixture')`,
    [
      manualPercentCodeId,
      manualPercentOfferId,
      MANUAL_PERCENT_CODE,
      manualShippingCodeId,
      manualShippingOfferId,
      MANUAL_SHIPPING_CODE,
    ]
  );
}, 30_000);

beforeEach(async () => {
  if (!pool || !schemaState.ready) return;
  await pool.query(
    `delete from order_discount_allocation where order_id like $1`, [`${PREFIX}%`]
  );
  await pool.query(
    `delete from discount_redemption_event where redemption_id in
       (select id from discount_redemption where order_id like $1)`,
    [`${PREFIX}%`]
  );
  await pool.query(`delete from discount_redemption where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
  await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
  await pool.query(
    `update discount_offer_usage
        set reserved_count=0, consumed_count=0, reserved_amount='0', consumed_amount='0', version=1
      where offer_id like $1`,
    [`${PREFIX}%`]
  );
  await pool.query(
    `update discount_offer
        set state='enabled', current_revision_id=case id
              when $1 then $2 when $3 then $4 else $5 end,
            quota_count=10, budget_amount='1000000', per_client_limit=5
      where id in ($1,$3,$6)`,
    [
      manualPercentOfferId,
      manualPercentRevisionId,
      manualShippingOfferId,
      manualShippingRevisionId,
      publicFixedRevisionId,
      publicFixedOfferId,
    ]
  );
  // Buang revisi uji publish/pause yang dibuat di dalam kasus.
  await pool.query(
    `delete from discount_benefit where revision_id like $1 and revision_id not in ($2,$3,$4)`,
    [`${PREFIX}%`, manualPercentRevisionId, manualShippingRevisionId, publicFixedRevisionId]
  );
  await pool.query(
    `delete from discount_offer_revision where offer_id like $1 and id not in ($2,$3,$4)`,
    [`${PREFIX}%`, manualPercentRevisionId, manualShippingRevisionId, publicFixedRevisionId]
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
         (select id from discount_redemption where order_id like $1)`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_redemption where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_client_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from order_item where order_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_code where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer_usage where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(
      `update discount_offer set state='draft', current_revision_id=null where id like $1`,
      [`${PREFIX}%`]
    );
    await pool.query(`delete from discount_benefit where revision_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer_revision where offer_id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from discount_offer where id like $1`, [`${PREFIX}%`]);
    await pool.query(`delete from product_variant where product_id=$1`, [productId]);
    await pool.query(`delete from product where id=$1`, [productId]);
    await pool.query(`delete from client where id=$1`, [clientId]);
    await pool.query(`delete from branch where id=$1`, [branchId]);
  } finally {
    await pool.end();
  }
}, 30_000);

describe("manual × percentage + Markdown, qty>1 multi-line (L+T)", () => {
  it("rate/cap tersimpan, allocation whole-line exact, snapshot L == snapshot order, lalu consume", async () => {
    if (!db) return;
    // Literal independen: 390000 × 12.5% = 48750, cap 20000 mengikat.
    // Alokasi 20000: A floor(20000×240000/390000)=12307 sisa270000,
    // B floor(20000×150000/390000)=7692 sisa120000 → residual1 ke A.
    const resolved = await evaluateSelectedManualCode(
      {
        code: " integ12cap ",
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        now: NOW,
      },
      db
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.candidate).toMatchObject({
      offerId: manualPercentOfferId,
      activationKind: "manual_only",
      codeId: manualPercentCodeId,
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.5", capAmount: "20000" },
      benefitAmount: "20000",
    });

    const pricing = pricingFor(resolved.candidate.benefit);
    expect({
      sourceGoodsSubtotal: pricing.sourceGoodsSubtotal,
      markdownTotal: pricing.markdownTotal,
      subtotal: pricing.subtotal,
      goodsDiscount: pricing.goodsDiscount,
      netGoods: pricing.netGoods,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      expectedProviderPayable: pricing.expectedProviderPayable,
      lines: pricing.lines.map((line) => ({
        variantId: line.variantId,
        markdownAmount: line.markdownAmount,
        goodsDiscountAmount: line.goodsDiscountAmount,
        netLineAmount: line.netLineAmount,
      })),
    }).toEqual({
      sourceGoodsSubtotal: "450000",
      markdownTotal: "60000",
      subtotal: "390000",
      goodsDiscount: "20000",
      netGoods: "370000",
      ppnAmount: "40700",
      total: "410700",
      expectedProviderPayable: "370000",
      lines: [
        {
          variantId: variantA,
          markdownAmount: "60000",
          goodsDiscountAmount: "12308",
          netLineAmount: "227692",
        },
        {
          variantId: variantB,
          markdownAmount: "0",
          goodsDiscountAmount: "7692",
          netLineAmount: "142308",
        },
      ],
    });

    const { orderId, itemIds } = await createOrder([
      { variantId: variantA, price: "120000", quantity: 2 },
      { variantId: variantB, price: "50000", quantity: 3 },
    ]);
    const reserved = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId,
        verifiedEmail: true,
        candidate: resolved.candidate,
        deadline,
        pricing,
        subtotalAfterMarkdown: pricing.subtotal,
      })
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;

    const redemption = await pool!.query(
      `select activation_kind, code_id, status, benefit_amount::text as amount,
              terms_snapshot->'benefit' as benefit, result_snapshot
         from discount_redemption where order_id=$1`,
      [orderId]
    );
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0]).toMatchObject({
      activation_kind: "manual_only",
      code_id: manualPercentCodeId,
      status: "reserved",
      amount: "20000.00",
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.5", capAmount: "20000" },
    });
    // Snapshot order tidak boleh drift dari evaluasi pricing publik.
    expect(redemption.rows[0].result_snapshot).toMatchObject({
      version: 1,
      offerId: manualPercentOfferId,
      revisionId: manualPercentRevisionId,
      benefitId: manualPercentBenefitId,
      activationKind: "manual_only",
      codeId: manualPercentCodeId,
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.5", capAmount: "20000" },
      benefitAmount: "20000",
    });
    expect(redemption.rows[0].result_snapshot.pricing).toEqual({
      subtotal: pricing.subtotal,
      goodsDiscount: pricing.goodsDiscount,
      netGoods: pricing.netGoods,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      expectedProviderPayable: pricing.expectedProviderPayable,
    });

    await db.transaction((tx) =>
      writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: itemIds,
        pricing,
        redemption: { id: reserved.redemptionId, benefitId: manualPercentBenefitId },
      })
    );
    const allocations = await pool!.query(
      `select component, order_item_id, amount::text as amount
         from order_discount_allocation where order_id=$1
        order by component, order_item_id`,
      [orderId]
    );
    expect(allocations.rows).toEqual([
      { component: "markdown", order_item_id: itemIds.get(variantA), amount: "60000.00" },
      { component: "offer_goods", order_item_id: itemIds.get(variantA), amount: "12308.00" },
      { component: "offer_goods", order_item_id: itemIds.get(variantB), amount: "7692.00" },
    ]);

    expect(await counterState()).toEqual({
      usage: {
        reserved_count: 1,
        consumed_count: 0,
        reserved_amount: "20000.00",
        consumed_amount: "0.00",
      },
      redemptionCount: 1,
    });

    // Consume sekali: reservasi berpindah penuh, snapshot tetap.
    const identity = {
      offerId: manualPercentOfferId,
      clientId,
      benefitAmount: "20000",
    };
    const consumed = await db.transaction(async (tx) => {
      await lockRedemptionOwners(tx, identity);
      return consumeReservedRedemption(tx, {
        identity,
        redemptionId: reserved.redemptionId,
        source: "midtrans",
        correlation: "integration-consume",
      });
    });
    expect(consumed).toBe(true);
    expect(await counterState()).toEqual({
      usage: {
        reserved_count: 0,
        consumed_count: 1,
        reserved_amount: "0.00",
        consumed_amount: "20000.00",
      },
      redemptionCount: 1,
    });
  }, 30_000);

  it("public × fixed dengan Markdown: clip ke subtotal setelah Markdown dan alokasi largest remainder", async () => {
    if (!db) return;
    const resolved = await evaluateSelectedPublicOffer(
      {
        offerId: publicFixedOfferId,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        now: NOW,
      },
      db
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.candidate.benefitAmount).toBe("25000");

    const pricing = pricingFor(resolved.candidate.benefit);
    // Literal independen 25000: A floor(25000×240000/390000)=15384 sisa240000,
    // B floor(25000×150000/390000)=9615 sisa150000 → residual1 ke A.
    expect(pricing.lines.map((line) => line.goodsDiscountAmount)).toEqual(["15385", "9615"]);
    expect({
      netGoods: pricing.netGoods,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      expectedProviderPayable: pricing.expectedProviderPayable,
    }).toEqual({
      netGoods: "365000",
      ppnAmount: "40150",
      total: "405150",
      expectedProviderPayable: "365000",
    });

    const { orderId, itemIds } = await createOrder([
      { variantId: variantA, price: "120000", quantity: 2 },
      { variantId: variantB, price: "50000", quantity: 3 },
    ]);
    const reserved = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId,
        verifiedEmail: true,
        candidate: resolved.candidate,
        deadline,
        pricing,
        subtotalAfterMarkdown: pricing.subtotal,
      })
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await db.transaction((tx) =>
      writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: itemIds,
        pricing,
        redemption: { id: reserved.redemptionId, benefitId: publicFixedBenefitId },
      })
    );
    const allocations = await pool!.query(
      `select component, order_item_id, amount::text as amount from order_discount_allocation
        where order_id=$1 order by component, order_item_id`,
      [orderId]
    );
    expect(allocations.rows).toEqual([
      { component: "markdown", order_item_id: itemIds.get(variantA), amount: "60000.00" },
      { component: "offer_goods", order_item_id: itemIds.get(variantA), amount: "15385.00" },
      { component: "offer_goods", order_item_id: itemIds.get(variantB), amount: "9615.00" },
    ]);
  }, 30_000);
});

describe("manual × shipping delivery + Markdown (L+T)", () => {
  it("original/subsidi/net/quote/payable terpisah dan satu allocation tanpa item", async () => {
    if (!db) return;
    const pickupAttempt = await evaluateSelectedManualCode(
      {
        code: MANUAL_SHIPPING_CODE,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        fulfillmentMethod: "pickup",
        now: NOW,
      },
      db
    );
    expect(pickupAttempt).toMatchObject({ ok: false, reason: "FULFILLMENT_NOT_ELIGIBLE" });

    const resolved = await evaluateSelectedManualCode(
      {
        code: MANUAL_SHIPPING_CODE,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: "30000",
        now: NOW,
      },
      db
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.candidate).toMatchObject({
      offerId: manualShippingOfferId,
      activationKind: "manual_only",
      codeId: manualShippingCodeId,
      benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
      benefitAmount: "20000",
    });

    const pricing = pricingFor(resolved.candidate.benefit, {
      fulfillmentMethod: "delivery",
      shippingBeforeSubsidy: "30000",
    });
    // Literal independen: subsidi min(30000, cap20000)=20000; customer bayar
    // 10000 ongkir; PPN 11% hanya atas net barang 390000 = 42900.
    expect({
      subtotal: pricing.subtotal,
      goodsDiscount: pricing.goodsDiscount,
      netGoods: pricing.netGoods,
      shippingBeforeSubsidy: pricing.shippingBeforeSubsidy,
      shippingSubsidy: pricing.shippingSubsidy,
      shippingCost: pricing.shippingCost,
      merchantFunding: pricing.merchantFunding,
      providerQuotedShippingCost: pricing.providerQuotedShippingCost,
      providerBilledShippingCost: pricing.providerBilledShippingCost,
      ppnAmount: pricing.ppnAmount,
      serviceFee: pricing.serviceFee,
      total: pricing.total,
      expectedProviderPayable: pricing.expectedProviderPayable,
    }).toEqual({
      subtotal: "390000",
      goodsDiscount: "0",
      netGoods: "390000",
      shippingBeforeSubsidy: "30000",
      shippingSubsidy: "20000",
      shippingCost: "10000",
      merchantFunding: "20000",
      providerQuotedShippingCost: "30000",
      providerBilledShippingCost: null,
      ppnAmount: "42900",
      serviceFee: "0",
      total: "442900",
      expectedProviderPayable: "400000",
    });
    expect(pricing.lines.map((line) => line.goodsDiscountAmount)).toEqual(["0", "0"]);

    const { orderId, itemIds } = await createOrder([
      { variantId: variantA, price: "120000", quantity: 2 },
      { variantId: variantB, price: "50000", quantity: 3 },
    ]);
    const reserved = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId,
        verifiedEmail: true,
        candidate: resolved.candidate,
        deadline,
        pricing,
        subtotalAfterMarkdown: pricing.subtotal,
        fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: "30000",
      })
    );
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await db.transaction((tx) =>
      writeOrderDiscountAllocations(tx, {
        orderId,
        orderItemIdByVariant: itemIds,
        pricing,
        redemption: { id: reserved.redemptionId, benefitId: manualShippingBenefitId },
      })
    );
    const allocations = await pool!.query(
      `select component, order_item_id, amount::text as amount
         from order_discount_allocation where order_id=$1 order by component`,
      [orderId]
    );
    expect(allocations.rows).toEqual([
      { component: "markdown", order_item_id: itemIds.get(variantA), amount: "60000.00" },
      { component: "offer_shipping", order_item_id: null, amount: "20000.00" },
    ]);
    // Subsidi bukan goods: baris order tidak memuat diskon barang.
    const items = await pool!.query(
      `select goods_discount_amount::text as disc from order_item where order_id=$1`,
      [orderId]
    );
    expect(items.rows).toEqual([{ disc: "0.00" }, { disc: "0.00" }]);
  }, 30_000);
});

describe("admin publish/pause setelah preview (cross-slice 06/10 × 07)", () => {
  it("revisi persen baru menggugurkan konfirmasi lama tanpa redemption/usage parsial", async () => {
    if (!db) return;
    const preview = await evaluateSelectedManualCode(
      {
        code: MANUAL_PERCENT_CODE,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        now: NOW,
      },
      db
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const newRevisionId = `${manualPercentOfferId}-revision-2`;
    const newBenefitId = `${manualPercentOfferId}-benefit-2`;
    // Simulasi publish admin: revisi baru cap10000 + current revision bergeser.
    await pool!.query(
      `insert into discount_offer_revision
         (id, offer_id, revision_no, name, currency, min_subtotal, published_at, actor_identity)
       values ($1,$2,2,'Manual Persen 12.5 (maks 10rb)','IDR','0',now(),'fixture')`,
      [newRevisionId, manualPercentOfferId]
    );
    await pool!.query(
      `insert into discount_benefit (id, revision_id, kind, scope, rate, cap_amount)
       values ($1,$2,'percentage_goods','goods','12.5','10000')`,
      [newBenefitId, newRevisionId]
    );
    await pool!.query(
      `update discount_offer set current_revision_id=$2, policy_version=policy_version+1 where id=$1`,
      [manualPercentOfferId, newRevisionId]
    );

    const { orderId } = await createOrder([
      { variantId: variantA, price: "120000", quantity: 2 },
      { variantId: variantB, price: "50000", quantity: 3 },
    ]);
    const pricing = pricingFor(preview.candidate.benefit);
    await expect(
      db.transaction((tx) =>
        lockAndEvaluateOfferReservation(tx, {
          clientId,
          verifiedEmail: true,
          candidate: preview.candidate,
          subtotalAfterMarkdown: "390000",
        })
      )
    ).rejects.toThrow("Pilihan promo berubah. Periksa kembali pesanan.");
    expect(await counterState()).toEqual({
      usage: {
        reserved_count: 0,
        consumed_count: 0,
        reserved_amount: "0.00",
        consumed_amount: "0.00",
      },
      redemptionCount: 0,
    });
    expect(pricing.goodsDiscount).toBe("20000");

    // Kandidat baru dari revisi terbit tetap bisa direservasi (fail closed ≠
    // mematikan Offer): nominal cap10000 menggantikan 20000.
    const fresh = await evaluateSelectedManualCode(
      {
        code: MANUAL_PERCENT_CODE,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        now: NOW,
      },
      db
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.candidate.benefitAmount).toBe("10000");
    const freshPricing = pricingFor(fresh.candidate.benefit);
    const reserved = await db.transaction((tx) =>
      reserveRedemptionForOrder(tx, {
        orderId,
        clientId,
        verifiedEmail: true,
        candidate: fresh.candidate,
        deadline,
        pricing: freshPricing,
        subtotalAfterMarkdown: "390000",
      })
    );
    expect(reserved.ok).toBe(true);
  }, 30_000);

  it("pause setelah preview menolak commit dengan reason aman, tanpa menulis apa pun", async () => {
    if (!db) return;
    const preview = await evaluateSelectedManualCode(
      {
        code: MANUAL_PERCENT_CODE,
        clientId,
        verifiedEmail: true,
        subtotalAfterMarkdown: "390000",
        now: NOW,
      },
      db
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    await pool!.query(`update discount_offer set state='paused' where id=$1`, [
      manualPercentOfferId,
    ]);

    const { orderId } = await createOrder([
      { variantId: variantA, price: "120000", quantity: 2 },
      { variantId: variantB, price: "50000", quantity: 3 },
    ]);
    const decision = await db.transaction((tx) =>
      lockAndEvaluateOfferReservation(tx, {
        clientId,
        verifiedEmail: true,
        candidate: preview.candidate,
        subtotalAfterMarkdown: "390000",
      })
    );
    expect(decision).toMatchObject({ ok: false, reason: "OFFER_UNAVAILABLE" });
    expect(await counterState()).toEqual({
      usage: {
        reserved_count: 0,
        consumed_count: 0,
        reserved_amount: "0.00",
        consumed_amount: "0.00",
      },
      redemptionCount: 0,
    });
    const allocations = await pool!.query(
      `select count(*)::int as count from order_discount_allocation where order_id=$1`,
      [orderId]
    );
    expect(allocations.rows[0].count).toBe(0);
  }, 30_000);
});
