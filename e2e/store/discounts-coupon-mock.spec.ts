/**
 * Ticket 07 — mock-only Playwright: public Coupon pada checkout pickup.
 *
 * Real app HTTP + real PostgreSQL (disposable `marketplace_discounts_test_*`),
 * provider boundaries pointed at the loopback mock. Assertions memakai literal
 * independen dari spec §4.4: goods150000, fixed25000 → net goods125000,
 * PPN13750, total138750; provider line disc_amount25000/amount125000.
 *
 * Mencakup:
 * - picker publik: Offer eligible + Offer minimum tampil disabled dengan alasan;
 * - pilih Coupon → step review menampilkan total & diskon promo;
 * - place order nyata → Redemption reserved + allocation + provider line
 *   discount; order detail jujur;
 * - paid-but-blocked: order lunas yang tertahan verifikasi menampilkan notice.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { Pool } from "pg";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";
import { deleteRetainedOrderFixtures } from "../../packages/db/src/testing/retained-order-fixtures";

dotenv.config({ path: ".env" });

const STORE_BASE_URL = process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL = process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);
const DISPOSABLE_DB = /^marketplace_discounts_test_/;

const FIXTURE_PREFIX = "e2e-discounts-coupon";
const PRODUCT_ID = `${FIXTURE_PREFIX}-product`;
const PRODUCT_SLUG = `${FIXTURE_PREFIX}-anchor`;
const VARIANT_ID = `${FIXTURE_PREFIX}-variant`;
const VARIANT_SKU = "CPN-E2E-01";
const MOCK_ITEM_ID = 930_001;
const OFFER_ID = `${FIXTURE_PREFIX}-offer`;
const OFFER_REVISION_ID = `${OFFER_ID}-revision`;
const OFFER_BENEFIT_ID = `${OFFER_ID}-benefit`;
const MIN_OFFER_ID = `${FIXTURE_PREFIX}-offer-minimum`;
const MIN_REVISION_ID = `${MIN_OFFER_ID}-revision`;
const MIN_BENEFIT_ID = `${MIN_OFFER_ID}-benefit`;
const CONTACT_EMAIL = "discounts-coupon-mock-e2e@example.com";
const CONTACT_PHONE = "081234567892";
const PICKUP_TIME = "10:00";

const GOODS = 150_000;
const COUPON = 25_000;
const NET_GOODS = 125_000;
const PPN = 13_750;
const TOTAL = 138_750;

const fixtureOrderIds = new Set<string>();
let pool: Pool;
let storeContext: BrowserContext;
let homeBranchId = "";
let clientId = "";
let gateBefore:
  | { value: string; type: string; description: string | null }
  | undefined;

function requireIsolatedDisposableRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "discounts-coupon-mock.spec.ts must run under playwright.mock.config.ts (E2E_PROVIDER_MOCKS=true + mock base URLs)"
    );
  }
  const store = new URL(STORE_BASE_URL);
  const mock = new URL(MOCK_BASE_URL);
  const loopback = (host: string) => host === "127.0.0.1" || host === "localhost";
  if (!loopback(store.hostname) || !MOCK_PORTS.has(store.port)) {
    throw new Error(`discounts-coupon-mock refuses non-loopback/foreign store origin ${STORE_BASE_URL}`);
  }
  if (!loopback(mock.hostname) || !MOCK_PORTS.has(mock.port)) {
    throw new Error(`discounts-coupon-mock refuses non-loopback/foreign mock origin ${MOCK_BASE_URL}`);
  }
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(String(process.env.DATABASE_URL)).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("discounts-coupon-mock cannot parse DATABASE_URL");
  }
  if (!DISPOSABLE_DB.test(databaseName)) {
    throw new Error(
      `discounts-coupon-mock refuses database "${databaseName}": it enables the domain gate and writes Offer/order fixtures; only marketplace_discounts_test_* is allowed`
    );
  }
}

function nextOpenDate(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function httpSignIn(context: BrowserContext): Promise<void> {
  const response = await context.request.post(
    `${STORE_BASE_URL}/api/auth/sign-in/email`,
    { data: { email: TEST_USERS.store.email, password: TEST_USERS.store.password } }
  );
  expect(response.ok(), `store sign-in failed: ${await response.text()}`).toBe(true);
}

async function mockControl(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${MOCK_BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`jubelio-mock ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createOffer(input: {
  id: string;
  revisionId: string;
  benefitId: string;
  name: string;
  fixedAmount: string;
  minSubtotal: string;
  state?: string;
}) {
  await pool.query(
    `INSERT INTO discount_offer (id, key, activation_kind, actor_identity)
     VALUES ($1, $2, 'public', 'e2e-coupon-fixture')`,
    [input.id, `${input.id}-key`]
  );
  await pool.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, start_at, end_at, published_at, actor_identity)
     VALUES ($1, $2, 1, $3, 'IDR', $4, now() - interval '1 day', now() + interval '30 days', now(), 'e2e-coupon-fixture')`,
    [input.revisionId, input.id, input.name, input.minSubtotal]
  );
  await pool.query(
    `INSERT INTO discount_benefit (id, revision_id, kind, scope, fixed_amount)
     VALUES ($1, $2, 'fixed_goods', 'goods', $3)`,
    [input.benefitId, input.revisionId, input.fixedAmount]
  );
  await pool.query(
    `UPDATE discount_offer
       SET state = $2, current_revision_id = $3, quota_count = 10, budget_amount = '1000000', per_client_limit = 1
     WHERE id = $1`,
    [input.id, input.state ?? "enabled", input.revisionId]
  );
  await pool.query(`INSERT INTO discount_offer_usage (offer_id) VALUES ($1)`, [input.id]);
}

/** Drives cart → checkout → pickup slot → contact and leaves step 2 ready. */
async function reachContactStep(page: Page): Promise<void> {
  const add = await storeContext.request.post("/api/cart/items", {
    data: { variantId: VARIANT_ID, branchId: homeBranchId, quantity: 1 },
  });
  expect(add.ok(), `adding fixture variant failed: ${await add.text()}`).toBe(true);

  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: PICKUP_TIME }).click();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Nomor Telepon *").fill(CONTACT_PHONE);
  await page.getByLabel("Email *").fill(CONTACT_EMAIL);
  await expect(page.getByText("Promo", { exact: true })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  requireIsolatedDisposableRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const ppn = await pool.query("SELECT value FROM system_config WHERE key='tax.ppnRatePercent'");
  expect(ppn.rows[0]?.value).toBe("11");

  const admin = await pool.query<{ branch_id: string | null; jubelio_location_id: number | null }>(
    `SELECT u.branch_id, b.jubelio_location_id
       FROM "user" u JOIN branch b ON b.id = u.branch_id
      WHERE u.username = $1`,
    [TEST_USERS.admin.identifier]
  );
  homeBranchId = admin.rows[0]?.branch_id ?? "";
  expect(homeBranchId).toBeTruthy();
  expect(admin.rows[0]?.jubelio_location_id ?? 0).toBeGreaterThan(0);

  const owner = await pool.query<{ id: string }>("SELECT id FROM client WHERE email=$1", [
    TEST_USERS.store.email,
  ]);
  clientId = owner.rows[0]?.id ?? "";
  expect(clientId).toBeTruthy();

  // Heal leftovers from an interrupted run (deterministic owned IDs only).
  await pool.query("DELETE FROM branch_stock WHERE product_variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM product WHERE id=$1 OR slug=$2", [PRODUCT_ID, PRODUCT_SLUG]);
  await pool.query("DELETE FROM discount_client_usage WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
  await pool.query("DELETE FROM discount_offer_usage WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
  await pool.query("DELETE FROM discount_benefit WHERE revision_id IN ($1,$2)", [OFFER_REVISION_ID, MIN_REVISION_ID]);
  await pool.query(
    "UPDATE discount_offer SET state='draft', current_revision_id=null WHERE id IN ($1,$2)",
    [OFFER_ID, MIN_OFFER_ID]
  );
  await pool.query("DELETE FROM discount_offer_revision WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
  await pool.query("DELETE FROM discount_offer WHERE id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);

  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Coupon Mock Anchor', $2, '150000.00', 'aktif')`,
    [PRODUCT_ID, PRODUCT_SLUG]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1, $2, $3, '150000.00', true, $4)`,
    [VARIANT_ID, PRODUCT_ID, VARIANT_SKU, MOCK_ITEM_ID]
  );
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, 5, 0, 0, 0, 0, 5, NOW())`,
    [homeBranchId, VARIANT_ID]
  );

  await createOffer({
    id: OFFER_ID,
    revisionId: OFFER_REVISION_ID,
    benefitId: OFFER_BENEFIT_ID,
    name: "Mock Hemat 25",
    fixedAmount: String(COUPON),
    minSubtotal: "0",
  });
  await createOffer({
    id: MIN_OFFER_ID,
    revisionId: MIN_REVISION_ID,
    benefitId: MIN_BENEFIT_ID,
    name: "Mock Minimum Tinggi",
    fixedAmount: "10000",
    minSubtotal: "200000",
  });

  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type)
     VALUES ('discounts.contractVersion', '1', 'number')
     ON CONFLICT (key) DO UPDATE SET value='1', type='number'`
  );

  storeContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(storeContext);
});

test.beforeEach(async () => {
  // The mock clock pins the admission window; make the fixture self-healing if
  // another spec restored the domain gate between files.
  if (pool) {
    await pool.query(
      "INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion', '1', 'number') ON CONFLICT (key) DO UPDATE SET value='1'"
    );
  }
  // Deterministic cart per case: only the line this case adds is checked out.
  if (storeContext) await storeContext.request.delete("/api/cart").catch(() => {});
});

test.afterEach(async () => {
  if (!pool) return;
  // Bucket admission memakai jendela clock mock yang TETAP; hapus row milik
  // fixture ini agar spec lain (checkout-review) tidak mewarisi count.
  const hash = (kind: string, value: string) =>
    createHmac("sha256", "mock-e2e-only-shared-auth-secret-do-not-reuse")
      .update(`okcir:checkout-admission:v1:${kind}:${value}`)
      .digest("hex");
  await pool.query("DELETE FROM discount_request_window WHERE subject_hash=ANY($1::text[])", [
    [hash("account", clientId), hash("ip", "127.0.0.1")],
  ]);
  await deleteRetainedOrderFixtures(pool, [...fixtureOrderIds]);
  fixtureOrderIds.clear();
  await pool.query(
    "UPDATE branch_stock SET pending_remote_stock=0, available_stock=5, stock=5 WHERE product_variant_id=$1",
    [VARIANT_ID]
  );
});

test.afterAll(async () => {
  await storeContext?.close().catch(() => {});
  if (!pool) return;
  try {
    if (gateBefore) {
      await pool.query(
        `UPDATE system_config SET value=$1, type=$2, description=$3 WHERE key='discounts.contractVersion'`,
        [gateBefore.value, gateBefore.type, gateBefore.description]
      );
    } else {
      await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
    }
    await deleteRetainedOrderFixtures(pool, [...fixtureOrderIds]);
    await pool.query(
      `DELETE FROM discount_redemption_event WHERE redemption_id IN
         (SELECT id FROM discount_redemption WHERE offer_id IN ($1,$2))`,
      [OFFER_ID, MIN_OFFER_ID]
    );
    await pool.query("DELETE FROM discount_redemption WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
    await pool.query("DELETE FROM discount_client_usage WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
    await pool.query("DELETE FROM discount_offer_usage WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
    await pool.query("DELETE FROM discount_benefit WHERE revision_id IN ($1,$2)", [OFFER_REVISION_ID, MIN_REVISION_ID]);
    await pool.query(
      "UPDATE discount_offer SET state='draft', current_revision_id=null WHERE id IN ($1,$2)",
      [OFFER_ID, MIN_OFFER_ID]
    );
    await pool.query("DELETE FROM discount_offer_revision WHERE offer_id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
    await pool.query("DELETE FROM discount_offer WHERE id IN ($1,$2)", [OFFER_ID, MIN_OFFER_ID]);
    await pool.query("DELETE FROM branch_stock WHERE product_variant_id=$1", [VARIANT_ID]);
    await pool.query("DELETE FROM product WHERE id=$1 OR slug=$2", [PRODUCT_ID, PRODUCT_SLUG]);
  } finally {
    await pool.end();
  }
});

test.describe("Coupon publik pickup (ticket 07)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("picker menampilkan Offer eligible + disabled reason, lalu total review memakai Coupon", async () => {
    const page = await storeContext.newPage();
    // Stock authority for the later place-order; reset mock request log.
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });

    // Register the wait BEFORE navigation: the request may complete while the
    // picker text is already visible.
    const availableResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/discounts/available")
    );
    await reachContactStep(page);
    const available = await availableResponse;
    const availableBody = await available.json();
    expect(available.ok()).toBe(true);
    expect(availableBody.success).toBe(true);
    const offers = availableBody.data.items as Array<Record<string, unknown>>;
    const eligible = offers.find((offer) => offer.offerId === OFFER_ID);
    expect(eligible).toMatchObject({ eligible: true, benefitAmount: String(COUPON) });
    const disabled = offers.find((offer) => offer.offerId === MIN_OFFER_ID);
    expect(disabled).toMatchObject({ eligible: false, reason: "MINIMUM_NOT_MET" });

    // Disabled Offer tidak bisa dipilih dan menampilkan alasan aman.
    await expect(page.getByRole("button", { name: /Mock Minimum Tinggi/ })).toBeDisabled();
    await expect(page.getByText("Minimum belanja untuk promo ini belum terpenuhi.")).toBeVisible();

    await page.getByRole("button", { name: /Mock Hemat 25/ }).click();
    await expect(page.getByRole("button", { name: /Mock Hemat 25/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Lanjut" }).click();

    await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByText("Diskon promo").first()).toBeVisible();
    await expect(page.getByText(`Rp ${TOTAL.toLocaleString("id-ID")}`).first()).toBeVisible();
  });

  test("place order membuat satu Redemption reserved + allocation + provider line discount", async () => {
    const page = await storeContext.newPage();
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });

    await reachContactStep(page);
    await page.getByRole("button", { name: /Mock Hemat 25/ }).click();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();

    // Keep the browser on the isolated origin if the dev mock redirects to :3000.
    await page.route("**/checkout/payment-test?*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
      return route.fulfill({
        status: 302,
        headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
      });
    });
    let payload: {
      success: boolean;
      orderId?: string;
      redirectUrl?: string;
      error?: string;
    } = { success: false };
    await page.route("**/api/checkout/place-order", async (route) => {
      const response = await route.fetch();
      payload = await response.json();
      await route.fulfill({ response });
    });

    await page.getByText(/Saya telah memeriksa pesanan/).click();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order")),
      page.getByRole("button", { name: "Bayar Sekarang" }).click(),
    ]);
    expect(payload.success, `place-order failed: ${payload.error ?? "unknown"}`).toBe(true);
    const orderId = payload.orderId as string;
    fixtureOrderIds.add(orderId);
    expect(payload.redirectUrl ?? "").toContain("/checkout/payment-test?orderId=");

    // === DB truth: exactly one reserved Redemption + positive allocations ===
    const redemption = await pool.query(
      `SELECT id, order_id, client_id, offer_id, revision_id, benefit_id, status, benefit_amount
         FROM discount_redemption WHERE order_id=$1`,
      [orderId]
    );
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0]).toMatchObject({
      order_id: orderId,
      client_id: clientId,
      offer_id: OFFER_ID,
      revision_id: OFFER_REVISION_ID,
      benefit_id: OFFER_BENEFIT_ID,
      status: "reserved",
      benefit_amount: "25000.00",
    });
    const allocations = await pool.query(
      `SELECT component, amount FROM order_discount_allocation WHERE order_id=$1`,
      [orderId]
    );
    expect(allocations.rows).toEqual([{ component: "offer_goods", amount: "25000.00" }]);
    const usage = await pool.query(
      `SELECT reserved_count, consumed_count, reserved_amount FROM discount_offer_usage WHERE offer_id=$1`,
      [OFFER_ID]
    );
    expect(usage.rows[0]).toMatchObject({
      reserved_count: 1,
      consumed_count: 0,
      reserved_amount: "25000.00",
    });

    // === Provider line: price source, disc_amount Markdown+Coupon sekali ===
    const requests = (await mockControl("GET", "/__control/requests")).data as Array<{
      method: string;
      path: string;
      body: Record<string, unknown>;
    }>;
    const create = requests.find(
      (request) =>
        request.method === "POST" &&
        Array.isArray((request.body as { items?: unknown }).items)
    );
    expect(create, "Sales-Order create POST was not captured").toBeTruthy();
    const items = (create!.body as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({ price: GOODS, qty_in_base: 1, disc_amount: COUPON, amount: NET_GOODS });
    expect(Number((create!.body as { grand_total: number }).grand_total)).toBe(NET_GOODS);

    // === Customer order detail is honest about the reserved promo ===
    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText("Status promo")).toBeVisible();
    await expect(page.getByText("Direservasi sampai batas pembayaran")).toBeVisible();
    await expect(page.getByText(/Diskon promo \(Mock Hemat 25\)/)).toBeVisible();
  });

  test("order lunas yang tertahan menampilkan paid-but-blocked, bukan status siap", async () => {
    const page = await storeContext.newPage();
    const orderId = `${FIXTURE_PREFIX}-blocked-order`;
    fixtureOrderIds.add(orderId);
    await pool.query(
      `INSERT INTO orders
         (id, user_id, branch_id, contact_phone, contact_email, subtotal, discount, ppn_rate, ppn_amount, total,
          status, payment_status, fulfillment_blocked_reason, fulfillment_method, expires_at)
       VALUES ($1,$2,$3,$4,$5,'125000','25000','11','13750','138750',
          'processing','paid','Settlement Sales Order belum terverifikasi — review manual','pickup', now() + interval '15 minutes')`,
      [orderId, clientId, homeBranchId, CONTACT_PHONE, CONTACT_EMAIL]
    );
    await pool.query(
      `INSERT INTO order_item (id, order_id, variant_id, product_name, price, quantity,
         pricing_contract_version, source_unit_price, markdown_amount, goods_discount_amount, net_line_amount)
       VALUES ($1,$2,$3,'Coupon Mock Anchor','125000',1,1,'150000','0','25000','125000')`,
      [`${orderId}-item`, orderId, VARIANT_ID]
    );
    await pool.query(
      `INSERT INTO discount_redemption
         (id, order_id, client_id, offer_id, revision_id, benefit_id, activation_kind, status,
          benefit_amount, deadline, policy_version, terms_snapshot, result_snapshot, consumed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'public','consumed','25000', now() + interval '15 minutes', 1, '{}', '{}', now())`,
      [
        `${orderId}-redemption`,
        orderId,
        clientId,
        OFFER_ID,
        OFFER_REVISION_ID,
        OFFER_BENEFIT_ID,
      ]
    );

    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText("Pembayaran diterima, pesanan menunggu verifikasi")).toBeVisible();
    await expect(page.getByText("Dipakai (lunas)")).toBeVisible();
    await expect(page.getByText(/Diskon promo \(Mock Hemat 25\)/)).toBeVisible();
  });
});
