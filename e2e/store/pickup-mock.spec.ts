/**
 * Ticket 01 — mock-only pickup lifecycle (browser + HTTP + DB fixture seam).
 *
 * ONE Playwright spec that proves the ticket-01 contract end to end WITHOUT
 * any live provider traffic:
 *
 *   fixture goods Rp100.000 (no discount) at website PPN 11% →
 *   website/Midtrans charge Rp111.000 while the single Jubelio Sales Order,
 *   its invoice and its Jubelio payment carry ONLY the goods value
 *   (Rp100.000, item/SO tax and discount 0) — the two nominal ledgers are
 *   verified separately, never forced equal. No pickup code exists until the
 *   Midtrans payment AND the verified SO settlement (invoice + payment) are
 *   committed; then the Home-Branch admin verifies the code exactly once.
 *
 * The two nominal ledgers and the pickup gate are asserted against an
 * INDEPENDENT source of truth — the literal worked example of the approved
 * spec / ticket (100000 → 111000 website, 100000 SO/invoice/payment, SO tax
 * 0) — never by recomputing implementation values.
 *
 * Seams (pre-agreed for ticket 01):
 * - Browser: storefront cart → checkout → pay → payment-redirect boundary;
 *   admin order detail → Customer Pick Up dialog → Verify & Complete.
 * - Public HTTP: Better Auth sign-in, Midtrans webhook, review-queue API,
 *   and the Jubelio mock's public endpoints + `/__control/*` fixture seams.
 * - Database fixture seam: the spec creates/restores its own fixture rows
 *   (product, variant, branch stock, orders, audit log) — it never mutates
 *   seeded rows.
 *
 * RED UNTIL THE PARENT IMPLEMENTS (see ticket handoff for details, in order):
 * 1. `E2E_PROVIDER_MOCKS=true` + loopback `JUBELIO_SALES_MOCK_API_BASE_URL`
 *    must unlock a test-only sales runtime in `resolveJubelioSalesRuntime`
 *    (loopback-pinned, fail-closed, no live fallback). Until then the sales
 *    gateway stays disabled in this run, so place-order fails at the stock
 *    read / SO create below — that IS the expected red.
 * 2. Jubelio mock gaps (apps/jubelio-mock/src/server.ts): `POST
 *    /inventory/items/all-stocks/` must return a `locations[]` list with
 *    non-blank names and the documented `available = on_hand − on_order −
 *    reserved` series (checkout's authority `selectObservedStock` reads it);
 *    `POST /sales/orders/` must accept a `customer_name` that differs from
 *    the generic contact's name (the live sandbox accepts it; the store sends
 *    the signed-in customer's name).
 *
 * Run with the isolated mock config (never alongside the live suite):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { Pool } from "pg";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";

dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (also set by playwright.mock.config.ts; keep in sync)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL = process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";

// ---------------------------------------------------------------------------
// Fixture-independent expected money (ticket 01 contract, NOT implementation
// output): 11% PPN rounds up to a whole Rupiah (docs/features/ppn.md).
// ---------------------------------------------------------------------------

const GOODS_PRICE = 100_000;
const GOODS_QUANTITY = 1;
const EXPECTED_PPN_RATE = 11;
const EXPECTED_PPN_AMOUNT = 11_000; // ceil(100_000 × 11 / 100)
const EXPECTED_WEBSITE_TOTAL = 111_000; // goods + website PPN (Midtrans)
const EXPECTED_SO_GOODS_VALUE = 100_000; // SO/invoice/payment carry goods only

const MOCK_ITEM_ID = 910_001;
const MOCK_STOCK_UNITS = 5;
const FIXTURE_PRODUCT_ID = "e2e-pickup-mock-product";
const FIXTURE_PRODUCT_SLUG = "pickup-mock-anchor";
const FIXTURE_VARIANT_ID = "e2e-pickup-mock-variant";
const FIXTURE_VARIANT_SKU = "PICKMOCK-01";
const MOCK_LOGIN = { email: "e2e-mock@example.test", password: "e2e-mock" };

const CONTACT_EMAILS = [
  "pickup-mock-e2e@example.com",
  "pickup-mock-blocked-e2e@example.com",
] as const;

// ---------------------------------------------------------------------------
// Own browser contexts (no storageState): sessions are created through the
// public Better Auth HTTP seam, which is same-origin and works on the isolated
// ports, unlike the UI login flows (client base URL is port-locked by the
// apps' .env.local overrides).
// ---------------------------------------------------------------------------

let storeContext: BrowserContext;
let adminContext: BrowserContext;
let adminPage: Page;

// ---------------------------------------------------------------------------
// Database fixture
// ---------------------------------------------------------------------------

let pool: Pool;
let homeBranchId = "";
let homeLocationId = 0;

async function queryRows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** Local YYYY-MM-DD of the next non-Sunday day (branch hours: Mon–Sat 9–21). */
function nextOpenDate(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Mock helpers (fixture seam, in-memory instance on the isolated port)
// ---------------------------------------------------------------------------

type MockRequestRecord = { method: string; path: string; body: Record<string, unknown> };

async function mockControl(
  method: "POST" | "PUT" | "GET",
  path: string,
  body?: unknown,
  token?: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`${MOCK_BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `jubelio-mock ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function getMockSalesRequests(): Promise<MockRequestRecord[]> {
  const result = await mockControl("GET", "/__control/requests");
  return (result.data as MockRequestRecord[]) ?? [];
}

async function getMockToken(): Promise<string> {
  const result = await mockControl("POST", "/login", {
    email: MOCK_LOGIN.email,
    password: MOCK_LOGIN.password,
  });
  return String(result.token);
}

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const isEmail = identifier.includes("@");
  const response = await context.request.post(`${base}/api/auth/sign-in/${isEmail ? "email" : "username"}`, {
    data: isEmail ? { email: identifier, password } : { username: identifier, password },
  });
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

/**
 * Drives the storefront UI: add fixture item → cart → checkout → contact →
 * pickup slot → review step. The caller asserts step 3 before paying.
 */
async function reachCheckoutReview(
  page: Page,
  email: string
): Promise<void> {
  const add = await storeContext.request.post("/api/cart/items", {
    data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: GOODS_QUANTITY },
  });
  expect(add.ok(), `adding the fixture variant failed: ${await add.text()}`).toBe(true);

  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(email);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00" }).click();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
  await page.getByText(/Saya telah memeriksa pesanan/).click();
}

/**
 * The checkout's dev mock payment result hardcodes
 * `http://localhost:3000/checkout/payment-test` (midtrans.ts). Keep the
 * browser flow real and same-origin: a payment-test navigation that is NOT
 * on the isolated store origin is 302-redirected to the isolated one. If the
 * redirect honors the server env after the parent's fix, matching-origin
 * navigations fall through untouched.
 */
async function isolatePaymentRedirect(page: Page): Promise<void> {
  await page.route("**/checkout/payment-test?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
    const target = `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}`;
    void route.fulfill({ status: 302, headers: { location: target } });
  });
}

/** Pays through the checkout UI via the E2E mock payment boundary. */
async function payThroughMockBoundary(
  page: Page,
  expectedContactEmail: string
): Promise<string> {
  await reachCheckoutReview(page, expectedContactEmail);
  await isolatePaymentRedirect(page);

  // Buffer the real HTTP response before returning it to the browser, whose
  // immediate payment navigation otherwise invalidates Chromium's response body.
  let payload: unknown;
  await page.route("**/api/checkout/place-order", async (route) => {
    const response = await route.fetch();
    payload = await response.json();
    await route.fulfill({ response });
  });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order")),
    page.getByRole("button", { name: "Bayar Sekarang" }).click(),
  ]);
  const body = payload as {
    success: boolean;
    orderId?: string;
    redirectUrl?: string;
    error?: string;
  };
  // Expected RED before the seam lands: the place-order response explains why
  // (stock authority / SO gateway), and the message proves the failure shape.
  expect(
    { success: body.success, error: body.error ?? null },
    `place-order must succeed in the mock run (reported error: ${body.error ?? "none"})`
  ).toEqual({ success: true, error: null });
  expect(body.orderId, "place-order must return the durable orderId").toBeTruthy();
  expect(body.redirectUrl ?? "").toContain("/checkout/payment-test?orderId=");

  await page.waitForURL("**/checkout/payment-test?*");
  expect(new URL(page.url()).searchParams.get("orderId")).toBe(body.orderId);
  return body.orderId as string;
}

/** SHA-512 classic Snap signature (midtrans.ts contract), posted as JSON. */
async function postSignedWebhook(
  origin: string,
  orderId: string,
  grossAmount: string
): Promise<Response> {
  const signature = crypto
    .createHash("sha512")
    .update(`${orderId}200${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
  return fetch(`${origin}/api/webhooks/midtrans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      transaction_status: "settlement",
      status_code: "200",
      gross_amount: grossAmount,
      signature_key: signature,
    }),
  });
}

/** Deletes this spec's orders (and their FK-cascaded ledger rows). */
async function cleanOrderRows(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await pool.query(
    "DELETE FROM audit_log WHERE action = 'VERIFY_PICKUP_CODE' AND entity_id = ANY($1::text[])",
    [orderIds]
  );
  await pool.query("DELETE FROM orders WHERE id = ANY($1::text[])", [orderIds]);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run (deterministic ids).
  const stale = await pool.query<{ id: string }>(
    "SELECT id FROM orders WHERE contact_email = ANY($1::text[])",
    [[...CONTACT_EMAILS]]
  );
  await cleanOrderRows(stale.rows.map((row) => row.id));
  await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);

  // Precondition: the seeded PPN config (spec contract fixture).
  const ppn = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM system_config WHERE key = 'tax.ppnRatePercent'"
  );
  expect(
    ppn.rows[0]?.value,
    "mock pickup spec requires the seeded tax.ppnRatePercent = 11 (npm run db:seed)"
  ).toBe("11");

  // The Home Branch of the seeded admin identity (e2e/config.ts).
  const admin = await pool.query<{
    branch_id: string | null;
    jubelio_location_id: number | null;
    city: string | null;
  }>(
    `SELECT u.branch_id, b.jubelio_location_id, b.city
     FROM "user" u JOIN branch b ON b.id = u.branch_id
     WHERE u.username = $1`,
    [TEST_USERS.admin.identifier]
  );
  homeBranchId = admin.rows[0]?.branch_id ?? "";
  homeLocationId = admin.rows[0]?.jubelio_location_id ?? 0;
  expect(
    homeBranchId,
    "the seeded admin must have an active Jubelio-linked Home Branch (npm run db:seed)"
  ).toBeTruthy();
  expect(
    homeLocationId,
    "the seeded admin's Home Branch must be linked to a Jubelio location"
  ).toBeGreaterThan(0);

  // Fixture product: exactly one Rp100.000 variant carried by the Home Branch.
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Pickup Mock Anchor', $2, '100000.00', 'aktif')`,
    [FIXTURE_PRODUCT_ID, FIXTURE_PRODUCT_SLUG]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1, $2, $3, '100000.00', true, $4)`,
    [FIXTURE_VARIANT_ID, FIXTURE_PRODUCT_ID, FIXTURE_VARIANT_SKU, MOCK_ITEM_ID]
  );
  // Provisional local mirror only; the provider observation still authorizes
  // the checkout and reconciles this row from the mock before the SO create.
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, $3, NOW())`,
    [homeBranchId, FIXTURE_VARIANT_ID, MOCK_STOCK_UNITS]
  );

  // Own sessions on the isolated origins (public HTTP sign-in seam).
  storeContext = await browser.newContext({
    baseURL: STORE_BASE_URL,
    extraHTTPHeaders: { "x-e2e-payment-mock": "true" },
  });
  await httpSignIn(storeContext, STORE_BASE_URL, TEST_USERS.store.email, TEST_USERS.store.password);

  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(adminContext, ADMIN_BASE_URL, TEST_USERS.admin.identifier, TEST_USERS.admin.password);

  // Isolated-port seam for the admin client mirror: the dev build inlines the
  // auth client base URL (:3001 from apps/admin/.env.local) into the admin
  // app. In this run that origin is guaranteed untouched (reuse is rejected),
  // so serve the session lookups from the isolated admin app; after the
  // parent's env fix this interception never matches and stays a no-op.
  adminPage = await adminContext.newPage();
  await adminPage.route(/\/api\/auth\/get-session/, (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === ADMIN_BASE_URL) return route.fallback();
    const target = `${ADMIN_BASE_URL}/api/auth/get-session${requestUrl.search}`;
    void route.continue({ url: target });
  });
});

test.afterAll(async () => {
  await adminContext?.close().catch(() => {});
  await storeContext?.close().catch(() => {});

  if (pool) {
    const stale = await pool.query<{ id: string }>(
      "SELECT id FROM orders WHERE contact_email = ANY($1::text[])",
      [[...CONTACT_EMAILS]]
    );
    await cleanOrderRows(stale.rows.map((row) => row.id));
    // Fixture rows cascade: product → product_variant → branch_stock.
    await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
    await pool.end();
  }
});

test.describe("mock-only pickup lifecycle (ticket 01)", () => {
  // Shared single customer context; the two lifecycle tests must not overlap.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    // Fresh in-memory provider state on the isolated mock instance.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: homeLocationId,
      itemId: MOCK_ITEM_ID,
      onHand: MOCK_STOCK_UNITS,
    });
    // Deterministic cart start: empty the customer's cart.
    const cart = (await (
      await storeContext.request.get("/api/cart")
    ).json()) as { data?: { items?: Array<{ id: string }> } };
    for (const item of cart.data?.items ?? []) {
      await storeContext.request.delete(`/api/cart/items/${item.id}`);
    }
  });

  test("pickup order: goods-only Sales Order settles verified, then the Home Branch issues and verifies the pickup code once", async () => {
    const email = CONTACT_EMAILS[0];
    const page = await storeContext.newPage();

    // === Browser checkout through the E2E mock payment boundary ==========
    const orderId = await payThroughMockBoundary(page, email);

    // === GATE: no pickup offer before Midtrans + settlement ==============
    const gate = await queryRows<{
      status: string;
      payment_status: string;
      pickup_code: string | null;
      fulfillment_blocked_reason: string | null;
    }>(
      `SELECT status, payment_status, pickup_code, fulfillment_blocked_reason
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(gate).toEqual([
      {
        status: "pending_payment",
        payment_status: "pending",
        pickup_code: null,
        fulfillment_blocked_reason: null,
      },
    ]);

    // === Nominal contract: website charges goods + website PPN ===========
    const pricing = await queryRows<{
      subtotal: string; discount: string; shipping_cost: string;
      service_fee: string; ppn_rate: string; ppn_amount: string; total: string;
    }>(
      `SELECT subtotal, discount, shipping_cost, service_fee, ppn_rate, ppn_amount, total
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(Number(pricing[0].subtotal)).toBe(GOODS_PRICE);
    expect(Number(pricing[0].discount)).toBe(0);
    expect(Number(pricing[0].shipping_cost)).toBe(0);
    expect(Number(pricing[0].service_fee)).toBe(0);
    expect(Number(pricing[0].ppn_rate)).toBe(EXPECTED_PPN_RATE);
    expect(Number(pricing[0].ppn_amount)).toBe(EXPECTED_PPN_AMOUNT);
    expect(Number(pricing[0].total)).toBe(EXPECTED_WEBSITE_TOTAL); // Rp111.000

    // === One Sales Order create POST carrying goods only =================
    const requests = (await getMockSalesRequests()).filter(
      (record) =>
        record.method === "POST" &&
        record.path === "/sales/orders/" &&
        record.body.salesorder_id === 0
    );
    expect(requests, "exactly ONE Sales Order create POST — never a retry/duplicate").toHaveLength(1);
    const soBody = requests[0].body;
    expect(soBody).toMatchObject({
      sub_total: GOODS_PRICE,
      total_disc: 0,
      total_tax: 0, // SO tax is 0; the website PPN never enters the SO
      grand_total: GOODS_PRICE,
      source: 1,
      ref_no: orderId,
      channel_status: "Belum Bayar",
      location_id: homeLocationId,
      contact_id: -1,
    });
    const soItems = soBody.items as Record<string, unknown>[] | undefined;
    expect(soItems).toHaveLength(1);
    expect(soItems?.[0]).toMatchObject({
      item_id: MOCK_ITEM_ID,
      qty_in_base: 1,
      price: GOODS_PRICE,
      disc_amount: 0,
      tax_amount: 0,
      amount: GOODS_PRICE,
      location_id: homeLocationId,
    });

    // === Durable ledger: create intent → confirmed with the SO id ========
    const createOp = await queryRows<{ sales_order_id: number | null; status: string }>(
      `SELECT sales_order_id, status FROM jubelio_sales_operation
       WHERE order_id = $1 AND type = 'create'`,
      [orderId]
    );
    expect(createOp[0].status).toBe("confirmed");
    const salesOrderId = createOp[0].sales_order_id as number;
    expect(salesOrderId).toBeGreaterThan(0);
    const orderRow = await queryRows<{ jubelio_sales_order_id: number | null }>(
      "SELECT jubelio_sales_order_id FROM orders WHERE id = $1",
      [orderId]
    );
    expect(orderRow[0].jubelio_sales_order_id).toBe(salesOrderId);

    // === Midtrans: the website total is authoritative in the webhook =====
    expect(
      (await mockControl("PUT", "/__control/midtrans-status", {
        orderId,
        transactionStatus: "settlement",
        grossAmount: `${EXPECTED_WEBSITE_TOTAL}.00`, // independent: must match order.total
        paymentType: "gopay",
        transactionId: "mock-settlement-txn",
      })).status
    ).toBe("ok");
    const webhook = await postSignedWebhook(
      STORE_BASE_URL,
      orderId,
      `${EXPECTED_WEBSITE_TOTAL}.00`
    );
    expect(
      webhook.status,
      `the Midtrans webhook must accept the website total ${EXPECTED_WEBSITE_TOTAL}.00 (nominal gate)`
    ).toBe(200);

    // === The gate: settlement verified → ready_for_pickup → code =========
    const settled = await queryRows<{
      status: string; payment_status: string; pickup_code: string | null;
      jubelio_sales_order_id: number | null; jubelio_invoice_id: number | null;
      jubelio_payment_id: number | null; fulfillment_blocked_reason: string | null;
    }>(
      `SELECT status, payment_status, pickup_code, jubelio_sales_order_id,
              jubelio_invoice_id, jubelio_payment_id, fulfillment_blocked_reason
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(settled[0].status).toBe("ready_for_pickup");
    expect(settled[0].payment_status).toBe("paid");
    expect(settled[0].fulfillment_blocked_reason).toBeNull();
    expect(settled[0].pickup_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const pickupCode = settled[0].pickup_code as string;
    const invoiceId = settled[0].jubelio_invoice_id as number;
    const paymentId = settled[0].jubelio_payment_id as number;
    expect(invoiceId).toBeGreaterThan(0);
    expect(paymentId).toBeGreaterThan(0);

    // Ledger outcomes, all confirmed exactly once (create checked above).
    const ops = await queryRows<{ type: string; status: string; invoice_id: number | null; payment_id: number | null }>(
      `SELECT type, status, invoice_id, payment_id FROM jubelio_sales_operation
       WHERE order_id = $1`,
      [orderId]
    );
    const opsByType: Record<string, { status: string; invoice_id: number | null; payment_id: number | null }> = {};
    for (const op of ops) opsByType[op.type] = op;
    expect(opsByType.invoice).toMatchObject({ status: "confirmed", invoice_id: invoiceId });
    expect(opsByType.payment).toMatchObject({ status: "confirmed", payment_id: paymentId });
    expect(opsByType.cancel).toBeUndefined();

    // === Provider-side money: goods only, verified via the mock API ======
    const token = await getMockToken();
    const soGet = await mockControl("GET", `/sales/orders/${salesOrderId}`, undefined, token);
    expect(soGet).toMatchObject({
      salesorder_id: salesOrderId,
      sub_total: GOODS_PRICE,
      total_tax: 0,
      grand_total: GOODS_PRICE,
      total_disc: 0,
      is_canceled: false,
      invoice_id: invoiceId,
      invoice_no: expect.any(String),
    });
    // Invoice GET: the grand total is the goods value (decimal strings).
    const invoice = await mockControl("GET", `/sales/invoices/${invoiceId}`, undefined, token);
    expect(invoice).toMatchObject({
      invoice_id: invoiceId,
      sub_total: String(GOODS_PRICE),
      total_tax: "0",
      grand_total: String(GOODS_PRICE),
    });
    const invoiceItems = invoice.items as Record<string, unknown>[];
    expect(invoice.items).toHaveLength(1);
    expect(invoiceItems[0]).toMatchObject({
      item_id: MOCK_ITEM_ID,
      qty_in_base: 1,
      price: GOODS_PRICE,
      disc_amount: 0,
      tax_amount: 0,
      amount: GOODS_PRICE,
    });
    // Payment GET: exactly one association carrying the goods value.
    const payment = await mockControl("GET", `/sales/payments/${paymentId}`, undefined, token);
    expect(payment).toMatchObject({ payment_id: paymentId });
    const paymentItems = payment.invoices as Record<string, unknown>[];
    expect(payment.invoices).toHaveLength(1);
    expect(paymentItems[0]).toMatchObject({
      invoice_id: invoiceId,
      payment_amount: EXPECTED_SO_GOODS_VALUE,
    });
    // The two nominal ledgers stay DISTINCT by contract (never equalized).
    const paymentAmount = Number(payment.amount);
    expect(paymentAmount).toBe(EXPECTED_SO_GOODS_VALUE);
    expect(paymentAmount).not.toBe(EXPECTED_WEBSITE_TOTAL);

    // Path 1 is at-most-once on the provider: exactly one payment POST.
    const paymentPosts = (await getMockSalesRequests()).filter(
      (record) => record.method === "POST" && record.path === "/sales/payments/"
    );
    expect(paymentPosts).toHaveLength(1);

    // The customer sees the verified pickup code and immutable website total.
    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText("Kode Pickup Anda")).toBeVisible();
    await expect(page.getByText(pickupCode, { exact: true })).toBeVisible();
    await expect(page.getByText("Rp 111.000", { exact: true })).toBeVisible();

    // === Admin Home Branch verifies the code ONCE (browser dialog) =======
    // The still-best-effort channel mirror cannot block pickup: the mock
    // refuses the Siap Proses edit while the committed verify path works.
    await adminPage.goto(`${ADMIN_BASE_URL}/admin/orders/${orderId}`);
    await expect(adminPage.getByRole("button", { name: "Customer Pick Up" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Customer Pick Up" }).click();
    await expect(adminPage.getByRole("heading", { name: "Customer Pick Up" })).toBeVisible();
    await adminPage.getByLabel("Pickup Code").fill(pickupCode);
    await adminPage.getByRole("button", { name: "Verify & Complete" }).click();
    await expect(adminPage.getByText("Order completed successfully")).toBeVisible();

    const completed = await queryRows<{ status: string }>(
      "SELECT status FROM orders WHERE id = $1",
      [orderId]
    );
    expect(completed[0].status).toBe("completed");

    const audit = await queryRows<{ action: string; changes: { status: { from: string; to: string } } }>(
      `SELECT action, changes FROM audit_log
       WHERE action = 'VERIFY_PICKUP_CODE' AND entity_id = $1`,
      [orderId]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].changes.status).toEqual({ from: "ready_for_pickup", to: "completed" });

    // === The settled code is single-use: no second completion ============
    const replay = await adminContext.request.post(
      `${ADMIN_BASE_URL}/api/admin/orders/${orderId}/verify-pickup`,
      { data: { pickupCodeInput: pickupCode } }
    );
    expect(replay.status()).toBe(400);
    expect((await replay.json()).success).toBe(false);

    // Still exactly one Sales Order create POST across the whole lifecycle.
    const soRequestsAfter = (await getMockSalesRequests()).filter(
      (record) =>
        record.method === "POST" &&
        record.path === "/sales/orders/" &&
        record.body.salesorder_id === 0
    );
    expect(soRequestsAfter).toHaveLength(1);

    await page.close();
  });

  test("paid order whose settlement is never verified stays paid-but-blocked with no pickup code", async () => {
    const email = CONTACT_EMAILS[1];
    const page = await storeContext.newPage();
    const orderId = await payThroughMockBoundary(page, email);

    // Ambiguous invoice: the mock applies the conversion and answers late;
    // the store's 500ms budget turns that response into a client timeout —
    // the outcome is unknown, never retried, never assumed failed.
    expect(
      (await mockControl("PUT", "/__control/scenario", { scenario: "timeout-after-apply" })).status
    ).toBe("ok");

    expect(
      (await mockControl("PUT", "/__control/midtrans-status", {
        orderId,
        transactionStatus: "settlement",
        grossAmount: `${EXPECTED_WEBSITE_TOTAL}.00`,
        paymentType: "gopay",
        transactionId: "mock-blocked-txn",
      })).status
    ).toBe("ok");
    const webhook = await postSignedWebhook(
      STORE_BASE_URL,
      orderId,
      `${EXPECTED_WEBSITE_TOTAL}.00`
    );
    expect(webhook.status).toBe(200);

    // Midtrans's paid status is authoritative; fulfillment is NOT.
    const blocked = await queryRows<{
      status: string; payment_status: string; pickup_code: string | null;
      fulfillment_blocked_reason: string | null;
    }>(
      `SELECT status, payment_status, pickup_code, fulfillment_blocked_reason
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(blocked[0]).toEqual({
      status: "processing",
      payment_status: "paid",
      pickup_code: null,
      fulfillment_blocked_reason: expect.stringContaining("invoice"),
    });
    const invoiceOp = await queryRows<{ status: string }>(
      `SELECT status FROM jubelio_sales_operation
       WHERE order_id = $1 AND type = 'invoice'`,
      [orderId]
    );
    expect(invoiceOp[0].status).toBe("manual_review");

    // Ambiguity is never retried: exactly one conversion POST, no payment.
    const createInvoicePosts = (await getMockSalesRequests()).filter(
      (record) => record.method === "POST" && record.path === "/sales/packlists/create-invoice"
    );
    expect(createInvoicePosts).toHaveLength(1);
    const paymentPosts = (await getMockSalesRequests()).filter(
      (record) => record.method === "POST" && record.path === "/sales/payments/"
    );
    expect(paymentPosts).toHaveLength(0);

    // Ops see the case in the read-only review queue (own-branch scope).
    const queue = await adminContext.request.get(`${ADMIN_BASE_URL}/api/admin/reviews/sales-operations`);
    expect(queue.status()).toBe(200);
    const queueBody = (await queue.json()) as {
      data: {
        operations: Array<{ orderId: string; type: string; status: string }>;
        blockedOrders: Array<{
          orderId: string; status: string; paymentStatus: string;
          fulfillmentBlockedReason: string | null; jubelioPaymentId: number | null;
        }>;
      };
    };
    const operation = queueBody.data.operations.find(
      (op) => op.orderId === orderId && op.type === "invoice"
    );
    expect(operation).toBeTruthy();
    expect(operation).toMatchObject({ type: "invoice", status: "manual_review" });
    const blockedEntry = queueBody.data.blockedOrders.find((row) => row.orderId === orderId);
    expect(blockedEntry).toBeTruthy();
    expect(blockedEntry).toMatchObject({
      status: "processing",
      paymentStatus: "paid",
      jubelioPaymentId: null,
    });
    expect(String(blockedEntry?.fulfillmentBlockedReason ?? "")).toContain("invoice");

    // The gate refuses pickup for a blocked order (Home Branch admin).
    const attempt = await adminContext.request.post(
      `${ADMIN_BASE_URL}/api/admin/orders/${orderId}/verify-pickup`,
      { data: { pickupCodeInput: "AAA222" } }
    );
    expect(attempt.status()).toBe(400);
    expect((await attempt.json()).success).toBe(false);

    await page.close();
  });
});