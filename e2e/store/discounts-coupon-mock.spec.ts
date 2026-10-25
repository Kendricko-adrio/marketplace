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
import { deleteRetainedOrderFixtures, deleteUnpromotedCheckoutAttempts } from "../../packages/db/src/testing/retained-order-fixtures";

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
// Ticket 08 — Offer eligible kedua dengan benefit lebih kecil (penggantian naik).
const SMALL_OFFER_ID = `${FIXTURE_PREFIX}-offer-small`;
const SMALL_REVISION_ID = `${SMALL_OFFER_ID}-revision`;
const SMALL_BENEFIT_ID = `${SMALL_OFFER_ID}-benefit`;
// Ticket 09 — Manual Promo Code fixture: Offer manual_only + dua kode canonical.
const MANUAL_OFFER_ID = `${FIXTURE_PREFIX}-offer-manual`;
const MANUAL_REVISION_ID = `${MANUAL_OFFER_ID}-revision`;
const MANUAL_BENEFIT_ID = `${MANUAL_OFFER_ID}-benefit`;
const MANUAL_CODE_ID = `${MANUAL_OFFER_ID}-code-active`;
const MANUAL_INACTIVE_CODE_ID = `${MANUAL_OFFER_ID}-code-inactive`;
const MANUAL_CODE = "MANUALMOCK25";
// Ticket 10 — percentage goods rate10 cap20000.
const PERCENT_OFFER_ID = `${FIXTURE_PREFIX}-offer-percent`;
const PERCENT_REVISION_ID = `${PERCENT_OFFER_ID}-revision`;
const PERCENT_BENEFIT_ID = `${PERCENT_OFFER_ID}-benefit`;
// Ticket 13 — manual × percentage: kombinasi activation channel + benefit yang
// baru bertemu setelah ticket 09/10 (kode manual tidak boleh memakai jalur
// evaluasi berbeda dari Coupon publik).
const MANUAL_PERCENT_OFFER_ID = `${FIXTURE_PREFIX}-offer-manual-percent`;
const MANUAL_PERCENT_REVISION_ID = `${MANUAL_PERCENT_OFFER_ID}-revision`;
const MANUAL_PERCENT_BENEFIT_ID = `${MANUAL_PERCENT_OFFER_ID}-benefit`;
const MANUAL_PERCENT_CODE_ID = `${MANUAL_PERCENT_OFFER_ID}-code`;
const MANUAL_PERCENT_CODE = "MANUALPCNT10";
const OFFER_IDS = [
  OFFER_ID,
  MIN_OFFER_ID,
  SMALL_OFFER_ID,
  MANUAL_OFFER_ID,
  PERCENT_OFFER_ID,
  MANUAL_PERCENT_OFFER_ID,
];
const REVISION_IDS = [
  OFFER_REVISION_ID,
  MIN_REVISION_ID,
  SMALL_REVISION_ID,
  MANUAL_REVISION_ID,
  PERCENT_REVISION_ID,
  MANUAL_PERCENT_REVISION_ID,
];
const CONTACT_EMAIL = "discounts-coupon-mock-e2e@example.com";
const CONTACT_PHONE = "081234567892";
const PICKUP_TIME = "10:00";

const GOODS = 150_000;
const COUPON = 25_000;
const NET_GOODS = 125_000;
const PPN = 13_750;
const TOTAL = 138_750;
// Literal independen untuk penggantian (ticket 08):
// benefit 10000 → net 140000, PPN 15400, total 155400; selisih +16650.
const SMALL_BENEFIT = 10_000;
const NET_AFTER_SMALL = 140_000;
const PPN_AFTER_SMALL = 15_400;
const TOTAL_AFTER_SMALL = 155_400;
const INCREASE_DELTA = 16_650;
// Tanpa promo: 150000 + PPN 11% (16500) = 166500.
const TOTAL_WITHOUT_PROMO = 166_500;
// Percentage 10% atas150000 = 15000 (cap20000 belum mengikat):
// net135000, PPN14850, total149850.
const PERCENT_BENEFIT = 15_000;
const PERCENT_NET = 135_000;
const PERCENT_PPN = 14_850;
const PERCENT_TOTAL = 149_850;

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
  perClientLimit?: number;
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
       SET state = $2, current_revision_id = $3, quota_count = 10, budget_amount = '1000000', per_client_limit = $4
     WHERE id = $1`,
    [input.id, input.state ?? "enabled", input.revisionId, input.perClientLimit ?? 1]
  );
  await pool.query(`INSERT INTO discount_offer_usage (offer_id) VALUES ($1)`, [input.id]);
}

/**
 * Drives cart → checkout → pickup slot + contact → review step, where the
 * single promo slot lives (the contact step no longer exists).
 */
async function openPromoPicker(page: Page) {
  if (!await page.getByRole("dialog").isVisible()) {
    await page.getByRole("button", { name: /^(Pilih promo|Ubah promo|Pilih promo lain)$/ }).click();
  }
  await expect(page.getByRole("dialog", { name: "Pilih promo", exact: true })).toBeVisible();
}
async function choosePromo(page: Page, name: RegExp) {
  await openPromoPicker(page);
  await page.getByRole("radio", { name }).check();
  await page.getByRole("button", { name: "Gunakan promo", exact: true }).click();
}
async function enterPromoCode(page: Page, code: string) {
  await openPromoPicker(page);
  await page.getByLabel("Kode promo", { exact: true }).fill(code);
  const response = page.waitForResponse(r => r.url().endsWith("/api/checkout/preview"));
  await page.getByRole("button", { name: "Periksa", exact: true }).click();
  const body = await (await response).json();
  if (body.success) {
    await expect(page.getByText("Kode promo valid. Pilih Gunakan promo untuk menerapkan.")).toBeVisible();
    await page.getByRole("button", { name: "Gunakan promo", exact: true }).click();
  }
}

async function reachPaymentStep(page: Page): Promise<void> {
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
  await page.getByLabel("Nomor Telepon *").fill(CONTACT_PHONE);
  await page.getByLabel("Email *").fill(CONTACT_EMAIL);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
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
  await pool.query("DELETE FROM discount_code WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
  await pool.query("DELETE FROM discount_client_usage WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
  await pool.query("DELETE FROM discount_offer_usage WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
  await pool.query("DELETE FROM discount_benefit WHERE revision_id = ANY($1::text[])", [REVISION_IDS]);
  await pool.query(
    "UPDATE discount_offer SET state='draft', current_revision_id=null WHERE id = ANY($1::text[])",
    [OFFER_IDS]
  );
  await pool.query("DELETE FROM discount_offer_revision WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
  await pool.query("DELETE FROM discount_offer WHERE id = ANY($1::text[])", [OFFER_IDS]);

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
    // Serial suite: beberapa kasus memakai akun fixture yang sama.
    perClientLimit: 5,
  });
  await createOffer({
    id: MIN_OFFER_ID,
    revisionId: MIN_REVISION_ID,
    benefitId: MIN_BENEFIT_ID,
    name: "Mock Minimum Tinggi",
    fixedAmount: "10000",
    minSubtotal: "200000",
  });
  // Manual Offer (ticket 09): code channel, sharing the same quota/benefit.
  await pool.query(
    `INSERT INTO discount_offer (id, key, activation_kind, actor_identity)
     VALUES ($1, $2, 'manual_only', 'e2e-manual-fixture')`,
    [MANUAL_OFFER_ID, `${MANUAL_OFFER_ID}-key`]
  );
  await pool.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, start_at, end_at, published_at, actor_identity)
     VALUES ($1, $2, 1, 'Mock Kode Manual 25', 'IDR', '0', now() - interval '1 day', now() + interval '30 days', now(), 'e2e-manual-fixture')`,
    [MANUAL_REVISION_ID, MANUAL_OFFER_ID]
  );
  await pool.query(
    `INSERT INTO discount_benefit (id, revision_id, kind, scope, fixed_amount)
     VALUES ($1, $2, 'fixed_goods', 'goods', $3)`,
    [MANUAL_BENEFIT_ID, MANUAL_REVISION_ID, String(COUPON)]
  );
  await pool.query(
    `UPDATE discount_offer
       SET state='enabled', current_revision_id=$2, quota_count=10,
           budget_amount='1000000', per_client_limit=5
     WHERE id=$1`,
    [MANUAL_OFFER_ID, MANUAL_REVISION_ID]
  );
  await pool.query(`INSERT INTO discount_offer_usage (offer_id) VALUES ($1)`, [MANUAL_OFFER_ID]);
  await pool.query(
    `INSERT INTO discount_code (id, offer_id, canonical_code, state, actor_identity)
     VALUES ($1, $2, $3, 'active', 'e2e-manual-fixture'),
            ($4, $2, 'MANUALOFF25', 'inactive', 'e2e-manual-fixture')`,
    [MANUAL_CODE_ID, MANUAL_OFFER_ID, MANUAL_CODE, MANUAL_INACTIVE_CODE_ID]
  );

  await pool.query(
    `INSERT INTO discount_offer (id, key, activation_kind, actor_identity)
     VALUES ($1, $2, 'public', 'e2e-coupon-fixture')`,
    [PERCENT_OFFER_ID, `${PERCENT_OFFER_ID}-key`]
  );
  await pool.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, start_at, end_at, published_at, actor_identity)
     VALUES ($1, $2, 1, 'Mock Persen 10 (maks 20rb)', 'IDR', '0', now() - interval '1 day', now() + interval '30 days', now(), 'e2e-coupon-fixture')`,
    [PERCENT_REVISION_ID, PERCENT_OFFER_ID]
  );
  await pool.query(
    `INSERT INTO discount_benefit (id, revision_id, kind, scope, rate, cap_amount)
     VALUES ($1, $2, 'percentage_goods', 'goods', '10.000000', '20000')`,
    [PERCENT_BENEFIT_ID, PERCENT_REVISION_ID]
  );
  await pool.query(
    `UPDATE discount_offer
       SET state='enabled', current_revision_id=$2, quota_count=10,
           budget_amount='1000000', per_client_limit=5
     WHERE id=$1`,
    [PERCENT_OFFER_ID, PERCENT_REVISION_ID]
  );
  await pool.query(`INSERT INTO discount_offer_usage (offer_id) VALUES ($1)`, [PERCENT_OFFER_ID]);

  // Ticket 13 — manual_only + percentage_goods (rate10 cap20000).
  await pool.query(
    `INSERT INTO discount_offer (id, key, activation_kind, actor_identity)
     VALUES ($1, $2, 'manual_only', 'e2e-manual-percent-fixture')`,
    [MANUAL_PERCENT_OFFER_ID, `${MANUAL_PERCENT_OFFER_ID}-key`]
  );
  await pool.query(
    `INSERT INTO discount_offer_revision
       (id, offer_id, revision_no, name, currency, min_subtotal, start_at, end_at, published_at, actor_identity)
     VALUES ($1, $2, 1, 'Mock Kode Manual Persen 10', 'IDR', '0', now() - interval '1 day', now() + interval '30 days', now(), 'e2e-manual-percent-fixture')`,
    [MANUAL_PERCENT_REVISION_ID, MANUAL_PERCENT_OFFER_ID]
  );
  await pool.query(
    `INSERT INTO discount_benefit (id, revision_id, kind, scope, rate, cap_amount)
     VALUES ($1, $2, 'percentage_goods', 'goods', '10.000000', '20000')`,
    [MANUAL_PERCENT_BENEFIT_ID, MANUAL_PERCENT_REVISION_ID]
  );
  await pool.query(
    `UPDATE discount_offer
       SET state='enabled', current_revision_id=$2, quota_count=10,
           budget_amount='1000000', per_client_limit=5
     WHERE id=$1`,
    [MANUAL_PERCENT_OFFER_ID, MANUAL_PERCENT_REVISION_ID]
  );
  await pool.query(`INSERT INTO discount_offer_usage (offer_id) VALUES ($1)`, [
    MANUAL_PERCENT_OFFER_ID,
  ]);
  await pool.query(
    `INSERT INTO discount_code (id, offer_id, canonical_code, state, actor_identity)
     VALUES ($1, $2, $3, 'active', 'e2e-manual-percent-fixture')`,
    [MANUAL_PERCENT_CODE_ID, MANUAL_PERCENT_OFFER_ID, MANUAL_PERCENT_CODE]
  );

  await createOffer({
    id: SMALL_OFFER_ID,
    revisionId: SMALL_REVISION_ID,
    benefitId: SMALL_BENEFIT_ID,
    name: "Mock Hemat 10",
    fixedAmount: String(SMALL_BENEFIT),
    minSubtotal: "0",
    // Beberapa penggantian pada akun fixture yang sama (serial suite).
    perClientLimit: 5,
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
    // Subject hash sama untuk bucket preview/place/code, jadi baris bucket
    // manual code (ticket 09) juga terhapus di sini.
    [hash("account", clientId), hash("ip", "127.0.0.1")],
  ]);
  await deleteRetainedOrderFixtures(pool, [...fixtureOrderIds]);
  fixtureOrderIds.clear();
  await deleteUnpromotedCheckoutAttempts(pool, [clientId]);
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
         (SELECT id FROM discount_redemption WHERE offer_id = ANY($1::text[]))`,
      [OFFER_IDS]
    );
    await pool.query("DELETE FROM discount_redemption WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
    await pool.query("DELETE FROM discount_code WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
    await pool.query("DELETE FROM discount_client_usage WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
    await pool.query("DELETE FROM discount_offer_usage WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
    await pool.query("DELETE FROM discount_benefit WHERE revision_id = ANY($1::text[])", [REVISION_IDS]);
    await pool.query(
      "UPDATE discount_offer SET state='draft', current_revision_id=null WHERE id = ANY($1::text[])",
      [OFFER_IDS]
    );
    await pool.query("DELETE FROM discount_offer_revision WHERE offer_id = ANY($1::text[])", [OFFER_IDS]);
    await pool.query("DELETE FROM discount_offer WHERE id = ANY($1::text[])", [OFFER_IDS]);
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
    await reachPaymentStep(page);
    const available = await availableResponse;
    const availableBody = await available.json();
    expect(available.ok()).toBe(true);
    expect(availableBody.success).toBe(true);
    const offers = availableBody.data.items as Array<Record<string, unknown>>;
    const eligible = offers.find((offer) => offer.offerId === OFFER_ID);
    expect(eligible).toMatchObject({ eligible: true, benefitAmount: String(COUPON) });
    const disabled = offers.find((offer) => offer.offerId === MIN_OFFER_ID);
    expect(disabled).toMatchObject({ eligible: false, reason: "MINIMUM_NOT_MET" });

    await openPromoPicker(page);
    // Disabled Offer tidak bisa dipilih dan menampilkan alasan aman.
    await expect(page.getByRole("radio", { name: /Mock Minimum Tinggi/ })).toBeDisabled();
    await expect(page.getByText("Minimum belanja untuk promo ini belum terpenuhi.")).toBeVisible();

    await choosePromo(page, /Mock Hemat 25/);
    await expect(page.getByRole("region", { name: "Promo", exact: true })).toContainText("Dipakai");

    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
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

    await reachPaymentStep(page);
    await choosePromo(page, /Mock Hemat 25/);
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();

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

  test("modal promo: daftar scrollable 10 per halaman, draft lintas halaman dan batal tidak menerapkan", async () => {
    const page = await storeContext.newPage();
    await page.route("**/api/discounts/available", async route => {
      const body = route.request().postDataJSON();
      const current = body.page ?? 1;
      const items = Array.from({ length: 27 }, (_, i) => ({
        offerId: `pagination-${i}`, name: `Promo halaman ${i + 1}`,
        benefitAmount: "10000", benefitKind: "fixed_goods", rate: null, capAmount: null,
        minSubtotal: "0", endsAt: null, eligible: true, reason: null, reasonMessage: null,
        estimatedSavings: "11100", estimatedTotal: "155400", recommended: i === 0,
      }));
      await route.fulfill({ json: { success: true, data: {
        items: items.slice((current - 1) * 10, current * 10), page: current,
        pageSize: 10, totalItems: 27, totalPages: 3, selectedOffer: null, selectedOfferUnavailable: false,
      } } });
    });
    await page.setViewportSize({ width: 390, height: 740 });
    await reachPaymentStep(page);
    await expect(page.getByRole("radio", { name: /Promo halaman/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Pilih promo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pilih promo", exact: true });
    await expect(dialog.getByRole("radio")).toHaveCount(10);
    await expect(dialog.getByRole("button", { name: "Gunakan promo" })).toBeDisabled();
    await dialog.getByRole("radio").first().check();
    const list = dialog.getByRole("region", { name: "Daftar promo" });
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await dialog.getByRole("button", { name: "Halaman promo berikutnya" }).click();
    await expect(dialog.getByText("11–20 dari 27 promo")).toBeVisible();
    await expect(dialog.getByText("Pilihan: Promo halaman 1", { exact: true })).toBeVisible();
    expect(await list.evaluate(el => el.scrollTop)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pilih promo", exact: true })).toBeFocused();
    await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);
    await page.getByRole("button", { name: "Pilih promo", exact: true }).click();
    await expect(dialog.getByText("1–10 dari 27 promo")).toBeVisible();
    await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  });

  test("modal promo: kode draft, input edit, dan response apply setelah Escape tidak mengubah checkout", async () => {
    const page = await storeContext.newPage();
    await reachPaymentStep(page);
    await openPromoPicker(page);
    const dialog = page.getByRole("dialog", { name: "Pilih promo", exact: true });
    await page.getByLabel("Kode promo", { exact: true }).fill(MANUAL_CODE);
    await dialog.getByRole("button", { name: "Periksa", exact: true }).click();
    await expect(dialog.getByText("Kode promo valid. Pilih Gunakan promo untuk menerapkan.")).toBeVisible();
    await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);
    await page.getByLabel("Kode promo", { exact: true }).fill("EDITED");
    await expect(dialog.getByRole("button", { name: "Gunakan promo", exact: true })).toBeDisabled();
    await expect(dialog.getByText("Kode promo valid. Pilih Gunakan promo untuk menerapkan.")).toHaveCount(0);
    // Actual rendered evidence for main-agent visual review; not failure screenshots.
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await dialog.getByRole("radio", { name: /Mock Hemat 25/ }).check();
      await page.screenshot({ path: `playwright/mcp/promo-modal/modal-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const started = new Promise<void>(resolve => { arrived = resolve; });
    let finished!: () => void;
    const complete = new Promise<void>(resolve => { finished = resolve; });
    await page.route("**/api/checkout/preview", async route => {
      const response = await route.fetch();
      arrived();
      await gate;
      await route.fulfill({ response });
      finished();
    });
    await dialog.getByRole("button", { name: "Gunakan promo", exact: true }).click();
    await started;
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    release();
    await complete;
    await expect(page.getByRole("button", { name: "Pilih promo", exact: true })).toBeEnabled();
    await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Rincian Pembayaran" }).getByText("Rp 166.500", { exact: true })).toBeVisible();
    await page.screenshot({ path: "playwright/mcp/promo-modal/checkout-summary-1440.png", fullPage: true });
    await page.close();
  });

  test("modal promo: error dapat dicoba ulang, empty tetap menerima kode, kontrak page menolak cursor campuran", async () => {
    const page = await storeContext.newPage();
    await reachPaymentStep(page);
    const cart = (await (await storeContext.request.get("/api/cart")).json()).data;
    const invalid = await storeContext.request.post("/api/discounts/available", { data: {
      selectedItemIds: [cart.items[0].id], page: 1, cursor: "legacy",
    } });
    expect(invalid.status()).toBe(400);
    let fail = true;
    await page.route("**/api/discounts/available", async route => {
      await route.fulfill(fail ? { status: 503, json: { success: false, error: "Promo belum dapat dimuat." } }
        : { json: { success: true, data: { items: [], page: 1, pageSize: 10, totalItems: 0,
          totalPages: 0, selectedOffer: null, selectedOfferUnavailable: false } } });
    });
    await openPromoPicker(page);
    const dialog = page.getByRole("dialog", { name: "Pilih promo", exact: true });
    await expect(dialog.getByRole("alert")).toHaveText(/Promo belum dapat dimuat/);
    fail = false;
    await dialog.getByRole("button", { name: "Coba lagi", exact: true }).click();
    await expect(dialog.getByText("Belum ada promo yang tersedia untuk pesanan ini.")).toBeVisible();
    await expect(dialog.getByRole("navigation", { name: "Pagination promo" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Gunakan promo", exact: true })).toBeDisabled();
    await dialog.getByLabel("Kode promo", { exact: true }).fill(MANUAL_CODE);
    await dialog.getByRole("button", { name: "Periksa", exact: true }).click();
    await expect(dialog.getByText("Kode promo valid. Pilih Gunakan promo untuk menerapkan.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Gunakan promo", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);
    // Render the agreed peer dialog for main-agent cross-pattern visual review.
    await page.getByRole("button", { name: "Kembali", exact: true }).click();
    await page.getByText("Kirim ke alamat", { exact: true }).click();
    await page.getByRole("button", { name: "Gunakan alamat baru", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Alamat baru", exact: true })).toBeVisible();
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({ path: `playwright/mcp/promo-modal/reference-address-${width}.png` });
    }
    await page.getByRole("dialog").getByRole("button", { name: "Batal", exact: true }).click();
    await page.close();
  });

  test("modal promo: radio keyboard, focus trap dan footer viewport pendek tetap dapat digunakan", async () => {
    const page = await storeContext.newPage();
    await page.setViewportSize({ width: 360, height: 500 });
    await reachPaymentStep(page);
    await openPromoPicker(page);
    const dialog = page.getByRole("dialog", { name: "Pilih promo", exact: true });
    const radios = dialog.getByRole("radio");
    await radios.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.first()).not.toBeChecked();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    const action = await dialog.getByRole("button", { name: "Gunakan promo", exact: true }).boundingBox();
    expect(action).not.toBeNull();
    expect(action!.y).toBeGreaterThanOrEqual(0);
    expect(action!.y + action!.height).toBeLessThanOrEqual(500);
    expect(await dialog.getByRole("region", { name: "Daftar promo" }).evaluate(el => el.clientHeight)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Pilih promo", exact: true })).toBeFocused();
    await page.close();
  });

  test("percentage goods 10% cap20000: picker jujur, place order menyimpan allocation exact", async () => {
    const page = await storeContext.newPage();
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });

    const availableResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/discounts/available")
    );
    await reachPaymentStep(page);
    const available = await availableResponse;
    const availableBody = await available.json();
    const percentOffer = (availableBody.data.items as Array<Record<string, unknown>>).find(
      (offer) => offer.offerId === PERCENT_OFFER_ID
    );
    expect(percentOffer).toMatchObject({
      eligible: true,
      benefitKind: "percentage_goods",
      rate: "10",
      capAmount: "20000",
      benefitAmount: String(PERCENT_BENEFIT),
    });

    // Label persentase, bukan nominal fixed yang menyesatkan.
    await openPromoPicker(page);
    await expect(page.getByRole("radio", { name: /Mock Persen 10/ }).locator("..")).toContainText(
      "Diskon 10% (maks Rp 20.000)"
    );
    await choosePromo(page, /Mock Persen 10/);
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
    await expect(page.getByText("Diskon promo").first()).toBeVisible();
    await expect(page.getByText(`Rp ${PERCENT_TOTAL.toLocaleString("id-ID")}`).first()).toBeVisible();

    await page.route("**/checkout/payment-test?*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
      return route.fulfill({
        status: 302,
        headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
      });
    });
    let payload: { success: boolean; orderId?: string; error?: string } = { success: false };
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

    const redemption = await pool.query(
      `SELECT offer_id, revision_id, benefit_id, status, benefit_amount,
              terms_snapshot->'benefit' AS benefit
         FROM discount_redemption WHERE order_id=$1`,
      [orderId]
    );
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0]).toMatchObject({
      offer_id: PERCENT_OFFER_ID,
      revision_id: PERCENT_REVISION_ID,
      benefit_id: PERCENT_BENEFIT_ID,
      status: "reserved",
      benefit_amount: "15000.00",
    });
    expect(redemption.rows[0].benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "10",
      capAmount: "20000",
    });
    const allocations = await pool.query(
      `SELECT component, amount FROM order_discount_allocation WHERE order_id=$1`,
      [orderId]
    );
    expect(allocations.rows).toEqual([{ component: "offer_goods", amount: "15000.00" }]);
    const order = await pool.query(
      `SELECT goods_discount_amount, net_line_amount FROM order_item WHERE order_id=$1`,
      [orderId]
    );
    expect(order.rows[0]).toEqual({ goods_discount_amount: "15000.00", net_line_amount: "135000.00" });

    // Provider menerima price SOURCE dan whole-line disc Markdown+Coupon sekali.
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
    expect(create).toBeTruthy();
    const items = (create!.body as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({
      price: GOODS,
      qty_in_base: 1,
      disc_amount: PERCENT_BENEFIT,
      amount: PERCENT_NET,
    });

    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText(/Diskon promo \(Mock Persen 10 \(maks 20rb\)\)/)).toBeVisible();
  });

  test("manual × percentage: kode manual memakai rate/cap yang sama, place menyimpan allocation exact", async () => {
    const page = await storeContext.newPage();
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });

    await reachPaymentStep(page);
    await enterPromoCode(page, ` ${MANUAL_PERCENT_CODE.toLowerCase()} `);

    // Kode canonical manual diterapkan dengan benefit percentage yang sama:
    // 10% × 150000 = 15000 (cap20000 belum mengikat), total149850.
    await expect(
      page.getByText(`Rp ${PERCENT_TOTAL.toLocaleString("id-ID")}`).first()
    ).toBeVisible();
    await expect(page.getByText(MANUAL_PERCENT_CODE)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();

    await page.route("**/checkout/payment-test?*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
      return route.fulfill({
        status: 302,
        headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
      });
    });
    let payload: { success: boolean; orderId?: string; error?: string } = { success: false };
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
    expect(payload.success, `place-order manual percentage gagal: ${payload.error ?? "unknown"}`).toBe(true);
    const orderId = payload.orderId as string;
    fixtureOrderIds.add(orderId);

    const redemption = await pool.query(
      `SELECT activation_kind, code_id, offer_id, revision_id, status, benefit_amount,
              terms_snapshot->'benefit' AS benefit
         FROM discount_redemption WHERE order_id=$1`,
      [orderId]
    );
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0]).toMatchObject({
      activation_kind: "manual_only",
      code_id: MANUAL_PERCENT_CODE_ID,
      offer_id: MANUAL_PERCENT_OFFER_ID,
      revision_id: MANUAL_PERCENT_REVISION_ID,
      status: "reserved",
      benefit_amount: "15000.00",
    });
    expect(redemption.rows[0].benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "10",
      capAmount: "20000",
    });
    const allocations = await pool.query(
      "SELECT component, amount FROM order_discount_allocation WHERE order_id=$1",
      [orderId]
    );
    expect(allocations.rows).toEqual([{ component: "offer_goods", amount: "15000.00" }]);
    const order = await pool.query(
      "SELECT goods_discount_amount, net_line_amount FROM order_item WHERE order_id=$1",
      [orderId]
    );
    expect(order.rows[0]).toEqual({
      goods_discount_amount: "15000.00",
      net_line_amount: "135000.00",
    });

    // Provider tetap menerima price SOURCE dan whole-line disc dari snapshot.
    const requests = (await mockControl("GET", "/__control/requests")).data as Array<{
      method: string;
      path: string;
      body: Record<string, unknown>;
    }>;
    const create = requests.find(
      (request) =>
        request.method === "POST" && Array.isArray((request.body as { items?: unknown }).items)
    );
    expect(create).toBeTruthy();
    const items = (create!.body as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({
      price: GOODS,
      qty_in_base: 1,
      disc_amount: PERCENT_BENEFIT,
      amount: PERCENT_NET,
    });

    await page
      .waitForURL("**/checkout/payment-test**", { timeout: 15_000 })
      .catch(() => {});
    await page.goto(`/account/orders/${orderId}`);
    await expect(
      page.getByText("Diskon promo (Mock Kode Manual Persen 10)", { exact: true })
    ).toBeVisible();
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


/**
 * Ticket 08 — penggantian dan gugurnya promo.
 *
 * Semua langkah memakai app HTTP nyata + PostgreSQL disposable: preview
 * membandingkan total FINAL (PPN ikut), dialog hanya saat naik, batal
 * mempertahankan pilihan/total lama, persetujuan mengikat candidate
 * fingerprint token, dan promo yang gugur tidak pernah diganti diam-diam.
 * Literal uang independen: 150000 dengan Coupon 25000 → 138750; dengan Coupon
 * 10000 → 155400; tanpa promo → 166500.
 */
test.describe("Penggantian dan gugurnya promo (ticket 08)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  async function ensureStock() {
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });
  }

  async function setOfferState(offerId: string, state: "enabled" | "paused") {
    await pool.query("UPDATE discount_offer SET state=$2 WHERE id=$1", [offerId, state]);
  }

  function rupiah(value: number): string {
    return `Rp ${value.toLocaleString("id-ID")}`;
  }

  async function reviewWithCoupon25(page: Page) {
    // Langkah pembayaran memuat picker; daftarkan wait SEBELUM navigasi agar
    // keadaan stale (untuk kasus kandidat gugur) deterministik.
    const reviewPicker = page.waitForResponse((response) =>
      response.url().endsWith("/api/discounts/available")
    );
    await reachPaymentStep(page);
    await choosePromo(page, /Mock Hemat 25/);
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
    await reviewPicker;
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();
  }

  test("Coupon 25000→10000: dialog old/new/delta, batal mempertahankan, konfirmasi mengikat fingerprint dan place order memakai ack", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    await reviewWithCoupon25(page);

    // Pilih/Terapkan kandidat benefit lebih kecil → total final naik → dialog.
    const replacementResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkout/preview") &&
        (response.request().postData() ?? "").includes("\"previous\"")
    );
    await choosePromo(page, /Mock Hemat 10/);
    const preview = await replacementResponse;
    expect(preview.status()).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.data.requiresIncreaseConfirmation).toBe(true);
    expect(previewBody.data.replacement).toMatchObject({
      direction: "increase",
      deltaTotal: String(INCREASE_DELTA),
      previous: { status: "valid", total: String(TOTAL) },
      candidate: { total: String(TOTAL_AFTER_SMALL) },
    });

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(rupiah(TOTAL), { exact: true })).toBeVisible();
    await expect(dialog.getByText(rupiah(TOTAL_AFTER_SMALL), { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(`+ ${rupiah(INCREASE_DELTA)}`, { exact: true })
    ).toBeVisible();
    // Selama dialog terbuka, pilihan dan total lama TIDAK berubah.
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();

    // Batal: pilihan & total lama dipertahankan; tidak ada applied state palsu.
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByRole("dialog", { name: "Pilih promo", exact: true })).toBeVisible();
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();

    // Konfirmasi: breakdown berganti ke kandidat (net 140000, PPN 15400).
    await choosePromo(page, /Mock Hemat 10/);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Ya, ganti promo" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 10");
    await expect(page.getByText(rupiah(TOTAL_AFTER_SMALL)).first()).toBeVisible();
    await expect(page.getByText(rupiah(PPN_AFTER_SMALL)).first()).toBeVisible();

    // Preview penggantian (termasuk dialog/kandidat) tetap read-only: tidak ada
    // stock hold, Redemption, atau slot kedua sebelum place-order.
    const holdsBefore = await pool.query(
      "SELECT pending_remote_stock, available_stock FROM branch_stock WHERE branch_id=$1 AND product_variant_id=$2",
      [homeBranchId, VARIANT_ID]
    );
    expect(Number(holdsBefore.rows[0].pending_remote_stock)).toBe(0);
    expect(Number(holdsBefore.rows[0].available_stock)).toBe(5);
    const redemptionsBefore = await pool.query(
      "SELECT count(*)::int AS n FROM discount_redemption WHERE offer_id=$1 AND client_id=$2",
      [SMALL_OFFER_ID, clientId]
    );
    expect(redemptionsBefore.rows[0].n).toBe(0);

    // Place order: acknowledgement wajib mengikat candidate fingerprint token.
    await page.route("**/checkout/payment-test?*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
      return route.fulfill({
        status: 302,
        headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
      });
    });
    let placedBody: Record<string, unknown> = {};
    let payload: { success: boolean; orderId?: string; code?: string; error?: string } = {
      success: false,
    };
    await page.route("**/api/checkout/place-order", async (route) => {
      placedBody = route.request().postDataJSON() as Record<string, unknown>;
      const response = await route.fetch();
      payload = await response.json();
      await route.fulfill({ response });
    });
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/checkout/place-order")),
      page.getByRole("button", { name: "Bayar Sekarang" }).click(),
    ]);
    expect(payload.success, `place-order failed: ${payload.error ?? payload.code}`).toBe(true);
    const orderId = payload.orderId as string;
    fixtureOrderIds.add(orderId);

    const acknowledgements = (placedBody.acknowledgements ?? {}) as {
      promoIncrease?: { candidateFingerprint?: string };
      continueWithoutPromo?: { candidateFingerprint?: string };
    };
    expect(acknowledgements.promoIncrease?.candidateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(acknowledgements.continueWithoutPromo).toBeUndefined();
    const tokenPayload = JSON.parse(
      Buffer.from(String(placedBody.reviewToken).split(".")[0], "base64url").toString("utf8")
    ) as Record<string, unknown>;
    expect(tokenPayload.inc).toBe(1);
    expect(tokenPayload.fp).toBe(acknowledgements.promoIncrease?.candidateFingerprint);

    const order = await pool.query(
      "SELECT total, discount, ppn_amount FROM orders WHERE id=$1",
      [orderId]
    );
    expect(Number(order.rows[0].total)).toBe(TOTAL_AFTER_SMALL);
    expect(Number(order.rows[0].discount)).toBe(SMALL_BENEFIT);
    expect(Number(order.rows[0].ppn_amount)).toBe(PPN_AFTER_SMALL);
    const redemption = await pool.query(
      "SELECT offer_id, benefit_amount, status FROM discount_redemption WHERE order_id=$1",
      [orderId]
    );
    expect(redemption.rows).toEqual([
      { offer_id: SMALL_OFFER_ID, benefit_amount: "10000.00", status: "reserved" },
    ]);

    // Same-key replay mengembalikan order yang sama; intent berbeda (ack lain) 409.
    const replay = await storeContext.request.post(
      `${STORE_BASE_URL}/api/checkout/place-order`,
      { data: placedBody }
    );
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data?.orderId).toBe(orderId);
    const conflict = await storeContext.request.post(
      `${STORE_BASE_URL}/api/checkout/place-order`,
      {
        data: {
          ...placedBody,
          acknowledgements: { promoIncrease: { candidateFingerprint: "0".repeat(64) } },
        },
      }
    );
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).code).toBe("REQUEST_KEY_CONFLICT");

    // T06 slice: Coupon yang berubah setelah order tersimpan tidak me-reprice
    // replay accepted request; snapshot order tetap authority.
    await setOfferState(SMALL_OFFER_ID, "paused");
    try {
      const replayAfterPause = await storeContext.request.post(
        `${STORE_BASE_URL}/api/checkout/place-order`,
        { data: placedBody }
      );
      expect(replayAfterPause.status()).toBe(200);
      expect((await replayAfterPause.json()).data?.orderId).toBe(orderId);
      const persisted = await pool.query("SELECT total FROM orders WHERE id=$1", [orderId]);
      expect(Number(persisted.rows[0].total)).toBe(TOTAL_AFTER_SMALL);
    } finally {
      await setOfferState(SMALL_OFFER_ID, "enabled");
    }
  });

  test("mengganti ke benefit lebih besar menurunkan total final dan langsung diterapkan tanpa dialog", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    await reachPaymentStep(page);
    await choosePromo(page, /Mock Hemat 10/);
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
    await expect(page.getByText(rupiah(TOTAL_AFTER_SMALL)).first()).toBeVisible();

    const replacementResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkout/preview") &&
        (response.request().postData() ?? "").includes("\"previous\"")
    );
    await choosePromo(page, /Mock Hemat 25/);
    const preview = await replacementResponse;
    expect(preview.status()).toBe(200);
    const body = await preview.json();
    expect(body.data.requiresIncreaseConfirmation).toBe(false);
    expect(body.data.replacement).toMatchObject({
      direction: "decrease",
      deltaTotal: `-${INCREASE_DELTA}`,
    });

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();
  });

  test("Offer dipause setelah review: alasan jelas, tidak ada order, Lanjut tanpa promo eksplisit lalu place order tanpa promo", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    try {
      await reviewWithCoupon25(page);

      // Clock/Offer fixture: Offer yang direview dipause sebelum pembayaran.
      await setOfferState(OFFER_ID, "paused");
      // Melepas promo memicu preview "previous" dan ditolak server: state gugur
      // tampil di langkah pembayaran, bukan order diam-diam tanpa promo.
      const rejected = page.waitForResponse((response) =>
        response.url().endsWith("/api/checkout/preview") &&
        (response.request().postData() ?? "").includes("\"previous\"")
      );
      await page.getByRole("button", { name: "Lepas promo" }).click();
      const rejection = await rejected;
      expect(rejection.status()).toBe(409);
      expect((await rejection.json()).code).toBe("PROMO_UNAVAILABLE");
      await expect(page.getByText("Promo sebelumnya tidak lagi berlaku").first()).toBeVisible();
      await expect(
        page.getByText("Promo ini sudah tidak tersedia untuk pesanan kamu.")
      ).toBeVisible();
      // Breakdown yang tampil bukan lagi total berdiskon (fallback 166500).
      await expect(page.getByText(rupiah(TOTAL_WITHOUT_PROMO)).first()).toBeVisible();
      await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);

      // Lanjut tanpa promo eksplisit → review baru dengan total penuh. Tunggu
      // review selesai sebelum mencentang, karena review baru me-reset konfirmasi.
      const rereview = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/checkout/preview") &&
          (response.request().postData() ?? "").includes("acknowledgeInvalidation")
      );
      await page.getByRole("button", { name: "Lanjut tanpa promo" }).click();
      expect((await rereview).ok()).toBe(true);
      await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
      await expect(page.getByText(rupiah(TOTAL_WITHOUT_PROMO)).first()).toBeVisible();
      await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);

      await page.route("**/checkout/payment-test?*", (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
        return route.fulfill({
          status: 302,
          headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
        });
      });
      let placedBody: Record<string, unknown> = {};
      let payload: { success: boolean; orderId?: string; code?: string; error?: string } = {
        success: false,
      };
      await page.route("**/api/checkout/place-order", async (route) => {
        placedBody = route.request().postDataJSON() as Record<string, unknown>;
        const response = await route.fetch();
        payload = await response.json();
        await route.fulfill({ response });
      });
      await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
      await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith("/api/checkout/place-order")
        ),
        page.getByRole("button", { name: "Bayar Sekarang" }).click(),
      ]);
      expect(payload.success, `place-order failed: ${payload.error ?? payload.code}`).toBe(true);
      const orderId = payload.orderId as string;
      fixtureOrderIds.add(orderId);

      const acknowledgements = (placedBody.acknowledgements ?? {}) as {
        promoIncrease?: { candidateFingerprint?: string };
        continueWithoutPromo?: { candidateFingerprint?: string };
      };
      expect(acknowledgements.continueWithoutPromo?.candidateFingerprint).toMatch(
        /^[a-f0-9]{64}$/
      );
      expect(acknowledgements.promoIncrease).toBeUndefined();
      const tokenPayload = JSON.parse(
        Buffer.from(String(placedBody.reviewToken).split(".")[0], "base64url").toString("utf8")
      ) as Record<string, unknown>;
      expect(tokenPayload.cwo).toBe(1);
      expect(tokenPayload.fp).toBe(acknowledgements.continueWithoutPromo?.candidateFingerprint);
      expect((placedBody.promoSelection as { kind?: string }).kind).toBe("none");

      const order = await pool.query("SELECT total, discount FROM orders WHERE id=$1", [orderId]);
      expect(Number(order.rows[0].total)).toBe(TOTAL_WITHOUT_PROMO);
      expect(Number(order.rows[0].discount)).toBe(0);
      const redemption = await pool.query(
        "SELECT count(*)::int AS n FROM discount_redemption WHERE order_id=$1",
        [orderId]
      );
      expect(redemption.rows[0].n).toBe(0);
    } finally {
      await setOfferState(OFFER_ID, "enabled");
    }
  });

  test("kandidat unavailable tidak mengganti pilihan lama; kuota habis saat commit 409 tanpa order/stock parsial", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    await reviewWithCoupon25(page);

    // Open and load before pausing, so this actually exercises a stale displayed candidate.
    await openPromoPicker(page);
    await expect(page.getByRole("radio", { name: /Mock Hemat 10/ })).toBeEnabled();
    await setOfferState(SMALL_OFFER_ID, "paused");
    try {
      const candidateResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/checkout/preview") &&
          (response.request().postData() ?? "").includes("\"previous\"")
      );
      // Rejection memicu reload picker; tunggu reload itu selesai SEBELUM kuota
      // diubah, supaya invalidation state tidak bergantung pada urutan jaringan.
      const pickerReload = page.waitForResponse((response) =>
        response.url().endsWith("/api/discounts/available")
      );
      await choosePromo(page, /Mock Hemat 10/);
      const rejection = await candidateResponse;
      expect(rejection.status()).toBe(409);
      expect((await rejection.json()).code).toBe("PROMO_UNAVAILABLE");
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Batal", exact: true }).click();
      await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
      await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();
      await pickerReload;
    } finally {
      await setOfferState(SMALL_OFFER_ID, "enabled");
    }

    // Kuota habis di antara review dan commit (disimulasikan pemakai lain).
    const ordersBefore = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE user_id=$1",
      [clientId]
    );
    await pool.query(
      `UPDATE discount_offer_usage
          SET reserved_count = (SELECT quota_count FROM discount_offer WHERE id=$1)
        WHERE offer_id=$1`,
      [OFFER_ID]
    );
    try {
      let payload: { success: boolean; orderId?: string; code?: string; error?: string } = {
        success: false,
      };
      await page.route("**/api/checkout/place-order", async (route) => {
        const response = await route.fetch();
        payload = await response.json();
        await route.fulfill({ response });
      });
      await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
      await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith("/api/checkout/place-order")
        ),
        page.getByRole("button", { name: "Bayar Sekarang" }).click(),
      ]);
      expect(payload.success).toBe(false);
      expect(payload.code).toBe("PROMO_CAPACITY_UNAVAILABLE");
      expect(payload.orderId).toBeUndefined();

      const ordersAfter = await pool.query(
        "SELECT count(*)::int AS n FROM orders WHERE user_id=$1",
        [clientId]
      );
      expect(ordersAfter.rows[0].n).toBe(ordersBefore.rows[0].n);
      const redemptions = await pool.query(
        "SELECT count(*)::int AS n FROM discount_redemption WHERE offer_id=$1 AND client_id=$2",
        [OFFER_ID, clientId]
      );
      expect(redemptions.rows[0].n).toBe(0);
      const stock = await pool.query(
        "SELECT available_stock FROM branch_stock WHERE branch_id=$1 AND product_variant_id=$2",
        [homeBranchId, VARIANT_ID]
      );
      expect(stock.rows[0].available_stock).toBe(5);

      // UI tidak menampilkan applied state palsu: tetap di langkah pembayaran
      // dengan state gugur + rincian perlu diperiksa ulang, tombol bayar mati
      // (bukan order tanpa promo diam-diam).
      await expect(page.getByText("Promo sebelumnya tidak lagi berlaku").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Periksa ulang pesanan" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Bayar Sekarang" })).toBeDisabled();
    } finally {
      await pool.query(
        "UPDATE discount_offer_usage SET reserved_count=0, reserved_amount='0' WHERE offer_id=$1",
        [OFFER_ID]
      );
    }
  });
  test("perubahan selection membatalkan approval lama; kandidat tidak dibandingkan lintas konteks", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    await reviewWithCoupon25(page);

    // Cart berubah (quantity 1→2) setelah review: konteks fingerprint lama gugur.
    const cart = await storeContext.request.get(`${STORE_BASE_URL}/api/cart`);
    const cartBody = await cart.json();
    const itemId = (cartBody.data.items as Array<{ id: string }>)[0].id;
    const patched = await storeContext.request.put(
      `${STORE_BASE_URL}/api/cart/items/${itemId}`,
      { data: { quantity: 2 } }
    );
    expect(patched.ok(), `cart update failed: ${patched.status()}`).toBe(true);

    const staleResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/checkout/preview") &&
        (response.request().postData() ?? "").includes("\"previous\"")
    );
    await choosePromo(page, /Mock Hemat 10/);
    const stale = await staleResponse;
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("CHECKOUT_REVIEW_REQUIRED");

    // Approval lama gugur: kembali ke langkah input, tanpa total berdiskon palsu.
    await expect(page.getByRole("heading", { name: "Cara Pengiriman", exact: true })).toBeVisible();
    await expect(page.getByText(/Promo dipakai:/)).toHaveCount(0);

    // Draft kandidat dibuang ketika konteks berubah. Review baru memvalidasi ulang
    // promo aktif lama: qty2, 300000 - 25000 + PPN30250 = 305250.
    await page.getByRole("button", { name: "Lanjut", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
    await expect(page.getByText(rupiah(305_250)).first()).toBeVisible();
    await expect(page.getByText(/Promo dipakai:/)).toContainText("Mock Hemat 25");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });


  test("Manual Promo Code: Terapkan, kode invalid mempertahankan pilihan, ganti valid lalu place+detail", async () => {
    const page = await storeContext.newPage();
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID,
      onHand: 5,
      sellPrice: GOODS,
    });

    await reachPaymentStep(page);
    await enterPromoCode(page, " manualmock25 ");

    // Kode canonical (trim+uppercase) diterapkan dan total memakai benefit 25000.
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();
    await expect(page.getByText(MANUAL_CODE)).toBeVisible();

    // Kode unknown TIDAK mengganti pilihan lama yang masih sah.
    await enterPromoCode(page, "NOPE999");
    await expect(page.getByRole("alert").filter({ hasText: /tidak tersedia|tidak dapat/i })).toBeVisible();
    await expect(page.getByText(MANUAL_CODE)).toBeVisible();
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();
    const noRedemption = await pool.query(
      "SELECT count(*)::int AS count FROM discount_redemption WHERE offer_id=$1",
      [MANUAL_OFFER_ID]
    );
    expect(noRedemption.rows[0].count).toBe(0);

    // Ganti ke Coupon publik benefit lebih kecil: total naik → dialog, batal
    // mempertahankan kode manual dan total lamanya.
    await choosePromo(page, /Mock Hemat 10/);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(rupiah(TOTAL));
    await expect(dialog).toContainText(rupiah(TOTAL_AFTER_SMALL));
    await dialog.getByRole("button", { name: /Batal|Tidak/ }).click();
    await expect(page.getByText(MANUAL_CODE)).toBeVisible();
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();

    // Batal di tahap kenaikan kembali ke draft; tutup picker sebelum melanjutkan checkout.
    await expect(page.getByRole("dialog", { name: "Pilih promo", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Batal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
    await page.route("**/checkout/payment-test?*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === STORE_BASE_URL) return route.fallback();
      return route.fulfill({
        status: 302,
        headers: { location: `${STORE_BASE_URL}/checkout/payment-test${requestUrl.search}` },
      });
    });
    let payload: { success: boolean; orderId?: string; error?: string } = { success: false };
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
    expect(payload.success, `place-order manual gagal: ${payload.error ?? "unknown"}`).toBe(true);
    const orderId = payload.orderId as string;
    fixtureOrderIds.add(orderId);

    // DB truth: tepat satu Redemption manual yang menyebut code_id kode itu.
    const redemption = await pool.query(
      `SELECT activation_kind, code_id, offer_id, status, benefit_amount
         FROM discount_redemption WHERE order_id=$1`,
      [orderId]
    );
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0]).toMatchObject({
      activation_kind: "manual_only",
      code_id: MANUAL_CODE_ID,
      offer_id: MANUAL_OFFER_ID,
      status: "reserved",
      benefit_amount: "25000.00",
    });
    const allocations = await pool.query(
      "SELECT component, amount FROM order_discount_allocation WHERE order_id=$1",
      [orderId]
    );
    expect(allocations.rows).toEqual([{ component: "offer_goods", amount: "25000.00" }]);
    const usage = await pool.query(
      "SELECT reserved_count, consumed_count, reserved_amount FROM discount_offer_usage WHERE offer_id=$1",
      [MANUAL_OFFER_ID]
    );
    expect(usage.rows[0]).toMatchObject({ reserved_count: 1, consumed_count: 0, reserved_amount: "25000.00" });

    // Response body order milik customer ini mengungkap HANYA kode yang dipakai.
    const detail = await storeContext.request.get(`/api/orders/${orderId}`);
    expect(detail.ok(), await detail.text()).toBe(true);
    const detailBody = (await detail.json()) as {
      data?: { promo?: { activationKind?: string; code?: string | null } };
    };
    expect(detailBody.data?.promo).toMatchObject({
      activationKind: "manual_only",
      code: MANUAL_CODE,
    });
    const bodyText = JSON.stringify(detailBody);
    expect(bodyText).not.toContain("MANUALOFF25");

    // Redirect payment mock bisa memulai navigasi setelah place-order; tunggu
    // navigasi itu selesai sebelum membuka halaman detail supaya goto tidak
    // diinterupsi.
    await page
      .waitForURL("**/checkout/payment-test**", { timeout: 15_000 })
      .catch(() => {});
    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByText("Status promo")).toBeVisible();
    await expect(page.getByText("Diskon promo (Mock Kode Manual 25)", { exact: true })).toBeVisible();
  });


  test("Manual code dinonaktifkan setelah review: alasan jelas, Lanjut tanpa promo eksplisit, tanpa order", async () => {
    const page = await storeContext.newPage();
    await ensureStock();
    await reachPaymentStep(page);
    await enterPromoCode(page, MANUAL_CODE);
    await expect(page.getByText(rupiah(TOTAL)).first()).toBeVisible();

    const ordersBefore = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE user_id=$1",
      [clientId]
    );
    await pool.query(
      "UPDATE discount_code SET state='inactive', version=version+1 WHERE id=$1",
      [MANUAL_CODE_ID]
    );
    try {
      // Lepas kode memicu preview "previous"; server menolak karena kode gugur
      // dan menuntut Lanjut tanpa promo eksplisit (bukan order diam-diam).
      const previewPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/checkout/preview") &&
          (response.request().postData() ?? "").includes('"previous"')
      );
      await page.getByRole("button", { name: "Lepas promo" }).click();
      const previewResponse = await previewPromise;
      expect(previewResponse.status()).toBe(409);
      await expect(page.getByText("Promo sebelumnya tidak lagi berlaku").first()).toBeVisible();
      await expect(page.getByText(/tidak tersedia/i).first()).toBeVisible();

      await page.getByRole("button", { name: "Lanjut tanpa promo" }).click();
      await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
      await expect(page.getByText(rupiah(TOTAL_WITHOUT_PROMO)).first()).toBeVisible();
      await expect(page.getByText(MANUAL_CODE)).toHaveCount(0);

      const ordersAfter = await pool.query(
        "SELECT count(*)::int AS n FROM orders WHERE user_id=$1",
        [clientId]
      );
      expect(ordersAfter.rows[0].n).toBe(ordersBefore.rows[0].n);
      const redemption = await pool.query(
        "SELECT count(*)::int AS n FROM discount_redemption WHERE offer_id=$1",
        [MANUAL_OFFER_ID]
      );
      expect(redemption.rows[0].n).toBe(0);
    } finally {
      await pool.query(
        "UPDATE discount_code SET state='active', version=version+1 WHERE id=$1",
        [MANUAL_CODE_ID]
      );
    }
  });

});
