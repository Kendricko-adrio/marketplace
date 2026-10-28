import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { deleteRetainedOrderFixtures, deleteUnpromotedCheckoutAttempts } from "../../packages/db/src/testing/retained-order-fixtures";
import { TEST_USERS } from "../config";

// Setup SQL hanya pada DB disposable; semua assertion aplikasi lewat HTTP/UI.
const productId = "e2e-versioned-checkout-product";
const variantId = "e2e-versioned-checkout-variant";
const storeUrl = process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const adminUrl = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
let pool: Pool;
let context: BrowserContext;
let branchId: string;
let previousGate: Array<{ value: string; type: string; description: string | null }> = [];
const mockUrl = process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const contactEmail = "versioned-checkout@example.test";

// --- v1 delivery fixture (own rows only; seeded branches stay origin-NULL) ---
const deliveryContactEmail = "versioned-checkout-delivery@example.test";
const deliveryOriginBranchId = "e2e-versioned-checkout-origin";
const deliveryOriginBranchCode = "E2EVCO";
const deliveryLocationId = 920002;
const deliveryStreet = "Jl. Versioned Delivery E2E No. 1";
let deliveryAddressId = "";
let packagingBefore: Array<{ value: string; type: string; description: string | null }> = [];
// Delivery memakai email AKUN (read-only di checkout) → ikut dibersihkan.
const contactEmails = [contactEmail, deliveryContactEmail, TEST_USERS.store.email];

// This delivery order is placed from a SYNTHETIC origin branch, i.e. never the
// Home Branch the seeder pins on both seeded admin users (branchIds[0], see
// packages/db/src/seed.ts). Reading it therefore needs an all-branch persona:
// the seeded HQ Role identity (`orders:view all_branches`), not the own-branch
// `admintoko` used as TEST_USERS.admin. Same convention as
// e2e/admin/branch-origin-mock.spec.ts.
const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

async function cleanupOrders() {
  const ids = (await pool.query("SELECT id FROM orders WHERE contact_email=ANY($1::text[])", [contactEmails])).rows.map((row) => row.id);
  const owners = (await pool.query("SELECT id FROM client WHERE email=ANY($1::text[])", [contactEmails])).rows.map((row: { id: string }) => row.id);
  await deleteUnpromotedCheckoutAttempts(pool, owners);
  if (!ids.length) return;
  // FK-ordered teardown helper; only this spec's own fixture order IDs.
  await deleteRetainedOrderFixtures(pool, ids);
}

/**
 * Signs in over the public Better Auth HTTP seam.
 *
 * The two instances accept different credential shapes: store clients sign in
 * with their email (`/sign-in/email` + `{email,password}`), while the admin
 * instance's `TEST_USERS.admin.identifier` is a username (`admintoko`, see
 * e2e/config.ts), which `/sign-in/email` rejects with INVALID_EMAIL. Mirror the
 * proven helper in e2e/store/pickup-mock.spec.ts: pick the endpoint and body
 * from whether the identifier contains "@".
 */
async function signIn(target: BrowserContext, base: string, identifier: string, password: string) {
  const isEmail = identifier.includes("@");
  const response = await target.request.post(`${base}/api/auth/sign-in/${isEmail ? "email" : "username"}`, {
    data: isEmail ? { email: identifier, password } : { username: identifier, password },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function mockControl(path: string, data?: unknown, method?: "POST" | "PUT") {
  const response = await context.request.fetch(`${mockUrl}${path}`, {
    method: method ?? (data ? "POST" : "GET"), data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

type PlacedOrderCapture = {
  status: number;
  ok: boolean;
  /** Untouched body the real app returned, drained before it is released. */
  text: string;
  submitted: Record<string, unknown>;
};

const PLACE_ORDER_ROUTE = "**/api/checkout/place-order";
const PLACE_ORDER_CAPTURE_TIMEOUT_MS = 20_000;

/**
 * Observe the REAL place-order response without racing the Snap navigation.
 *
 * Root cause of the former protocol error: the checkout page runs
 * `window.location.href = data.redirectUrl` as soon as its fetch resolves, so a
 * response-event observer only gets a chance to read the body once the
 * cross-origin Snap fixture document has committed; the previous document's
 * resources are already gone and `response.text()` fails inside the browser with
 *   Protocol error (Network.getResponseBody): No resource with given identifier found
 * Polling/timing around that event cannot be made reliable.
 *
 * Deterministic alternative: intercept the request, let `route.fetch()` perform
 * the original HTTP call exactly once (`maxRetries: 0`), read the real body, and
 * only then release it with `route.fulfill({ response })` — the untouched status,
 * headers and body. The response is therefore fully materialized in Playwright
 * before the browser can navigate. Nothing is stubbed, mocked or fabricated: the
 * real UI click, the real app route handler, the real provider calls and the real
 * Snap redirect all stay; this is transparent forwarding, not a fake.
 *
 * Register the returned observer BEFORE the click, then await `captured`.
 */
async function observePlacedOrder(page: Page): Promise<{ captured: Promise<PlacedOrderCapture> }> {
  let settle!: (capture: PlacedOrderCapture) => void;
  let fail!: (error: Error) => void;
  const recorded = new Promise<PlacedOrderCapture>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Exactly one matching placement is expected; a second one is a product bug
  // and must surface instead of silently creating another order.
  let matched = 0;

  await page.route(PLACE_ORDER_ROUTE, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    matched += 1;
    if (matched > 1) {
      // Fail closed: never re-POST inside the harness and never let an
      // unexpected duplicate reach the app a second time.
      fail(new Error(`place-order was POSTed ${matched} times; expected exactly one placement`));
      await route.abort("failed").catch(() => {});
      return;
    }
    try {
      // ONE real HTTP request to the real app (maxRetries: 0 → no retry layer).
      const response = await route.fetch({ maxRetries: 0, timeout: PLACE_ORDER_CAPTURE_TIMEOUT_MS });
      // Drain the body while Playwright still owns the response, i.e. before the
      // browser is released and free to navigate away.
      const text = await response.text();
      const submitted = route.request().postDataJSON() as Record<string, unknown>;
      settle({ status: response.status(), ok: response.ok(), text, submitted });
      // Transparent forwarding of the real response, unmodified.
      await route.fulfill({ response });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      // Release the page instead of hanging the route; a second fetch here would
      // be a duplicate POST, which is never allowed.
      await route.abort("failed").catch(() => {});
    }
  });

  // Bound the wait so a placement that never arrives fails loudly, not by
  // hanging the run. The route handler keeps its own fetch timeout above.
  const captured = new Promise<PlacedOrderCapture>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no POST ${PLACE_ORDER_ROUTE} was observed within ${PLACE_ORDER_CAPTURE_TIMEOUT_MS}ms`)),
      PLACE_ORDER_CAPTURE_TIMEOUT_MS
    );
    recorded.then(
      (capture) => {
        clearTimeout(timer);
        resolve(capture);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

  return { captured };
}

function nextOpenDate(): string {
  const date = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test.beforeAll(async ({ browser }) => {
  if (process.env.E2E_PROVIDER_MOCKS !== "true" || !process.env.DATABASE_URL) {
    throw new Error("versioned checkout requires isolated mock config and explicit disposable DATABASE_URL");
  }
  const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
  if (!database.startsWith("marketplace_discounts_test_")) {
    throw new Error("versioned checkout refuses a non-disposable database");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  previousGate = (await pool.query("SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'")).rows;
  await pool.query(`INSERT INTO system_config (key,value,type,description) VALUES ('discounts.contractVersion','1','number','Disposable E2E fixture') ON CONFLICT (key) DO UPDATE SET value='1'`);
  branchId = (await pool.query(`SELECT b.id FROM branch b JOIN "user" u ON u.branch_id=b.id WHERE u.username=$1 AND b.status='aktif' AND b.jubelio_location_id IS NOT NULL`, [TEST_USERS.admin.identifier])).rows[0]?.id;
  expect(branchId).toBeTruthy();
  await cleanupOrders();
  await pool.query("DELETE FROM cart_item WHERE variant_id=$1", [variantId]);
  await pool.query("DELETE FROM product WHERE id=$1", [productId]);
  await pool.query(`INSERT INTO product (id,name,slug,base_price,status) VALUES ($1,'Versioned Checkout Anchor','versioned-checkout-anchor','150000.00','aktif')`, [productId]);
  await pool.query(`INSERT INTO product_variant (id,product_id,sku,price,is_default,parcel_dimensions,jubelio_item_id) VALUES ($1,$2,'VERSIONED-01','150000.00',true,$3,920001)`, [variantId, productId, JSON.stringify({ weight: 250, length: 30, width: 20, height: 10 })]);
  await pool.query(`INSERT INTO branch_stock (branch_id,product_variant_id,stock,reserved_stock,pending_remote_stock,on_order_stock,provider_reserved_stock,available_stock,provider_stock_synced_at) VALUES ($1,$2,5,0,0,0,0,5,NOW())`, [branchId, variantId]);

  // v1 delivery needs its OWN configured origin (the seeded branches stay
  // origin-NULL by design) plus the packaging weight the parcel builder reads.
  packagingBefore = (await pool.query("SELECT value, type, description FROM system_config WHERE key='shipment.packagingWeightGrams'")).rows;
  await pool.query(`INSERT INTO system_config (key,value,type) VALUES ('shipment.packagingWeightGrams','40','number') ON CONFLICT (key) DO UPDATE SET value='40',type='number'`);
  await pool.query("DELETE FROM address WHERE full_address=$1", [deliveryStreet]);
  await pool.query("DELETE FROM branch_stock WHERE branch_id=$1", [deliveryOriginBranchId]);
  await pool.query("DELETE FROM branch WHERE id=$1", [deliveryOriginBranchId]);
  await pool.query(
    `INSERT INTO branch
       (id,name,code,city,address,status,shipping_phone,shipping_address,
        shipping_postal_code,shipping_area_id,jubelio_location_id)
     VALUES ($1,'E2E Versioned Delivery Origin',$2,'Jakarta Pusat',$3,'aktif',$4,$5,$6,$7,$8)`,
    [deliveryOriginBranchId, deliveryOriginBranchCode, "Jl. Versioned Origin E2E No. 4",
      "021999888777", "Jl. Versioned Origin E2E No. 4, Gudang D", "01234", "01010101", deliveryLocationId]
  );
  await pool.query("UPDATE branch SET shipping_province_id='01', shipping_city_id='0101', shipping_district_id='010101', shipping_province='Fixture Province', shipping_city='Fixture City', shipping_district='Fixture District', shipping_area='Fixture Area' WHERE id=$1", [deliveryOriginBranchId]);
  await pool.query(`INSERT INTO branch_stock (branch_id,product_variant_id,stock,reserved_stock,pending_remote_stock,on_order_stock,provider_reserved_stock,available_stock,provider_stock_synced_at) VALUES ($1,$2,5,0,0,0,0,5,NOW())`, [deliveryOriginBranchId, variantId]);

  // No synthetic payment shortcut: future payment assertions must capture the
  // real createPayment payload at the controlled loopback provider boundary.
  context = await browser.newContext({ baseURL: storeUrl, extraHTTPHeaders: {} });
  const auth = await context.request.post("/api/auth/sign-in/email", { data: { email: TEST_USERS.store.email, password: TEST_USERS.store.password } });
  expect(auth.ok(), await auth.text()).toBe(true);
  const cart = await context.request.get("/api/cart");
  for (const item of (await cart.json()).data?.items ?? []) {
    await context.request.delete(`/api/cart/items/${item.id}`);
  }

  // Destination book entry for the delivery slice (server-verified region chain).
  const address = await context.request.post("/api/addresses", { data: {
    recipientName: "Penerima Versioned Delivery", phone: "081300000021",
    fullAddress: deliveryStreet, provinceId: "01", cityId: "0101",
    districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: false,
  } });
  expect(address.ok(), await address.text()).toBe(true);
  const addressBody = await address.json();
  deliveryAddressId = String(addressBody.data?.id ?? addressBody.id ?? "");
  expect(deliveryAddressId.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await context?.close();
  if (!pool) return;
  await cleanupOrders();
  await pool.query("DELETE FROM cart_item WHERE variant_id=$1", [variantId]);
  await pool.query("DELETE FROM address WHERE full_address=$1", [deliveryStreet]);
  await pool.query("DELETE FROM branch_stock WHERE branch_id=$1", [deliveryOriginBranchId]);
  await pool.query("DELETE FROM product WHERE id=$1", [productId]);
  await pool.query("DELETE FROM branch WHERE id=$1", [deliveryOriginBranchId]);
  if (packagingBefore.length) {
    const row = packagingBefore[0];
    await pool.query("UPDATE system_config SET value=$1,type=$2,description=$3 WHERE key='shipment.packagingWeightGrams'", [row.value, row.type, row.description]);
  } else {
    await pool.query("DELETE FROM system_config WHERE key='shipment.packagingWeightGrams'");
  }
  if (previousGate.length) {
    const row = previousGate[0];
    await pool.query("UPDATE system_config SET value=$1,type=$2,description=$3 WHERE key='discounts.contractVersion'", [row.value, row.type, row.description]);
  } else {
    await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
  }
  await pool.end();
});

test("gate1 pickup review uses the versioned goods-only tax contract without a service charge", async () => {
  await mockControl("/__control/reset", {});
  const reviewLocationId = (await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [branchId])).rows[0].jubelio_location_id;
  await mockControl("/__control/stocks/ensure", { locationId: reviewLocationId, itemId: 920001, onHand: 5 });
  const added = await context.request.post("/api/cart/items", { data: { variantId, branchId, quantity: 1 } });
  expect(added.ok(), await added.text()).toBe(true);
  const response = await context.request.get("/api/cart");
  expect(response.ok()).toBe(true);
  const cart = (await response.json()).data;
  // This intentionally fails on the legacy cart, before any provider activity.
  expect(cart.pricingContractVersion).toBe(1);
  expect(cart.subtotal).toBe(150000);
  expect(cart.ppnRatePercent).toBe(11);
  const page = await context.newPage();
  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00" }).click();
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill("versioned-checkout@example.test");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
  await expect(page.getByText("Rp 166.500", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Biaya (Layanan|layanan)/)).toHaveCount(0);
  await page.close();
});

test("checkout rejects bounded and unknown request inputs before any provider activity", async () => {
  await mockControl("/__control/reset", {});
  await context.request.delete("/api/cart");
  expect((await context.request.post("/api/cart/items", { data: { variantId, branchId, quantity: 1 } })).ok()).toBe(true);
  const cart = (await (await context.request.get("/api/cart")).json()).data;
  const itemId = cart.items[0].id;
  const body = { phone: "081234567890", email: contactEmail, pickupDate: nextOpenDate(), pickupTime: "10:00", selectedItemIds: [itemId] };
  for (const invalid of [
    { ...body, selectedItemIds: [itemId, itemId] },
    { ...body, selectedItemIds: ["x".repeat(129)] },
    { ...body, selectedItemIds: Array.from({ length: 51 }, (_, i) => `item-${i}`) },
    { ...body, promoCode: "NOT-ACCEPTED-BY-BASELINE" },
  ]) {
    const response = await context.request.post("/api/checkout/place-order", { data: invalid });
    expect(response.status(), await response.text()).toBe(400);
  }
  const oversized = await context.request.post("/api/checkout/place-order", {
    data: JSON.stringify({ ...body, extra: "x".repeat(256 * 1024) }),
    headers: { "content-type": "application/json" },
  });
  expect(oversized.status()).toBe(413);
  const captured = (await mockControl("/__control/requests")).data;
  expect(captured.filter((entry: { path: string }) => !entry.path.startsWith("/__control/"))).toEqual([]);
});

test("gate1 pickup persists immutable pricing through real Snap creation, detail and repayment", async () => {
  await mockControl("/__control/reset", {});
  const locationId = (await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [branchId])).rows[0].jubelio_location_id;
  await mockControl("/__control/stocks/ensure", { locationId, itemId: 920001, onHand: 5 });
  await context.request.delete("/api/cart");
  expect((await context.request.post("/api/cart/items", { data: { variantId, branchId, quantity: 1 } })).ok()).toBe(true);
  const page = await context.newPage();
  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00" }).click();
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(contactEmail);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByText(/Saya telah memeriksa pesanan/).click();
  // Register the passthrough observer BEFORE the click: the real response is
  // captured before it is released, so the Snap navigation cannot outrun it.
  const observer = await observePlacedOrder(page);
  await page.getByRole("button", { name: /Bayar/ }).click();
  const placed = await observer.captured;
  expect(placed.ok, placed.text).toBe(true);
  const result = JSON.parse(placed.text) as { orderId: string; redirectUrl: string };
  await expect(page.getByRole("heading", { name: "Pembayaran fixture" })).toBeVisible();
  const detailResponse = await context.request.get(`/api/orders/${result.orderId}`);
  expect(detailResponse.ok()).toBe(true);
  const detail = (await detailResponse.json()).data;
  expect(detail).toMatchObject({ pricingContractVersion: 1, pricingEngineVersion: 1, providerContractVersion: 3 });
  expect(detail.pricingSnapshot).toMatchObject({
    sourceGoodsSubtotal: "150000", subtotal: "150000", netGoods: "150000",
    ppnRatePercent: "11", taxableBase: "150000", ppnAmount: "16500", serviceFee: "0",
    shippingBeforeSubsidy: "0", shippingCost: "0", total: "166500", expectedProviderPayable: "166500",
    providerTax: { taxId: -2, ratePercent: "11" },
  });
  // Kontrak3: PPN barang menjadi bagian payable provider, tanpa tagihan kedua.
  expect(detail.pricingSnapshot.lines).toEqual([
    expect.objectContaining({ netLineAmount: "150000", providerTaxAmount: "16500" }),
  ]);
  const captures = (await mockControl("/__control/requests")).data;
  const snaps = captures.filter((record: { path: string }) => record.path === "/snap/v1/transactions");
  expect(snaps).toHaveLength(1);
  expect(snaps[0].body.transaction_details).toEqual({ order_id: result.orderId, gross_amount: 166500 });
  expect(snaps[0].body.item_details).toEqual([
    { id: variantId, name: "Versioned Checkout Anchor", price: 150000, quantity: 1 },
    { id: "PPN", name: "PPN 11%", price: 16500, quantity: 1 },
  ]);
  const so = captures.find((record: { path: string; method: string }) => record.path === "/sales/orders/" && record.method === "POST");
  expect(so.body).toMatchObject({
    original_shipment_cost: 0, shipping_cost: 0, total_tax: 16500, grand_total: 166500,
  });
  expect(so.body.items).toEqual([
    expect.objectContaining({ item_id: 920001, tax_id: -2, tax_amount: 16500, amount: 166500 }),
  ]);
  const taxBefore = (await pool.query("SELECT value FROM system_config WHERE key='tax.ppnRatePercent'")).rows[0].value;
  try {
    await pool.query("UPDATE product_variant SET price='990000.00' WHERE id=$1", [variantId]);
    await pool.query("UPDATE system_config SET value='25' WHERE key='tax.ppnRatePercent'");
    const frozenResponse = await context.request.get(`/api/orders/${result.orderId}`);
    expect(frozenResponse.ok()).toBe(true);
    const frozen = (await frozenResponse.json()).data;
    expect(frozen.pricingSnapshot).toEqual(detail.pricingSnapshot);
    expect(frozen.expiresAt).toBe(detail.expiresAt);
    const repayment = await context.request.post("/api/payments/midtrans/create", { data: { orderId: result.orderId } });
    expect(repayment.ok(), await repayment.text()).toBe(true);
    expect((await repayment.json()).redirectUrl).toBe(result.redirectUrl);
    const afterRepayment = (await (await context.request.get(`/api/orders/${result.orderId}`)).json()).data;
    expect(afterRepayment.expiresAt).toBe(detail.expiresAt);
    await page.goto(`${storeUrl}/account/orders/${result.orderId}`);
    await expect(page.getByText("Rp 166.500", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Biaya (Layanan|layanan)/)).toHaveCount(0);
  } finally {
    await pool.query("UPDATE product_variant SET price='150000.00' WHERE id=$1", [variantId]);
    await pool.query("UPDATE system_config SET value=$1 WHERE key='tax.ppnRatePercent'", [taxBefore]);
    await page.close();
  }
});

test("gate1 delivery keeps PPN on goods only and the provider payable on net goods plus net shipping through quote, Snap, detail, admin detail and repayment", async ({ browser }) => {
  // Independent worked money (never recomputed from the implementation):
  //   goods 150.000 + ongkir 30.000, PPN 11% atas net barang saja = 16.500
  //   → customer 196.500 = provider (SO/invoice/payment) 196.500, fee 0.
  //   (Kontrak provider3: PPN barang ikut tercatat pada dokumen provider.)
  test.setTimeout(120_000);
  await mockControl("/__control/reset", {});
  expect((await mockControl("/__control/shipment", { scenario: "rate-normal", rates: 30000 }, "PUT")).status).toBe("ok");
  expect((await mockControl("/__control/stocks/ensure", { locationId: deliveryLocationId, itemId: 920001, onHand: 5 })).status).toBe("ok");
  await context.request.delete("/api/cart");
  expect((await context.request.post("/api/cart/items", { data: { variantId, branchId: deliveryOriginBranchId, quantity: 1 } })).ok()).toBe(true);

  // ===== Quote seam: money derived server-side from cart + address + rates =====
  const cart = (await (await context.request.get("/api/cart")).json()).data;
  const itemIds = [cart.items.find((item: { variantId: string }) => item.variantId === variantId).id];
  const quote = await context.request.post("/api/checkout/delivery-quote", { data: { itemIds, addressId: deliveryAddressId } });
  expect(quote.ok(), await quote.text()).toBe(true);
  const service = (await quote.json()).data.services[0];
  expect(service.pricing).toMatchObject({
    subtotal: "150000", shippingCost: "30000", serviceFee: "0",
    ppnRatePercent: "11", ppnAmount: "16500", total: "196500",
  });

  // ===== Browser checkout through the real Snap loopback boundary =====
  const page = await context.newPage();
  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByText("Kirim ke alamat", { exact: true }).click();
  await page.getByLabel("Alamat Pengiriman").click();
  await page.getByRole("option", { name: new RegExp(deliveryStreet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  const periksa = page.getByRole("button", { name: /Periksa ongkir/ });
  if (await periksa.isVisible().catch(() => false)) await periksa.click();
  await expect(page.getByText("JNE REG Fixture")).toBeVisible({ timeout: 20_000 });
  await page.getByText("JNE REG Fixture").click();
  // Kontak pemesan delivery = email akun (read-only) + telepon penerima alamat.
  await expect(page.locator("#contactEmail")).toHaveValue(TEST_USERS.store.email);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
  // PPN atas barang saja: 150.000 + 30.000 ongkir + 16.500 = 196.500, tanpa fee.
  await expect(page.getByText("Rp 196.500", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Biaya (Layanan|layanan)/)).toHaveCount(0);
  await page.getByRole("checkbox").first().check();
  // Same passthrough rule as the pickup slice: register before the click.
  const observer = await observePlacedOrder(page);
  await page.getByRole("button", { name: /Bayar/ }).click();
  const placed = await observer.captured;
  expect(placed.ok, placed.text).toBe(true);
  const result = JSON.parse(placed.text) as { orderId: string; redirectUrl: string };
  // The browser only ever posts an approval — money is re-derived server-side.
  const submitted = placed.submitted;
  expect(submitted).toMatchObject({ fulfillmentMethod: "delivery", addressId: deliveryAddressId });
  expect(Number((submitted.approvedPricing as Record<string, unknown>).total)).toBe(196500);
  expect(submitted.pickupDate ?? null).toBeNull();
  try {
    // Actual Snap loopback: the hosted fixture page served by the mock origin.
    await expect(page.getByRole("heading", { name: "Pembayaran fixture" })).toBeVisible();
    const snapUrl = new URL(page.url());
    expect(snapUrl.origin).toBe(new URL(mockUrl).origin);
    expect(snapUrl.pathname).toBe(`/snap/${result.orderId}`);

    // ===== Reader seam: the same snapshot, not master/config =====
    const detailResponse = await context.request.get(`/api/orders/${result.orderId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = (await detailResponse.json()).data;
    expect(detail).toMatchObject({ pricingContractVersion: 1, pricingEngineVersion: 1, providerContractVersion: 3 });
    expect(detail.pricingSnapshot).toMatchObject({
      fulfillmentMethod: "delivery",
      sourceGoodsSubtotal: "150000", subtotal: "150000", netGoods: "150000",
      shippingBeforeSubsidy: "30000", shippingSubsidy: "0", shippingCost: "30000",
      serviceFee: "0", taxableBase: "150000", ppnRatePercent: "11", ppnAmount: "16500",
      total: "196500", expectedProviderPayable: "196500",
      providerTax: { taxId: -2, ratePercent: "11" },
    });

    // ===== Provider boundary: captured Snap + Sales Order requests =====
    const captures = (await mockControl("/__control/requests")).data as Array<{ method: string; path: string; body: Record<string, unknown> }>;
    const snaps = captures.filter((record) => record.path === "/snap/v1/transactions");
    expect(snaps).toHaveLength(1);
    expect(snaps[0].body.transaction_details).toEqual({ order_id: result.orderId, gross_amount: 196500 });
    const snapItems = snaps[0].body.item_details as Array<{ price: number; quantity: number }>;
    // Midtrans lines must sum to the snapshot total: goods + ongkir + PPN.
    expect(snapItems.map((item) => item.price).sort((a, b) => a - b)).toEqual([16500, 30000, 150000]);
    expect(snapItems.every((item) => item.quantity === 1)).toBe(true);
    expect(snapItems.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(196500);

    const soPosts = captures.filter((record) => record.method === "POST" && record.path === "/sales/orders/" && record.body.ref_no === result.orderId);
    expect(soPosts, "exactly ONE Sales Order create POST for this delivery order").toHaveLength(1);
    expect(soPosts[0].body).toMatchObject({
      sub_total: 150000, total_disc: 0, total_tax: 16500,
      original_shipment_cost: 30000, shipping_cost: 30000,
      grand_total: 196500, location_id: deliveryLocationId, ref_no: result.orderId,
    });
    // The provider request carries no shipping-discount key at all.
    expect(soPosts[0].body.shipping_cost_discount).toBeUndefined();
    const soItems = soPosts[0].body.items as Array<Record<string, unknown>>;
    expect(soItems).toHaveLength(1);
    expect(soItems[0]).toMatchObject({
      item_id: 920001, qty_in_base: 1, price: 150000, disc_amount: 0,
      tax_id: -2, tax_amount: 16500, amount: 166500,
    });

    // ===== Drift after the order: master price/tax must not reprice =====
    const taxBefore = (await pool.query("SELECT value FROM system_config WHERE key='tax.ppnRatePercent'")).rows[0].value;
    try {
      await pool.query("UPDATE product_variant SET price='990000.00' WHERE id=$1", [variantId]);
      await pool.query("UPDATE system_config SET value='25' WHERE key='tax.ppnRatePercent'");
      const frozen = (await (await context.request.get(`/api/orders/${result.orderId}`)).json()).data;
      expect(frozen.pricingSnapshot).toEqual(detail.pricingSnapshot);
      expect(frozen.expiresAt).toBe(detail.expiresAt);
      const repayment = await context.request.post("/api/payments/midtrans/create", { data: { orderId: result.orderId } });
      expect(repayment.ok(), await repayment.text()).toBe(true);
      expect((await repayment.json()).redirectUrl).toBe(result.redirectUrl);
      const afterRepayment = (await (await context.request.get(`/api/orders/${result.orderId}`)).json()).data;
      expect(afterRepayment.expiresAt).toBe(detail.expiresAt);
    } finally {
      await pool.query("UPDATE product_variant SET price='150000.00' WHERE id=$1", [variantId]);
      await pool.query("UPDATE system_config SET value=$1 WHERE key='tax.ppnRatePercent'", [taxBefore]);
    }

    // ===== Store detail: delivery summary + the snapshot total, no fee row =====
    await page.goto(`${storeUrl}/account/orders/${result.orderId}`);
    await expect(page.getByText("Pengiriman ke Alamat", { exact: true })).toBeVisible();
    await expect(page.getByText("Rp 196.500", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Biaya (Layanan|layanan)/)).toHaveCount(0);

    // ===== Admin detail reads the SAME snapshot (existing HTTP sign-in seam) =====
    // Own-branch scope first: because the order belongs to a branch that is not
    // the seeded admin's Home Branch, its detail must be hidden behind a 404.
    // That is correct scoping, not a missing grant — asserted before the
    // cross-branch read so the success below cannot be explained by a weakened
    // guard.
    const ownScopedContext = await browser.newContext({ baseURL: adminUrl });
    try {
      await signIn(ownScopedContext, adminUrl, TEST_USERS.admin.identifier, TEST_USERS.admin.password);
      const ownScopedDetail = await ownScopedContext.request.get(`${adminUrl}/api/admin/orders/${result.orderId}`);
      expect(ownScopedDetail.status(), "own-branch scope hides a cross-branch order behind 404").toBe(404);
    } finally {
      await ownScopedContext.close();
    }

    // The seeded HQ identity holds orders:view all_branches, so it is the only
    // seeded reader entitled to this cross-branch delivery snapshot.
    const adminContext = await browser.newContext({ baseURL: adminUrl });
    try {
      await signIn(adminContext, adminUrl, HQ.identifier, HQ.password);
      const adminPage = await adminContext.newPage();
      // The admin client inlines :3001; this isolated run owns :3111 only.
      await adminPage.route(/\/api\/auth\/get-session/, (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin === adminUrl) return route.fallback();
        void route.continue({ url: `${adminUrl}/api/auth/get-session${requestUrl.search}` });
      });
      await adminPage.goto(`${adminUrl}/admin/orders/${result.orderId}`);
      await expect(adminPage.getByText("Rp 196.500", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(adminPage.getByText(/Biaya (Layanan|layanan)/)).toHaveCount(0);
      await adminPage.close();

      // ===== Admin HTTP reader must expose the SAME versioned detail =====
      const adminDetailResponse = await adminContext.request.get(`${adminUrl}/api/admin/orders/${result.orderId}`);
      expect(adminDetailResponse.ok(), await adminDetailResponse.text()).toBe(true);
      const adminOrder = (await adminDetailResponse.json()).data as Record<string, unknown>;
      expect(adminOrder).toMatchObject({
        pricingContractVersion: 1, pricingEngineVersion: 1, providerContractVersion: 3,
      });
      expect(adminOrder.pricingSnapshot).toMatchObject({
        fulfillmentMethod: "delivery",
        netGoods: "150000", shippingCost: "30000", serviceFee: "0",
        ppnRatePercent: "11", ppnAmount: "16500", total: "196500", expectedProviderPayable: "196500",
      });
      // Paired readers decode the one stored snapshot, never master/config.
      expect(adminOrder.pricingSnapshot).toEqual(detail.pricingSnapshot);
      expect(Number(adminOrder.total)).toBe(196500);

      // ===== An UNKNOWN snapshot version must fail closed for both readers =====
      // Schema-valid fixture: the relational versions stay 1/1/2 (the CHECK
      // constraint) while the stored payload declares an unknown version, so
      // only an explicit, strict decoder can reject it.
      const providerRequestCount = async () =>
        ((await mockControl("/__control/requests")).data as Array<{ path: string }>)
          .filter((record) => !record.path.startsWith("/__control/")).length;
      const providerCallsBefore = await providerRequestCount();
      await pool.query("UPDATE orders SET pricing_snapshot = jsonb_set(pricing_snapshot, '{pricingContractVersion}', '2'::jsonb) WHERE id=$1", [result.orderId]);
      try {
        const storeUnknown = await context.request.get(`/api/orders/${result.orderId}`);
        expect(storeUnknown.status(), "unknown snapshot version must not become a 2xx store detail").toBeGreaterThanOrEqual(400);
        const adminUnknown = await adminContext.request.get(`${adminUrl}/api/admin/orders/${result.orderId}`);
        expect(adminUnknown.status(), "unknown snapshot version must not become a 2xx admin detail").toBeGreaterThanOrEqual(400);
        const repayUnknown = await context.request.post("/api/payments/midtrans/create", { data: { orderId: result.orderId } });
        expect(repayUnknown.status(), "unknown snapshot version must fail before any provider write").toBeGreaterThanOrEqual(400);
        // Fail closed means: no reprice read and no new provider call at all.
        expect(await providerRequestCount()).toBe(providerCallsBefore);
      } finally {
        await pool.query("UPDATE orders SET pricing_snapshot = jsonb_set(pricing_snapshot, '{pricingContractVersion}', '1'::jsonb) WHERE id=$1", [result.orderId]);
      }
    } finally {
      await adminContext.close();
    }
  } finally {
    await page.close();
  }
});
