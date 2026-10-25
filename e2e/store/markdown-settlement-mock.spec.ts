/**
 * Ticket 03 — Markdown sampai pembayaran pada controlled external seam (H/P).
 *
 * Satu order pickup qty1: source 300000, target Markdown 150000.
 *   customer/Midtrans : goods efektif 150000 + PPN 11% 16500 = 166500
 *   provider Sales/Invoice/Payment : gross 300000, whole-line disc 150000,
 *     grand total/payable 150000, tax/fee/add_disc 0
 * Invoice dan payment harus menunjukkan angka yang sama dan tertaut; mirror
 * (jika berjalan) tidak boleh menghapus disc_amount atau menambah
 * shipping_cost_discount.
 *
 * Berjalan hanya di mock config + DB disposable; provider adalah loopback mock,
 * bukan Jubelio/Midtrans nyata. Setelah order lunas, snapshot/ledger tersimpan
 * dibaca ulang untuk membuktikan tidak ada reprice.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { createHmac, randomUUID, createHash } from "node:crypto";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";
import { deleteRetainedOrderFixtures } from "../../packages/db/src/testing/retained-order-fixtures";

dotenv.config({ path: ".env" });

const STORE_BASE_URL = process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL = process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    throw new Error("markdown-settlement-mock.spec.ts must run under playwright.mock.config.ts");
  }
  for (const raw of [STORE_BASE_URL, MOCK_BASE_URL]) {
    const parsed = new URL(raw);
    if (
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
      !PORTS.has(parsed.port)
    ) {
      throw new Error(`markdown-settlement-mock.spec.ts refuses non-loopback base ${raw}`);
    }
  }
  const name = process.env.DATABASE_URL
    ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""))
    : "";
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `markdown-settlement-mock.spec.ts requires a disposable marketplace_discounts_test_* DATABASE_URL, got "${name}"`
    );
  }
}
requireIsolatedRun();

const PREFIX = "e2e-md-settle";
const PRODUCT_ID = `${PREFIX}-product`;
const PRODUCT_SLUG = `${PREFIX}-product-slug`;
const VARIANT_ID = `${PREFIX}-variant`;
const SKU = "E2E-MD-SETTLE";
const MOCK_ITEM_ID = 941_001;
const SOURCE_PRICE = 300_000;
const TARGET_PRICE = 150_000;
const CUSTOMER_TOTAL = 166_500;
const PPN_AMOUNT = 16_500;
const STOCK_UNITS = 5;
const CONTACT_EMAIL = "markdown-settlement-e2e@example.test";
const BATCH_ID = `${PREFIX}-batch`;

type MockRequest = { method: string; path: string; body: Record<string, unknown> };

let pool: Pool;
let storeContext: BrowserContext;
let homeBranchId = "";
let homeLocationId = 0;
let gateBefore: { value: string; type: string; description: string | null } | undefined;
let orderId = "";

async function mockControl<T = Record<string, unknown>>(
  method: "PUT" | "POST" | "GET",
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${MOCK_BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: "mock-token" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`jubelio-mock ${method} ${path} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function capturedRequests(): Promise<MockRequest[]> {
  const result = await mockControl<{ data?: MockRequest[] }>("GET", "/__control/requests");
  return result.data ?? [];
}

function signMidtrans(orderIdValue: string, grossAmount: string): string {
  return createHash("sha512")
    .update(`${orderIdValue}200${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
}

async function postSettlementWebhook(orderIdValue: string, grossAmount: string) {
  const response = await fetch(`${STORE_BASE_URL}/api/webhooks/midtrans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order_id: orderIdValue,
      transaction_status: "settlement",
      status_code: "200",
      gross_amount: grossAmount,
      signature_key: signMidtrans(orderIdValue, grossAmount),
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function nextOpenDate(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function ownOrder(id: string) {
  const response = await storeContext.request.get(`/api/orders/${id}`);
  expect(response.ok(), `GET /api/orders/${id} failed: ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { success: boolean; data: Record<string, unknown> };
  expect(body.success).toBe(true);
  return body.data;
}

async function clearAdmissionWindows(): Promise<void> {
  // The isolated admission window is shared by every mock spec for this
  // account/IP; clear ONLY this fixture's keys so a rerun is not rate-limited.
  const owner = await pool.query<{ id: string }>(
    "SELECT id FROM client WHERE email=$1",
    [TEST_USERS.store.email]
  );
  const subject = (kind: string, value: string) =>
    createHmac("sha256", "mock-e2e-only-shared-auth-secret-do-not-reuse")
      .update(`okcir:checkout-admission:v1:${kind}:${value}`)
      .digest("hex");
  const keys = [subject("ip", "127.0.0.1")];
  if (owner.rows[0]?.id) keys.push(subject("account", owner.rows[0].id));
  await pool.query("DELETE FROM discount_request_window WHERE subject_hash = ANY($1::text[])", [keys]);
}

async function cleanup() {
  await deleteRetainedOrderFixtures(pool, orderId ? [orderId] : []);
  orderId = "";
  await pool.query("DELETE FROM cart_item WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM variant_price_current WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query(
    "UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE variant_id=$1",
    [VARIANT_ID]
  );
  await pool.query("DELETE FROM audit_log WHERE entity_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM price_change_batch_row WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM price_change_batch WHERE id=$1", [BATCH_ID]);
  await pool.query("DELETE FROM branch_stock WHERE product_variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM product_variant WHERE id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM product WHERE id=$1", [PRODUCT_ID]);
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  await cleanup();
  await clearAdmissionWindows();

  const branch = await pool.query<{ branch_id: string; jubelio_location_id: number | null }>(
    `SELECT b.id AS branch_id, b.jubelio_location_id
       FROM "user" u JOIN branch b ON b.id=u.branch_id
      WHERE u.username=$1 AND b.status='aktif' AND b.jubelio_location_id IS NOT NULL
      LIMIT 1`,
    [TEST_USERS.admin.identifier]
  );
  homeBranchId = branch.rows[0]?.branch_id ?? "";
  homeLocationId = branch.rows[0]?.jubelio_location_id ?? 0;
  expect(homeBranchId).toBeTruthy();
  expect(homeLocationId).toBeGreaterThan(0);

  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'E2E Markdown Settlement', $2, '500000', 'aktif')`,
    [PRODUCT_ID, PRODUCT_SLUG]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1,$2,$3,'300000',true,$4)`,
    [VARIANT_ID, PRODUCT_ID, SKU, MOCK_ITEM_ID]
  );
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1,$2,$3,0,0,0,0,$3,NOW())`,
    [homeBranchId, VARIANT_ID, STOCK_UNITS]
  );

  // Markdown applied while source was 300000: target 150000 active.
  const revisionId = `${PREFIX}-rev-1`;
  const rowId = `${PREFIX}-row-1`;
  await pool.query(
    `INSERT INTO price_change_batch
       (id, actor_identity, request_key, fingerprint, source, state, row_count,
        applied_count, unchanged_count, failed_count, pending_count)
     VALUES ($1,'seed',$2,$3,'manual','applied',1,1,0,0,0)`,
    [BATCH_ID, randomUUID(), "e".repeat(64)]
  );
  await pool.query(
    `INSERT INTO variant_price_revision
       (id, variant_id, revision_no, action, target_unit_price, source_unit_price,
        effective_unit_price, previous_target_unit_price, previous_effective_unit_price,
        markdown_active, previous_markdown_active, batch_id, batch_row_id, actor_identity)
     VALUES ($1,$2,1,'set_price','150000','300000','150000',NULL,'300000',true,false,$3,$4,'seed')`,
    [revisionId, VARIANT_ID, BATCH_ID, rowId]
  );
  await pool.query(
    `INSERT INTO price_change_batch_row
       (id, batch_id, row_number, input_sku, variant_id, action, target_unit_price,
        preview_json, state, applied_revision_id)
     VALUES ($1,$2,1,$3,$4,'set_price','150000','{}'::jsonb,'applied',$5)`,
    [rowId, BATCH_ID, SKU, VARIANT_ID, revisionId]
  );
  await pool.query(
    `INSERT INTO variant_price_current (variant_id, revision_id, version) VALUES ($1,$2,1)`,
    [VARIANT_ID, revisionId]
  );

  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion','1','number')
     ON CONFLICT (key) DO UPDATE SET value='1', type='number'`
  );

  storeContext = await browser.newContext({ baseURL: STORE_BASE_URL, extraHTTPHeaders: {} });
  const signIn = await storeContext.request.post(`${STORE_BASE_URL}/api/auth/sign-in/email`, {
    data: { email: TEST_USERS.store.email, password: TEST_USERS.store.password },
  });
  expect(signIn.ok(), `store sign-in failed: ${await signIn.text()}`).toBe(true);
});

test.afterAll(async () => {
  await storeContext?.close().catch(() => {});
  await clearAdmissionWindows().catch(() => {});
  await cleanup();
  if (gateBefore) {
    await pool.query(
      "UPDATE system_config SET value=$1, type=$2, description=$3 WHERE key='discounts.contractVersion'",
      [gateBefore.value, gateBefore.type, gateBefore.description]
    );
  } else {
    await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
  }
  await pool.end();
});

test("pickup Markdown 300000→150000: customer 166500, provider whole-line disc 150000, invoice/payment exact", async () => {
  test.setTimeout(120_000);
  expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");
  expect(
    (
      await mockControl("POST", "/__control/stocks/ensure", {
        locationId: homeLocationId,
        itemId: MOCK_ITEM_ID,
        onHand: STOCK_UNITS,
      })
    ).status
  ).toBe("ok");

  await storeContext.request.delete("/api/cart");
  const added = await storeContext.request.post("/api/cart/items", {
    data: { variantId: VARIANT_ID, branchId: homeBranchId, quantity: 1 },
  });
  expect(added.ok(), `add to cart failed: ${await added.text()}`).toBe(true);
  const cart = (await (await storeContext.request.get("/api/cart")).json()) as {
    data: { items: Array<{ id: string }> };
  };
  const cartItemId = cart.data.items[0]?.id;
  expect(cartItemId).toBeTruthy();

  const pickupDate = nextOpenDate();
  const previewResponse = await storeContext.request.post("/api/checkout/preview", {
    data: {
      phone: "081234567893",
      email: CONTACT_EMAIL,
      pickupDate,
      pickupTime: "10:00",
      selectedItemIds: [cartItemId],
      promoSelection: { kind: "none" },
    },
  });
  expect(previewResponse.ok(), `preview failed: ${await previewResponse.text()}`).toBe(true);
  const preview = (await previewResponse.json()) as {
    data: { reviewToken: string; pricing: Record<string, string> };
  };
  expect(preview.data.pricing).toMatchObject({
    subtotal: "150000",
    markdownTotal: "150000",
    ppnAmount: "16500",
    total: "166500",
  });

  const placedResponse = await storeContext.request.post("/api/checkout/place-order", {
    data: {
      requestKey: randomUUID(),
      reviewToken: preview.data.reviewToken,
      promoSelection: { kind: "none" },
      phone: "081234567893",
      email: CONTACT_EMAIL,
      pickupDate,
      pickupTime: "10:00",
      selectedItemIds: [cartItemId],
    },
  });
  expect(placedResponse.status(), `place-order failed: ${await placedResponse.text()}`).toBe(201);
  const placed = (await placedResponse.json()) as { orderId: string; redirectUrl: string };
  orderId = placed.orderId;
  expect(orderId).toBeTruthy();

  const captured = await capturedRequests();

  // Midtrans: customer pays the effective goods + PPN, no service fee line.
  const snaps = captured.filter(
    (record) =>
      record.method === "POST" &&
      record.path === "/snap/v1/transactions" &&
      (record.body.transaction_details as { order_id?: string } | undefined)?.order_id === orderId
  );
  expect(snaps).toHaveLength(1);
  expect(snaps[0].body.transaction_details).toEqual({
    order_id: orderId,
    gross_amount: CUSTOMER_TOTAL,
  });
  expect(snaps[0].body.item_details).toEqual([
    { id: VARIANT_ID, name: "E2E Markdown Settlement", price: 150_000, quantity: 1 },
    { id: "PPN", name: "PPN 11%", price: PPN_AMOUNT, quantity: 1 },
  ]);

  // Sales Order: source price + whole-line discount, zero tax/fee/add_disc.
  const soPosts = captured.filter(
    (record) =>
      record.method === "POST" &&
      record.path === "/sales/orders/" &&
      record.body.salesorder_id === 0 &&
      record.body.ref_no === orderId
  );
  expect(soPosts).toHaveLength(1);
  expect(soPosts[0].body).toMatchObject({
    sub_total: SOURCE_PRICE,
    total_disc: TARGET_PRICE,
    total_tax: 0,
    grand_total: TARGET_PRICE,
    add_disc: 0,
    add_fee: 0,
    service_fee: 0,
    location_id: homeLocationId,
  });
  expect(soPosts[0].body.items).toEqual([
    expect.objectContaining({
      item_id: MOCK_ITEM_ID,
      qty_in_base: 1,
      price: SOURCE_PRICE,
      disc: 50,
      disc_amount: TARGET_PRICE,
      tax_amount: 0,
      amount: TARGET_PRICE,
    }),
  ]);

  const pending = await ownOrder(orderId);
  expect(pending).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
  expect(Number(pending.total)).toBe(CUSTOMER_TOTAL);
  expect(pending.pricingSnapshot).toMatchObject({
    sourceGoodsSubtotal: "300000",
    markdownTotal: "150000",
    subtotal: "150000",
    netGoods: "150000",
    ppnAmount: "16500",
    total: "166500",
    expectedProviderPayable: "150000",
  });

  // Authoritative settlement through the controlled Midtrans boundary.
  expect(
    (
      await mockControl("PUT", "/__control/midtrans-status", {
        orderId,
        transactionStatus: "settlement",
        grossAmount: String(CUSTOMER_TOTAL),
        paymentType: "gopay",
        transactionId: "markdown-settlement-txn",
      })
    ).status
  ).toBe("ok");
  const webhook = await postSettlementWebhook(orderId, String(CUSTOMER_TOTAL));
  expect(webhook.status, `webhook failed: ${JSON.stringify(webhook.body)}`).toBe(200);

  await expect
    .poll(async () => (await ownOrder(orderId)).status, { timeout: 30_000 })
    .toBe("ready_for_pickup");
  const settled = await ownOrder(orderId);
  expect({
    paymentStatus: settled.paymentStatus,
    fulfillmentBlockedReason: settled.fulfillmentBlockedReason,
  }).toEqual({ paymentStatus: "paid", fulfillmentBlockedReason: null });
  expect(settled.pricingSnapshot).toMatchObject({
    markdownTotal: "150000",
    netGoods: "150000",
    expectedProviderPayable: "150000",
    total: "166500",
  });

  // SO → invoice → payment: exact expected money and linkage from the ledger.
  const soId = Number(settled.jubelioSalesOrderId);
  const invoiceId = Number(settled.jubelioInvoiceId);
  const paymentId = Number(settled.jubelioPaymentId);
  expect(soId).toBeGreaterThan(0);
  expect(invoiceId).toBeGreaterThan(0);
  expect(paymentId).toBeGreaterThan(0);

  const so = await mockControl<Record<string, unknown>>("GET", `/sales/orders/${soId}`);
  expect(so).toMatchObject({
    salesorder_id: soId,
    sub_total: SOURCE_PRICE,
    total_disc: TARGET_PRICE,
    total_tax: 0,
    grand_total: TARGET_PRICE,
    invoice_id: invoiceId,
  });
  const invoice = await mockControl<Record<string, unknown>>("GET", `/sales/invoices/${invoiceId}`);
  expect(invoice).toMatchObject({
    invoice_id: invoiceId,
    salesorder_id: soId,
    sub_total: String(SOURCE_PRICE),
    total_disc: String(TARGET_PRICE),
    total_tax: "0",
    grand_total: String(TARGET_PRICE),
    payment_amount: TARGET_PRICE,
  });
  const payment = await mockControl<Record<string, unknown>>("GET", `/sales/payments/${paymentId}`);
  expect(payment).toMatchObject({
    payment_id: paymentId,
    amount: String(TARGET_PRICE),
    account_id: 2,
    payment_type: 0,
  });

  // Mirror (informational): if this run posted a channel-status edit, it must
  // preserve the whole-line discount and never introduce shipping_cost_discount.
  const mirrorPosts = captured.filter(
    (record) => record.method === "PUT" && record.path === `/sales/orders/${soId}`
  );
  for (const post of mirrorPosts) {
    expect(post.body).not.toHaveProperty("shipping_cost_discount");
    const items = post.body.items as Array<Record<string, unknown>> | undefined;
    if (items && items.length > 0) {
      expect(items[0]).toMatchObject({
        price: SOURCE_PRICE,
        disc_amount: TARGET_PRICE,
        amount: TARGET_PRICE,
        tax_amount: 0,
      });
    }
  }
});
