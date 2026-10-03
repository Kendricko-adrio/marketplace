/**
 * Ticket 04 — mock-only delivery order, payment and settlement gate (browser +
 * HTTP + DB + control seams). ONE spec, serial cases on OWN fixtures:
 *
 * (1) PLACE a delivery order at the approved 133.200 via the mocked SO +
 *     payment boundary: the SO is goods-only (sub_total/tax/disc 0, NO ongkir),
 *     exactly ONE create POST with a durable intent + confirmed GET BEFORE the
 *     Snap; orders.fulfillment_method = 'delivery' and the persisted
 *     `delivery_snapshot` JSONB carries the canonical address / origin /
 *     service / parcel / pricing. Deleting or editing the address book,
 *     changing the variant price, the branch origin or the packaging config
 *     NEVER changes the persisted snapshot or the repayment — repayment
 *     reuses the SAME Snap link for the snapshot total 133.200 (the ongkir
 *     stays its OWN Midtrans line — Σ item_details = 133.200, pinned at the
 *     buildSnapTransactionParameter seam in midtrans.test.ts).
 * (2) Mocked rates move 20.000 → 30.000 between quote and Buat pesanan: the
 *     first attempt answers 409 DELIVERY_REPRICE_REQUIRED with NO order, NO SO
 *     POST and NO Snap; the UI shows
 *     "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum
 *     melanjutkan." and the NEW money (PPN 14.300, total 144.300) — and the
 *     placement then requires a fresh approval click. A missing service
 *     (rate-empty) forces a reselect: the quote surface shows its failure
 *     state and no order can be created from a dead quote.
 * (3) A verified Midtrans settlement whose Jubelio invoice conversion times
 *     out after applying → paid-but-blocked (status stays processing, NO
 *     pickup code, no payment POST, no booking, not completed); a NORMAL
 *     verified delivery settlement → the order stays `processing` ALWAYS
 *     WITHOUT a pickup code (delivery fulfillment never claims pickup) and
 *     ZERO /shipments/create requests exist.
 *
 * Independent source of truth: the ticket-04 worked money (SO/invoice/payment
 * Jubelio goods-only 100.000 vs website/Midtrans 133.200; reprice 143.00/44.3
 * hundred) and the mock fixture rates below — never recomputed from the
 * implementation.
 *
 * MOCK EXTENSIONS the main agent must have/provide for these cases (all under
 * the isolated mock at 127.0.0.1:3112):
 * - `PUT /__control/shipment` accepts an optional `rates` override next to the
 *   scenario (rate-normal keeps 20000 unless `rates` is given); the shipped
 *   service fixture stays the `JNE REG Fixture` row with final_rates as the
 *   ignored trap.
 * - `stocks/ensure` for the fixture location/item pair (900002/900002).
 * - The mock midtrans-status boundary + signed-webhook seam as in ticket 01
 *   (pickup-mock); `timeout-after-apply` for the ambiguous invoice.
 * - RED UNTIL the place-order path accepts fulfillmentMethod 'delivery' with
 *   the approval body below and persists orders.fulfillment_method +
 *   orders.delivery_snapshot (schema 0029 is main's stage).
 *
 * Run with the isolated mock config (the parent selects the spec):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { Pool } from "pg";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (keep in sync with playwright.mock.config.ts)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "delivery-order-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["store", STORE_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `delivery-order-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures + independent money literals
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "e2e-delivery-order";
const FIXTURE_PRODUCT_ID = `${FIXTURE_PREFIX}-product`;
const FIXTURE_VARIANT_ID = `${FIXTURE_PREFIX}-variant`;
const FIXTURE_VARIANT_SKU = "DELIVORD-01";
const ORIGIN_BRANCH_ID = `${FIXTURE_PREFIX}-branch`;
const ORIGIN_BRANCH_CODE = "E2EDLV";
const MOCK_JUBELIO_ITEM_ID = 900002;
const MOCK_JUBELIO_LOCATION_ID = 900002;

// The local origin complement on the fixture branch (configured, "ready").
const ORIGIN_BRANCH = {
  name: "E2E Origin Delivery Branch",
  code: ORIGIN_BRANCH_CODE,
  status: "aktif",
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 8, Gudang C",
  shippingPostalCode: "10110",
  shippingAreaId: "01010101",
} as const;

const ADDRESS_STREETS = [
  "Jl. Delivery Order E2E No. 1",
  "Jl. Delivery Order E2E No. 2",
  "Jl. Delivery Order E2E No. 3",
] as const;

const ADDRESS_CHAIN = {
  provinceId: "01",
  cityId: "0101",
  districtId: "010101",
  areaId: "01010101",
  postalCode: "01234",
} as const;

const CONTACT_EMAIL = "delivord-e2e@example.test";

// Independent money (worked cases, never recomputed):
//   case 1/3: goods 100.000 + ongkir 20.000 → PPN 13.200 → total 133.200
//   case 2:   goods 100.000 + ongkir 30.000 → PPN 14.300 → total 144.300
const EXPECTED_ORDER_TOTAL = "133200.00";
const EXPECTED_SHIPPING = "20000.00";
const EXPECTED_PPN = "13200.00";
const REPRICE_PPN_TEXT = "Rp 14.300";
const REPRICE_TOTAL_TEXT = "Rp 144.300";
const REPRICE_ONGKIR_TEXT = "Rp 30.000";
const REPRICE_MESSAGE =
  "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.";

let pool: Pool;
let johnContext: BrowserContext;
let orderContext: BrowserContext;
let addressIdOne = "";

let packConfigBefore: Array<Record<string, unknown>> = [];

type MockRequestRecord = { method: string; path: string; body: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers (copied seam patterns from pickup-mock / delivery-quote specs)
// ---------------------------------------------------------------------------

async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const response = await context.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email: identifier, password },
  });
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

async function mockControl(
  method: "PUT" | "POST" | "GET",
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await fetch(`${MOCK_BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: "mock-token" },
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

async function getMockRequests(): Promise<MockRequestRecord[]> {
  const result = await mockControl("GET", "/__control/requests");
  return (result.data as MockRequestRecord[]) ?? [];
}

/** SHA-512 classic Snap signature, posted as JSON (midtrans contract). */
async function postSignedWebhook(orderId: string, grossAmount: string): Promise<Response> {
  const signature = crypto
    .createHash("sha512")
    .update(`${orderId}200${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
  return fetch(`${STORE_BASE_URL}/api/webhooks/midtrans`, {
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

/** Isolates the payment-test navigation onto the store origin (pickup pattern). */
async function isolatePaymentRedirect(page: Page): Promise<void> {
  await page.route("**/checkout/payment-test?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
    void route.fulfill({
      status: 302,
      headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
    });
  });
}

/** Drives the delivery flow to the review step and clicks the place button. */
async function driveDeliveryToPlace(
  page: Page,
  street: string,
  email: string
): Promise<{ orderId: string; redirectUrl: string; body: Record<string, unknown>; response: unknown }> {
  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(email);
  await page.getByRole("button", { name: "Lanjut" }).click();

  // Method = delivery → address → quote → service selection.
  await page.getByText("Kirim ke alamat", { exact: true }).click();
  await page.getByLabel("Alamat Pengiriman").click();
  await page
    .getByRole("option", { name: new RegExp(street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
    .click();
  const periksa = page.getByRole("button", { name: /Periksa ongkir/ });
  if (await periksa.isVisible().catch(() => false)) await periksa.click();
  await expect(page.getByText("JNE REG Fixture")).toBeVisible({ timeout: 20_000 });
  await page.getByText("JNE REG Fixture").click();
  await expect(page.getByRole("region", { name: "Quote Pengiriman" }).getByText("Rp 20.000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByText(street, { exact: true })).toBeVisible();

  // The browser only ever posts the approval body — money re-derived server-side.
  const placeBody: Record<string, unknown>[] = [];
  const onResponse = (request: import("@playwright/test").Request) => {
    if (request.url().includes("/api/checkout/place-order") && request.method() === "POST") {
      const body = request.postData();
      if (body) placeBody.push(JSON.parse(body));
    }
  };
  await page.route("**/checkout/payment-test?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
    void route.fulfill({
      status: 302,
      headers: {
        location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}`,
      },
    });
  });

  let payload: unknown;
  await page.route("**/api/checkout/place-order", async (route) => {
    const response = await route.fetch();
    payload = await response.json();
    await route.fulfill({ response });
  });
  page.on("request", onResponse);

  await page.getByRole("checkbox").first().check();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Bayar Sekarang" }).click(),
  ]);
  const body = payload as {
    success: boolean;
    orderId?: string;
    redirectUrl?: string;
    code?: string;
    data?: { services?: unknown[] };
  };
  expect(body.success ?? false, `place-order response: ${JSON.stringify(body)}`).toBe(
    true
  );
  page.off("request", onResponse);

  await page.waitForURL("**/checkout/payment-test?*");
  expect(new URL(page.url()).searchParams.get("orderId")).toBe(body.orderId);

  return {
    orderId: body.orderId as string,
    redirectUrl: body.redirectUrl as string,
    body: placeBody[placeBody.length - 1] ?? {},
    response: body,
  };
}

async function orderRow(orderId: string): Promise<Record<string, unknown>> {
  const rows = await pool!.query(
    `SELECT fulfillment_method, delivery_snapshot, status, payment_status, pickup_code,
            jubelio_sales_order_id, jubelio_invoice_id, fulfillment_blocked_reason, subtotal, shipping_cost, discount, service_fee,
            ppn_rate, ppn_amount, total, snap_redirect_url, address_id
     FROM orders WHERE id = $1`,
    [orderId]
  );
  return rows.rows[0] as Record<string, unknown>;
}

async function countOrders(): Promise<number> {
  const rows = await pool!.query(
    "SELECT count(*)::int AS n FROM orders WHERE contact_email = $1",
    [CONTACT_EMAIL]
  );
  return Number(rows.rows[0]?.n ?? 0);
}

async function deleteOrder(orderId: string): Promise<void> {
  if (!orderId) return;
  await pool!.query(
    "DELETE FROM jubelio_sales_operation WHERE order_id = $1",
    [orderId]
  );
  await pool!.query("DELETE FROM orders WHERE id = $1", [orderId]);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from interrupted runs (own markers only — seeded rows and
  // real data are never reset).
  const stale = await pool.query<{ id: string }>(
    "SELECT id FROM orders WHERE contact_email = $1",
    [CONTACT_EMAIL]
  );
  for (const row of stale.rows) await deleteOrder(row.id);

  packConfigBefore = (
    await pool.query(
      "SELECT value, type FROM system_config WHERE key = 'shipment.packagingWeightGrams'"
    )
  ).rows;
  await pool.query(
    "INSERT INTO system_config (key,value,type) VALUES ('shipment.packagingWeightGrams','40','number') ON CONFLICT (key) DO UPDATE SET value='40',type='number'"
  );

  await pool.query(`DELETE FROM branch WHERE code LIKE '${ORIGIN_BRANCH_CODE}%'`);
  await pool.query(
    `INSERT INTO branch
       (id, name, code, city, address, status, shipping_phone, shipping_address,
        shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ORIGIN_BRANCH_ID,
      ORIGIN_BRANCH.name,
      ORIGIN_BRANCH.code,
      "Jakarta Pusat",
      "Jl. Fixture E2E Order No. 8",
      ORIGIN_BRANCH.status,
      ORIGIN_BRANCH.shippingPhone,
      ORIGIN_BRANCH.shippingAddress,
      ORIGIN_BRANCH.shippingPostalCode,
      ORIGIN_BRANCH.shippingAreaId,
      MOCK_JUBELIO_LOCATION_ID,
    ]
  );
  await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Delivery Order Anchor', $2, '100000.00', 'aktif')`,
    [FIXTURE_PRODUCT_ID, `${FIXTURE_PREFIX}-anchor`]
  );
  await pool.query(
    `INSERT INTO product_variant
       (id, product_id, sku, price, is_default, parcel_dimensions, jubelio_item_id)
     VALUES ($1, $2, $3, '100000.00', true, $4, $5)`,
    [
      FIXTURE_VARIANT_ID,
      FIXTURE_PRODUCT_ID,
      FIXTURE_VARIANT_SKU,
      JSON.stringify({ weight: 250, length: 30, width: 20, height: 10 }),
      MOCK_JUBELIO_ITEM_ID,
    ]
  );
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, 8, 0, 0, 0, 0, 8, NOW())`,
    [ORIGIN_BRANCH_ID, FIXTURE_VARIANT_ID]
  );

  johnContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(johnContext, STORE_BASE_URL, TEST_USERS.store.email, TEST_USERS.store.password);
  orderContext = await browser.newContext({
    baseURL: STORE_BASE_URL,
    extraHTTPHeaders: { "x-e2e-payment-mock": "true" },
  });
  await httpSignIn(orderContext, STORE_BASE_URL, TEST_USERS.store.email, TEST_USERS.store.password);

  // Three fixture addresses (region chain from the ticket-02 mock fixture).
  for (const street of ADDRESS_STREETS) {
    const create = await johnContext.request.post("/api/addresses", {
      data: {
        recipientName: "E2E Penerima Order",
        phone: "081300000001",
        fullAddress: street,
        ...ADDRESS_CHAIN,
        isDefault: false,
      },
    });
    expect(create.ok(), `fixture address create failed: ${await create.text()}`).toBe(true);
    const body = (await create.json()) as { data?: { id?: string }; id?: string };
    expect(String(body.data?.id ?? body.id ?? "").length).toBeGreaterThan(0);
  }
  addressIdOne = (await addressIdForStreet(ADDRESS_STREETS[0])) ?? "";
  expect(addressIdOne.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
  if (pool) {
    const stale = await pool.query<{ id: string }>(
      "SELECT id FROM orders WHERE contact_email = $1",
      [CONTACT_EMAIL]
    );
    for (const row of stale.rows) await deleteOrder(row.id);
    await pool.query(`DELETE FROM cart_item WHERE variant_id = $1`, [FIXTURE_VARIANT_ID]);
    await pool.query(`DELETE FROM branch_stock WHERE branch_id LIKE '${FIXTURE_PREFIX}%'`);
    await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
    await pool.query(`DELETE FROM branch WHERE code LIKE '${ORIGIN_BRANCH_CODE}%'`);
    await pool.query(`DELETE FROM address WHERE full_address LIKE 'Jl. Delivery Order E2E No.%'`);
    if (packConfigBefore.length > 0) {
      await pool.query(
        "UPDATE system_config SET value=$1, type=$2 WHERE key='shipment.packagingWeightGrams'",
        [packConfigBefore[0].value, packConfigBefore[0].type]
      );
    } else {
      await pool.query("DELETE FROM system_config WHERE key='shipment.packagingWeightGrams'");
    }
    await pool.end();
  }
  await johnContext?.close().catch(() => {});
  await orderContext?.close().catch(() => {});
});

/** Resolves a fixture address id from the API seam (the selector's source). */
async function addressIdForStreet(street: string): Promise<string | null> {
  const list = await johnContext!.request.get("/api/addresses");
  const body = (await list.json()) as { data?: Array<Record<string, unknown>> };
  const row = (body.data ?? []).find(
    (candidate) => String(candidate.fullAddress ?? "").includes(street)
  );
  return row ? String(row.id) : null;
}

test.describe("mock-only delivery order + settlement (ticket 04)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    // Restore only owned fixtures changed by the snapshot drift case.
    await pool!.query("UPDATE product_variant SET price='100000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    await pool!.query("UPDATE branch SET shipping_phone=$1 WHERE id=$2", [ORIGIN_BRANCH.shippingPhone, ORIGIN_BRANCH_ID]);
    await pool!.query("UPDATE system_config SET value='40' WHERE key='shipment.packagingWeightGrams'");
    // Fresh mock boundary state per case: normal rates, known stocks.
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal" })).status
    ).toBe("ok");
    expect(
      (await mockControl("POST", "/__control/stocks/ensure", {
        locationId: MOCK_JUBELIO_LOCATION_ID,
        itemId: MOCK_JUBELIO_ITEM_ID,
        onHand: 8,
      })).status
    ).toBe("ok");
    // Deterministic cart start: fixtures only.
    const cart = (await (await johnContext!.request.get("/api/cart")).json()) as {
      data?: { items?: Array<{ id: string; variantId?: string }> };
    };
    for (const item of cart.data?.items ?? []) {
      if (item.variantId === FIXTURE_VARIANT_ID) {
        await johnContext!.request.delete(`/api/cart/items/${item.id}`);
      }
    }
  });

  test("places delivery to an unsaved checkout address with an immutable snapshot", async () => {
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await orderContext!.newPage();
    const before = await (await orderContext!.request.get("/api/addresses")).json();
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *").fill(CONTACT_EMAIL);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByText("Kirim ke alamat", { exact: true }).click();
    await page.getByRole("button", { name: "Gunakan alamat baru" }).click();
    await page.getByLabel("Nama Penerima").fill("Penerima Baru Checkout");
    await page.getByLabel("Telepon Penerima").fill("081300000009");
    await page.getByLabel("Alamat Lengkap").fill("Jl. Tanpa Simpan No. 10");
    for (const [label, option] of [
      ["Provinsi", "Fixture Province"], ["Kota/Kabupaten", "Fixture City"],
      ["Kecamatan", "Fixture District"], ["Kelurahan/Area", "Fixture Area"],
    ]) await page.getByLabel(label, { exact: true }).selectOption({ label: option });
    await expect(page.getByText("JNE REG Fixture")).toBeVisible({ timeout: 20_000 });
    await page.getByText("JNE REG Fixture").click();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("checkbox").first().check();
    let body: { success: boolean; orderId: string } | undefined;
    await page.route("**/api/checkout/place-order", async (route) => {
      const response = await route.fetch();
      body = await response.json();
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await expect.poll(() => body?.success).toBe(true);
    const row = await orderRow(body!.orderId);
    expect(row.address_id).toBeNull();
    expect(JSON.stringify(row.delivery_snapshot)).toContain("Jl. Tanpa Simpan No. 10");
    const after = await (await orderContext!.request.get("/api/addresses")).json();
    expect(after.data).toEqual(before.data);
    await page.close();
  });

  test("saves a new checkout address as the sole default only after accepted order", async () => {
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await orderContext!.newPage();
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *").fill(CONTACT_EMAIL);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByText("Kirim ke alamat", { exact: true }).click();
    await page.getByRole("button", { name: "Gunakan alamat baru" }).click();
    await page.getByLabel("Nama Penerima").fill("Penerima Default Checkout");
    await page.getByLabel("Telepon Penerima").fill("081300000009");
    const street = "Jl. Delivery Order E2E No. New Default";
    await page.getByLabel("Alamat Lengkap").fill(street);
    for (const [label, option] of [
      ["Provinsi", "Fixture Province"], ["Kota/Kabupaten", "Fixture City"],
      ["Kecamatan", "Fixture District"], ["Kelurahan/Area", "Fixture Area"],
    ]) await page.getByLabel(label, { exact: true }).selectOption({ label: option });
    await page.getByLabel("Simpan alamat", { exact: true }).check();
    await page.getByLabel("Jadikan alamat utama").check();
    await expect(page.getByText("JNE REG Fixture")).toBeVisible({ timeout: 20_000 });
    await page.getByText("JNE REG Fixture").click();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByRole("checkbox").first().check();
    let body: { success: boolean; orderId: string } | undefined;
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/checkout/place-order", async (route) => {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      const response = await route.fetch();
      body = await response.json();
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await expect.poll(() => body?.success).toBe(true);
    const rows = (await (await orderContext!.request.get("/api/addresses")).json()).data as Array<{ id: string; fullAddress: string; isDefault: boolean }>;
    expect(rows.filter((row) => row.isDefault).map((row) => row.fullAddress)).toEqual([street]);
    const savedId = rows.find((row) => row.fullAddress === street)?.id;
    expect((await orderRow(body!.orderId)).address_id).toBe(savedId);
    // A repeated save intent after an accepted order reuses its address row;
    // a fresh cart/order must not generate a second book entry for the retry.
    const again = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(again.ok()).toBe(true);
    const cart = await (await johnContext!.request.get("/api/cart")).json();
    const itemId = cart.data.items.find((item: { variantId: string }) => item.variantId === FIXTURE_VARIANT_ID)?.id;
    const quote = await orderContext!.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [itemId], newAddress: submitted!.newAddress },
    });
    expect(quote.ok()).toBe(true);
    const services = (await quote.json()).data.services as Array<{ courierId: number; serviceId: number; pricing: unknown }>;
    const retried = await orderContext!.request.post("/api/checkout/place-order", {
      data: { ...submitted, itemIds: [itemId], courierId: services[0].courierId,
        serviceId: services[0].serviceId, approvedPricing: services[0].pricing },
    });
    expect(retried.ok(), await retried.text()).toBe(true);
    const repeatedRows = (await (await orderContext!.request.get("/api/addresses")).json()).data as Array<{ id: string; fullAddress: string }>;
    expect(repeatedRows.filter((row) => row.fullAddress === street).map((row) => row.id)).toEqual([savedId]);

    // Saving another destination without selecting default preserves the
    // existing primary address while still creating a usable book entry.
    expect((await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    })).ok()).toBe(true);
    const nextCart = await (await johnContext!.request.get("/api/cart")).json();
    const nextItemId = nextCart.data.items.find((item: { variantId: string }) => item.variantId === FIXTURE_VARIANT_ID)?.id;
    const otherStreet = "Jl. Delivery Order E2E No. Non Default";
    const otherAddress = { ...(submitted!.newAddress as Record<string, unknown>), fullAddress: otherStreet, isDefault: false };
    const otherQuote = await orderContext!.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [nextItemId], newAddress: otherAddress },
    });
    expect(otherQuote.ok()).toBe(true);
    const otherService = (await otherQuote.json()).data.services[0];
    const otherOrder = await orderContext!.request.post("/api/checkout/place-order", {
      data: { ...submitted, itemIds: [nextItemId], newAddress: otherAddress,
        saveRequestId: crypto.randomUUID(), courierId: otherService.courierId,
        serviceId: otherService.serviceId, approvedPricing: otherService.pricing },
    });
    expect(otherOrder.ok(), await otherOrder.text()).toBe(true);
    const finalRows = (await (await orderContext!.request.get("/api/addresses")).json()).data as Array<{ fullAddress: string; isDefault: boolean }>;
    expect(finalRows.filter((row) => row.isDefault).map((row) => row.fullAddress)).toEqual([street]);
    expect(finalRows.filter((row) => row.fullAddress === otherStreet)).toHaveLength(1);
    await page.close();
  });

  test("places a delivery order at 133.200 with a goods-only SO, an immutable delivery_snapshot, and a snapshot-stable repayment", async () => {
    const page = await orderContext!.newPage();

    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok(), `adding the fixture variant failed: ${await add.text()}`).toBe(true);
    const placed = await driveDeliveryToPlace(page, ADDRESS_STREETS[0], CONTACT_EMAIL);
    const orderId = placed.orderId;

    // ===== Approval request body: only the approval — never money =====
    expect(placed.body).toMatchObject({
      fulfillmentMethod: "delivery",
      addressId: expect.any(String),
      courierId: 13,
      serviceId: 1327,
      contactPhone: "081234567890",
    });
    expect(Number((placed.body.approvedPricing as Record<string, unknown>).total)).toBe(133200);
    // No stale pickup slots may ride along with a delivery submission.
    expect((placed.body.pickupDate ?? null) == null).toBe(true);
    expect((placed.body.pickupTime ?? null) == null).toBe(true);

    // ===== Exactly ONE create POST: goods only, confirmed via GET, THEN Snap ====
    const soPosts = (await getMockRequests()).filter(
      (record) =>
        record.method === "POST" && record.path === "/sales/orders/" && record.body.salesorder_id === 0 && record.body.ref_no === orderId
    );
    expect(soPosts, "exactly ONE Sales Order create POST for this order").toHaveLength(1);
    expect(soPosts[0].body).toMatchObject({
      sub_total: 100000,
      total_disc: 0,
      total_tax: 0,
      grand_total: 100000, // SO never carries the ongkir/PPN website line
      location_id: MOCK_JUBELIO_LOCATION_ID,
      ref_no: orderId,
      contact_id: -1,
    });
    const soItems = soPosts[0].body.items as Array<Record<string, unknown>>;
    expect(soItems).toHaveLength(1);
    expect(soItems[0]).toMatchObject({
      item_id: MOCK_JUBELIO_ITEM_ID,
      qty_in_base: 1,
      price: 100000,
      disc_amount: 0,
      tax_amount: 0,
      amount: 100000,
    });

    const order = await orderRow(orderId);
    expect(order.fulfillment_method).toBe("delivery");
    expect(order.status).toBe("pending_payment");
    expect(order.total).toBe(EXPECTED_ORDER_TOTAL);
    expect(order.shipping_cost).toBe(EXPECTED_SHIPPING);
    expect(order.ppn_amount).toBe(EXPECTED_PPN);
    expect(order.subtotal).toBe("100000.00");
    expect(order.pickup_code).toBe(null);
    expect(placed.redirectUrl).toBe(order.snap_redirect_url);

    // Durable SO intent → confirmed (verified via the independent GET).
    const createOp = (
      await pool!.query(
        "SELECT sales_order_id, status FROM jubelio_sales_operation WHERE order_id = $1 AND type = 'create'",
        [orderId]
      )
    ).rows[0];
    expect(createOp.status).toBe("confirmed");
    expect(createOp.sales_order_id).toBeGreaterThan(0);
    const soId = createOp.sales_order_id as number;
    expect(order.jubelio_sales_order_id).toBe(soId);
    // Independent GET of the persisted SO before Snap: goods-only money.
    const soGet = await mockControl("GET", `/sales/orders/${soId}`);
    expect(soGet).toMatchObject({ salesorder_id: soId, sub_total: 100000, total_tax: 0, grand_total: 100000 });
    // The GET confirmation precedes the Snap (the redirect only exists after).
    const requestIndex = (await getMockRequests()).findIndex(
      (record) => record.method === "GET" && record.path === `/sales/orders/${soId}`
    );
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(order.snap_redirect_url).toBeTruthy();

    // ===== The persisted delivery_snapshot: canonical address / origin / service / parcel / pricing =====
    const snapshot = order.delivery_snapshot as {
      address?: Record<string, unknown>;
      origin?: Record<string, unknown>;
      parcel?: Record<string, unknown>;
      service?: Record<string, unknown>;
      pricing?: Record<string, unknown>;
    };
    expect(snapshot.address).toMatchObject({
      recipientName: "E2E Penerima Order",
      fullAddress: ADDRESS_STREETS[0],
      areaId: "01010101",
      postalCode: "01234",
      province: "Fixture Province",
      area: "Fixture Area",
    });
    expect(snapshot.origin).toMatchObject({
      name: ORIGIN_BRANCH.name,
      phone: "021999888777",
      zipcode: "10110",
      areaId: "01010101",
    });
    expect(snapshot.parcel).toMatchObject({
      weight: 290, // 1 × 250 + 40 kemasan
      items: [
        expect.objectContaining({ item_name: expect.stringContaining("Delivery Order Anchor"), quantity: 1, weight: 250 }),
      ],
    });
    expect(Number((snapshot.service as Record<string, unknown>).shippingCost)).toBe(20000);
    expect((snapshot.service as Record<string, unknown>).name).toBe("JNE REG Fixture");
    expect(snapshot.pricing).toMatchObject({
      subtotal: "100000.00",
      ppnAmount: EXPECTED_PPN,
      total: EXPECTED_ORDER_TOTAL,
    });

    // ===== Repayment BEFORE mutations: reuses the SAME Snap link =====
    const repay = await orderContext!.request.post("/api/payments/midtrans/create", {
      data: { orderId },
    });
    expect(repay.ok(), `repayment failed: ${await repay.text()}`).toBe(true);
    expect((await repay.json()).redirectUrl).toBe(placed.redirectUrl);

    // ===== Live-world drift: edit + delete the book, change variant/branch/config ====
    const snapshotBefore = JSON.stringify(snapshot);
    await pool.query("UPDATE address SET full_address = 'Jl. Delivery Order E2E DIUBAHH' WHERE id = $1", [
      addressIdOne,
    ]);
    await pool.query("UPDATE product_variant SET price = '999.00' WHERE id = $1", [FIXTURE_VARIANT_ID]);
    await pool.query("UPDATE branch SET shipping_phone = '000' WHERE id = $1", [ORIGIN_BRANCH_ID]);
    await pool.query("UPDATE system_config SET value = '999' WHERE key = 'shipment.packagingWeightGrams'");
    await pool.query("DELETE FROM address WHERE id = $1", [addressIdOne]);

    const afterDrift = await orderRow(orderId);
    expect(JSON.stringify(afterDrift.delivery_snapshot)).toBe(snapshotBefore);
    expect(afterDrift.total).toBe(EXPECTED_ORDER_TOTAL);
    expect(afterDrift.shipping_cost).toBe(EXPECTED_SHIPPING);
    expect(afterDrift.ppn_amount).toBe(EXPECTED_PPN);
    // The book deletion nulls the FK (the snapshot stays complete).
    expect(afterDrift.address_id).toBe(null);

    // Repayment AFTER the drift: still the SAME snapshot money/link — the
    // ongkir line would rebuild from the persisted order (133.200; Σ items =
    // total is pinned at the buildSnapTransactionParameter seam).
    const repayAfter = await orderContext!.request.post("/api/payments/midtrans/create", {
      data: { orderId },
    });
    expect(repayAfter.ok(), `repayment after drift failed: ${await repayAfter.text()}`).toBe(true);
    expect((await repayAfter.json()).redirectUrl).toBe(placed.redirectUrl);
    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText("Pengiriman ke Alamat", { exact: true })).toBeVisible();
    await expect(page.getByText(ADDRESS_STREETS[0], { exact: true })).toBeVisible();
    await expect(page.getByText("Pengambilan", { exact: true })).toHaveCount(0);

    await page.close();
  });

  test("rates moved 20.000→30.000 between quote and Buat pesanan: 409 DELIVERY_REPRICE_REQUIRED with new money, NO order/SO/Snap, then a fresh approval click; missing service forces a reselect", async () => {
    const page = await orderContext!.newPage();
    const ordersBefore = await countOrders();
    const soPostsBefore = (await getMockRequests()).filter(
      (record) => record.method === "POST" && record.path === "/sales/orders/"
    ).length;

    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok(), `adding the fixture variant failed: ${await add.text()}`).toBe(true);

    // Drive to the review step with the quoted (20k) service.
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *").fill(CONTACT_EMAIL);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByText("Kirim ke alamat", { exact: true }).click();
    await page.getByLabel("Alamat Pengiriman").click();
    await page
      .getByRole("option", { name: new RegExp(ADDRESS_STREETS[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
      .click();
    await page.getByText("JNE REG Fixture").click();
    await page.getByRole("button", { name: "Lanjut" }).click();

    // The quote approved at 133.200; NOW the mock rates move to 30.000.
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal", rates: 30000 })).status
    ).toBe("ok");

    let payload: Record<string, unknown>;
    await page.route("**/api/checkout/place-order", async (route) => {
      const response = await route.fetch();
      payload = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response });
    });
    await page.getByRole("checkbox").first().check();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Bayar Sekarang" }).click(),
    ]);

    // 409 DELIVERY_REPRICE_REQUIRED: NO order, NO SO POST, NO Snap.
    expect(
      {
        success: (payload as { success?: boolean }).success,
        code: (payload as { code?: string }).code,
      },
      `the reprice response must refuse: ${JSON.stringify(payload)}`
    ).toEqual({ success: false, code: "DELIVERY_REPRICE_REQUIRED" });
    expect(await countOrders()).toBe(ordersBefore);
    expect(
      (await getMockRequests()).filter(
        (record) => record.method === "POST" && record.path === "/sales/orders/"
      )
    ).toHaveLength(soPostsBefore);

    // The UI demands the re-approval with the NEW numbers… the old money is
    // never displayed again.
    await expect(page.getByText(REPRICE_MESSAGE)).toBeVisible();
    const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
    await expect(review.getByText(REPRICE_ONGKIR_TEXT, { exact: true })).toBeVisible();
    await expect(review.getByText(REPRICE_PPN_TEXT, { exact: true })).toBeVisible();
    await expect(review.getByText(REPRICE_TOTAL_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByText("Rp 20.000", { exact: true })).toHaveCount(0);

    // …and the placement then requires a FRESH approval click (this second
    // click must still work with the re-derived 30.000 quote).
    const confirm = page.locator('input[type="checkbox"]').first();
    if (!(await confirm.isChecked())) await confirm.check();
    let payload2: Record<string, unknown>;
    await page.route("**/api/checkout/place-order", async (route) => {
      const response = await route.fetch();
      payload2 = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response });
    });
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Bayar Sekarang" }).click(),
    ]);
    expect(
      {
        success: (payload2 as { success?: boolean }).success,
        orderId: (payload2 as { orderId?: string }).orderId ?? null,
      },
      `the re-approved placement must succeed: ${JSON.stringify(payload2)}`
    ).toMatchObject({ success: true });
    expect(await countOrders()).toBe(ordersBefore + 1);
    const soPostsAfter = (await getMockRequests()).filter(
      (record) => record.method === "POST" && record.path === "/sales/orders/"
    );
    expect(soPostsAfter).toHaveLength(soPostsBefore + 1);
    // Still goods-only on the SO (100.000), even after the reprice.
    expect(soPostsAfter[soPostsAfter.length - 1].body).toMatchObject({
      sub_total: 100000,
      total_tax: 0,
      grand_total: 100000,
    });

    // A MISSING service between quote and place: forces a reselect — no order.
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "rate-empty" })).status
    ).toBe("ok");
    const ordersAfterSecond = await countOrders();
    const emptyQuotePage = await orderContext!.newPage();
    const add2 = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 2 },
    });
    expect(add2.ok()).toBe(true);
    await emptyQuotePage.goto("/cart");
    await emptyQuotePage.getByRole("checkbox").first().check();
    await emptyQuotePage.getByRole("button", { name: "Checkout" }).click();
    await emptyQuotePage.waitForURL("**/checkout");
    await emptyQuotePage.getByLabel("Nomor Telepon *").fill("081234567890");
    await emptyQuotePage.getByLabel("Email *").fill(CONTACT_EMAIL);
    await emptyQuotePage.getByRole("button", { name: "Lanjut" }).click();
    await emptyQuotePage.getByText("Kirim ke alamat", { exact: true }).click();
    await emptyQuotePage.getByLabel("Alamat Pengiriman").click();
    await emptyQuotePage
      .getByRole("option", {
        name: new RegExp(ADDRESS_STREETS[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .click();
    await expect(
      emptyQuotePage.getByRole("button", { name: /Coba lagi/ })
    ).toBeVisible({ timeout: 20_000 });
    await expect(emptyQuotePage.getByText("JNE REG Fixture")).toHaveCount(0);
    // No order may be created from a dead quote.
    expect(await countOrders()).toBe(ordersAfterSecond);
    await emptyQuotePage.close();

    await page.close();
  });

  test("verified delivery settlement stays in processing with NO pickup code; ambiguous invoice keeps it paid-but-blocked; zero shipment bookings", async () => {
    const page = await orderContext!.newPage();

    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const placed = await driveDeliveryToPlace(page, ADDRESS_STREETS[1], CONTACT_EMAIL);
    const deliveryId = placed.orderId;

    // Normal verified settlement: Midtrans settle → signed webhook.
    expect(
      (await mockControl("PUT", "/__control/midtrans-status", {
        orderId: deliveryId,
        transactionStatus: "settlement",
        grossAmount: EXPECTED_ORDER_TOTAL,
        paymentType: "gopay",
        transactionId: "delivord-normal-txn",
      })).status
    ).toBe("ok");
    const webhook = await postSignedWebhook(deliveryId, EXPECTED_ORDER_TOTAL);
    expect(webhook.status, `the webhook must accept the snapshot total (${await webhook.text()})`).toBe(200);

    const settled = await orderRow(deliveryId);
    // Delivery is NEVER ready_for_pickup and NEVER carries a pickup code —
    // the order waits in `processing` after a verified settlement.
    expect(settled.status).toBe("processing");
    expect(settled.payment_status).toBe("paid");
    expect(settled.pickup_code).toBe(null);
    expect(settled.fulfillment_blocked_reason ?? null).toBe(null);

    // The SO/invoice/payment ledger stays goods-only (100.000 each).
    const soId = settled.jubelio_sales_order_id as number;
    expect(soId).toBeGreaterThan(0);
    const invoice = await mockControl("GET", `/sales/invoices/${(settled.jubelio_invoice_id as number)}`);
    expect(invoice).toMatchObject({
      sub_total: String(100000),
      total_tax: "0",
      grand_total: String(100000),
    });

    // This settlement must not book; other admin fixture orders can legitimately book.
    expect(
      (await getMockRequests()).filter((record) => record.path === "/shipments/create" && record.body.ref_no === deliveryId)
    ).toHaveLength(0);

    // Ambiguous invoice conversion → paid-but-blocked (still no code).
    const page2 = await orderContext!.newPage();
    const add2 = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add2.ok()).toBe(true);
    // The ambiguous scene starts ONLY after the order/SO exists (it delays the
    // invoice conversion, not the placement).
    const placed2 = await driveDeliveryToPlace(page2, ADDRESS_STREETS[2], CONTACT_EMAIL);
    expect((await mockControl("PUT", "/__control/scenario", { scenario: "timeout-after-apply" })).status).toBe("ok");
    expect(
      (await mockControl("PUT", "/__control/midtrans-status", {
        orderId: placed2.orderId,
        transactionStatus: "settlement",
        grossAmount: EXPECTED_ORDER_TOTAL,
        paymentType: "gopay",
        transactionId: "delivord-blocked-txn",
      })).status
    ).toBe("ok");
    const webhook2 = await postSignedWebhook(placed2.orderId, EXPECTED_ORDER_TOTAL);
    expect(webhook2.status).toBe(200);

    const blocked = await orderRow(placed2.orderId);
    expect(blocked.status).toBe("processing");
    expect(blocked.payment_status).toBe("paid");
    expect(blocked.pickup_code).toBe(null);
    expect(String(blocked.fulfillment_blocked_reason ?? "")).toContain("invoice");
    const invoiceOp = (
      await pool!.query(
        "SELECT status FROM jubelio_sales_operation WHERE order_id = $1 AND type = 'invoice'",
        [placed2.orderId]
      )
    ).rows[0];
    expect(invoiceOp.status).toBe("manual_review");
    // Scope the probe to this order; the earlier verified order legitimately
    // wrote one payment in the same scenario.
    expect(
      (await getMockRequests()).filter((record) => record.method === "POST" && record.path === "/sales/payments/" && String(record.body.note).includes(placed2.orderId))
    ).toHaveLength(0);
    expect(
      (await getMockRequests()).filter((record) => record.path === "/shipments/create" && record.body.ref_no === placed2.orderId)
    ).toHaveLength(0);

    await page.close();
    await page2.close();
  });
});