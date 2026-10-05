/**
 * Ticket 03 — mock-only delivery quote in checkout (browser + HTTP + control
 * seams). NO delivery order and NO payment is ever placed (ticket 04 binds
 * that); this spec only creates cart/address/branch fixtures and requests the
 * quote.
 *
 * Proven contract (spec Ready "Harga dan UX quote", acceptance 03):
 * - The checkout offers the two methods — "Ambil di cabang" / "Kirim ke
 *   alamat" (proposed labels). Choosing delivery reveals an address selector
 *   and the "Periksa ongkir" trigger.
 * - The ONLY service from the mock (rate-normal) renders as "JNE REG Fixture"
 *   and the money uses the vendor `rates` — independent case: controlled
 *   Rp100.000 item, mock rates Rp20.000 (final_rates Rp10.000 as a trap) →
 *   ongkir "Rp 20.000", delivery PPN "Rp 13.200" (11% over goods+ongkir,
 *   per-Rupiah ceil), total "Rp 133.200" — pickup stays untouched at its own
 *   math and is never replaced by a zero fallback. The picker displays each
 *   quote's ongkir; only the selected service updates the checkout summary.
 * - The browser POST is only {itemIds, addressId} — money is re-derived
 *   server-side (the quote endpoint loads the owned cart/address/branch/SKU/
 *   config itself).
 * - Changing the ADDRESS invalidates the old selection and holds continuation
 *   while the new quote is pending (observed deterministically through a
 *   Playwright interception delay); the service must be re-picked afterwards.
 * - After a cart QUANTITY change the old money must be gone; a new quote
 *   prices the new subtotal (2 × 100.000 + 20.000 → PPN 24.200, total
 *   244.200). A failed/EMPTY quote then offers "Coba lagi" and the pickup
 *   alternative stays available — with no stale ongkir/total.
 *
 * Isolated mock config ONLY (ports 3110/3111/3112, loopback-guarded); the
 * mocked Shipment endpoints `auth/generate-token` + `rates/all` and the
 * /__control/shipment fixture modes (rate-normal / rate-empty / rate-failure)
 * plus separate fake Shipment credentials are implemented by the main agent —
 * until then the quote cannot work: that IS the red (method/labels/trigger
 * absent, quote requests fail).
 *
 * Run with the isolated mock config (the parent selects the spec):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
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
      "delivery-quote-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_API_BASE_URL set"
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
        `delivery-quote-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Proposed UI copy (RED until main implements the delivery choice UI)
// ---------------------------------------------------------------------------

const OPTION_DELIVERY = "Kirim ke alamat";
const OPTION_PICKUP = "Ambil di cabang";
const ADDRESS_SELECT_LABEL = "Alamat Pengiriman";
const CHECK_ONGKIR = /Periksa ongkir/;
const RETRY_LABEL = /Coba lagi/;
const SERVICE_LABEL = "JNE REG Fixture";

// Independent money literals (spec worked case):
//   T1: subtotal 100.000 + ongkir 20.000 → PPN 13.200 → total 133.200
//   T2: subtotal 200.000 + ongkir 20.000 → PPN 24.200 → total 244.200
const ONGKIR_LABEL = "Rp 20.000";
const PPN_CASE1 = "Rp 13.200";
const TOTAL_CASE1 = "Rp 133.200";
const STALE_TOTAL_CASE1 = TOTAL_CASE1;
const PPN_CASE2 = "Rp 24.200";
const TOTAL_CASE2 = "Rp 244.200";

// ---------------------------------------------------------------------------
// Fixtures (own rows only; seeded data is never reset)
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "e2e-delivery-quote";
const FIXTURE_PRODUCT_ID = `${FIXTURE_PREFIX}-product`;
const FIXTURE_VARIANT_ID = `${FIXTURE_PREFIX}-variant`;
const FIXTURE_VARIANT_SKU = "DELIVQ-01";
const ORIGIN_BRANCH_ID = `${FIXTURE_PREFIX}-branch`;
const ORIGIN_BRANCH = {
  name: "E2E Origin Delivery Branch",
  code: "E2EQTE",
  status: "aktif",
  // The configured local origin complement (branch-edit slice contract).
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 7, Gudang B",
  shippingPostalCode: "10110",
  shippingAreaId: "01010101",
} as const;

const ADDRESS_STREETS = [
  "Jl. Delivery Quote E2E No. 1",
  "Jl. Delivery Quote E2E No. 2",
] as const;

// Shipment region chain from the ticket-02 mock fixture (server-verified at
// address creation): province '01' … area '01010101', postal '01234'.
const ADDRESS_CHAIN = {
  provinceId: "01",
  cityId: "0101",
  districtId: "010101",
  areaId: "01010101",
  postalCode: "01234",
} as const;

let pool: Pool;
let oldPackaging: { value: string; type: string; description: string | null } | undefined;
let johnContext: BrowserContext;
let addressIdOne = "";
// Set in test 1: the observed browser quote request (never browser money).
const quotePayloads: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const response = await context.request.post(
    `${base}/api/auth/sign-in/email`,
    {
      data: { email: identifier, password },
    }
  );
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
    headers: { "content-type": "application/json" },
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

function unwrapId(payload: unknown): string {
  const candidates = [payload, (payload as { data?: unknown })?.data];
  for (const candidate of candidates) {
    const id = (candidate as Record<string, unknown> | null)?.id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  throw new Error(
    `address create must return the id: ${JSON.stringify(payload).slice(0, 200)}`
  );
}

/** Delays the NEXT delivery-quote responses so the pending window is observable. */
async function delayQuoteResponses(page: import("@playwright/test").Page, ms: number): Promise<void> {
  await page.route("**/api/checkout/delivery-quote", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });
}

/** Continuation control on the delivery step (Lanjut or Bayar Sekarang). */
function continueButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /Lanjut|Bayar/ }).last();
}

async function pickDeliveryMethodAndAddress(page: import("@playwright/test").Page, street: string): Promise<void> {
  await page.getByText(OPTION_DELIVERY, { exact: true }).click();
  await page.getByLabel(ADDRESS_SELECT_LABEL).click();
  await page.getByRole("option", { name: new RegExp(street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const packaging = await pool.query("SELECT value, type, description FROM system_config WHERE key = 'shipment.packagingWeightGrams'");
  oldPackaging = packaging.rows[0];
  await pool.query("INSERT INTO system_config (key,value,type) VALUES ('shipment.packagingWeightGrams','40','number') ON CONFLICT (key) DO UPDATE SET value='40',type='number'");

  // Deterministic fixture branch: ACTIVE, locally mapped, WITH a shipping
  // origin complement (the seeded branches stay origin-NULL / not ready).
  await pool.query(`DELETE FROM branch WHERE code LIKE '${ORIGIN_BRANCH.code}%'`);
  await pool.query(
    `INSERT INTO branch
       (id, name, code, city, address, status, shipping_phone, shipping_address,
        shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 900001)`,
    [
      ORIGIN_BRANCH_ID,
      ORIGIN_BRANCH.name,
      ORIGIN_BRANCH.code,
      "Jakarta Pusat",
      "Jl. Fixture E2E Edit No. 1",
      ORIGIN_BRANCH.status,
      ORIGIN_BRANCH.shippingPhone,
      ORIGIN_BRANCH.shippingAddress,
      ORIGIN_BRANCH.shippingPostalCode,
      ORIGIN_BRANCH.shippingAreaId,
    ]
  );

  // Own fixture branch is open every day, independently of seeded hours.
  await pool.query("UPDATE branch SET operating_hours = $1 WHERE id = $2", [
    JSON.stringify(Object.fromEntries([
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    ].map((day) => [day, { open: "09:00", close: "18:00" }]))), ORIGIN_BRANCH_ID,
  ]);

  // Fixture goods at the origin branch: one Rp100.000 variant with REAL per-SKU
  // master parcel dims (250 g / 30×20×10 cm) — synced-style normalized master.
  await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Delivery Quote Anchor', $2, '100000.00', 'aktif')`,
    [FIXTURE_PRODUCT_ID, `${FIXTURE_PREFIX}-anchor`]
  );
  await pool.query(
    `INSERT INTO product_variant
       (id, product_id, sku, price, is_default, parcel_dimensions, jubelio_item_id)
     VALUES ($1, $2, $3, '100000.00', true, $4, 900001)`,
    [
      FIXTURE_VARIANT_ID,
      FIXTURE_PRODUCT_ID,
      FIXTURE_VARIANT_SKU,
      JSON.stringify({ weight: 250, length: 30, width: 20, height: 10 }),
    ]
  );
  const stock = await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, 5, 0, 0, 0, 0, 5, NOW())
     RETURNING branch_id`,
    [ORIGIN_BRANCH_ID, FIXTURE_VARIANT_ID]
  );
  expect(stock.rowCount, "fixture branch_stock must insert").toBe(1);

  johnContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(
    johnContext,
    STORE_BASE_URL,
    TEST_USERS.store.email,
    TEST_USERS.store.password
  );

  // Two fixture addresses for the signed-in customer (region chain above).
  for (const [index, street] of ADDRESS_STREETS.entries()) {
    const create = await johnContext.request.post("/api/addresses", {
      data: {
        recipientName: `E2E Quote Penerima ${index + 1}`,
        phone: "08130000000" + (index + 1),
        fullAddress: street,
        ...ADDRESS_CHAIN,
        isDefault: false,
      },
    });
    expect(
      create.ok(),
      `fixture address create failed: ${await create.text()}`
    ).toBe(true);
    const id = unwrapId(await create.json());
    if (index === 0) addressIdOne = id;
  }
  // The first address id feeds the quote payload probe below.
  expect(addressIdOne.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
  if (pool) {
    // Own rows only: cart items of the fixture variant, the fixture stock/
    // product/branch cascade and the two fixture addresses.
    await pool.query(`DELETE FROM cart_item WHERE variant_id = $1`, [
      FIXTURE_VARIANT_ID,
    ]);
    await pool.query(`DELETE FROM branch_stock WHERE branch_id LIKE '${FIXTURE_PREFIX}%'`);
    await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
    await pool.query(`DELETE FROM branch WHERE code LIKE '${ORIGIN_BRANCH.code}%'`);
    await pool.query(
      `DELETE FROM address WHERE full_address LIKE 'Jl. Delivery Quote E2E No.%'`
    );
    if (oldPackaging) await pool.query("UPDATE system_config SET value=$1,type=$2,description=$3 WHERE key='shipment.packagingWeightGrams'", [oldPackaging.value, oldPackaging.type, oldPackaging.description]);
    else await pool.query("DELETE FROM system_config WHERE key='shipment.packagingWeightGrams'");
    await pool.end();
  }
  await johnContext?.close().catch(() => {});
});

test.describe("mock-only delivery quote checkout (ticket 03)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    // Each case starts from a single-item cart even when previous cases added
    // the same variant; otherwise a quote for one unit becomes four units.
    const cart = await (await johnContext!.request.get("/api/cart")).json();
    for (const row of cart.data?.items ?? []) {
      if (row.variantId === FIXTURE_VARIANT_ID) {
        await johnContext!.request.delete(`/api/cart/items/${row.id}`);
      }
    }
    // Controlled shipment fixture: exactly ONE honest service
    // (JNE REG Fixture, rates 20.000 / final_rates 10.000 as the trap).
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal" })).status
    ).toBe("ok");
  });

  test("checkout starts with fulfillment and validates pickup before contact", async () => {
    test.setTimeout(90_000);
    const add = await johnContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await johnContext.newPage();
    try {
      await page.goto("/cart");
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL("**/checkout");
      await expect(page.getByRole("heading", { name: "Cara Pengiriman", exact: true })).toBeVisible();
      await expect(page.getByText("Barang yang akan di-checkout", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Nomor Telepon *")).toBeHidden();
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Informasi Kontak" })).toBeHidden();
      const date = new Date();
      date.setDate(date.getDate() + 1);
      const pickupDate = date.toISOString().slice(0, 10);
      await page.getByLabel("Tanggal Pickup *").fill(pickupDate);
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: "10:00", exact: true }).click();
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Informasi Kontak" })).toBeVisible();
      await expect(page.getByText("Isi kontak yang aktif untuk pesanan dan pengambilan di cabang.", { exact: true })).toBeVisible();
      await expect(page.getByText("Kode pickup akan dikirim ke email ini setelah pesanan siap diambil.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Isi dari Profil" })).toBeVisible();
      await page.getByLabel("Nomor Telepon *").fill("123");
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByText("Masukkan nomor telepon yang valid (8–15 angka).", { exact: true })).toBeVisible();
      await page.getByLabel("Nomor Telepon *").fill("081234567890");
      await page.getByLabel("Email *").fill("invalid");
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByText("Masukkan alamat email yang valid.", { exact: true })).toBeVisible();
      await page.getByLabel("Email *").fill(TEST_USERS.store.email);
      await page.getByRole("button", { name: "Kembali", exact: true }).click();
      await expect(page.getByLabel("Tanggal Pickup *")).toHaveValue(pickupDate);
      await expect(page.getByRole("combobox")).toContainText("10:00");
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByLabel("Nomor Telepon *")).toHaveValue("081234567890");
      await expect(page.getByLabel("Email *")).toHaveValue(TEST_USERS.store.email);
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Kembali", exact: true }).click();
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByRole("checkbox")).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Bayar Sekarang" })).toBeDisabled();
    } finally {
      await page.close();
    }
  });

  test("a late pickup validation cannot skip delivery selection after switching methods", async () => {
    test.setTimeout(90_000);
    const add = await johnContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await johnContext.newPage();
    let releaseValidation!: () => void;
    let validationStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const started = new Promise<void>((resolve) => { validationStarted = resolve; });
    await page.route("**/api/checkout/validate-step-2", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      validationStarted();
      await release;
      await route.fulfill({ response });
    });
    try {
      await page.goto("/cart");
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL("**/checkout");
      const date = new Date();
      date.setDate(date.getDate() + 1);
      await page.getByLabel("Tanggal Pickup *").fill(date.toISOString().slice(0, 10));
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: "10:00", exact: true }).click();
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await started;
      await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);
      const completed = page.waitForResponse((response) => response.url().endsWith("/api/checkout/validate-step-2"));
      releaseValidation();
      await completed;
      // The next user action must still be possible on the fulfillment step,
      // rather than being stranded on contact with no approved service.
      await page.getByRole("radio", { name: /JNE REG Fixture/ }).check();
      await page.getByRole("button", { name: "Lanjut", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Informasi Kontak" })).toBeVisible();
    } finally {
      releaseValidation();
      await page.close();
    }
  });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`delivery contact distinguishes the recipient and preserves choices across steps (${viewport.width}px)`, async () => {
      test.setTimeout(90_000);
      const add = await johnContext.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok()).toBe(true);
      const page = await johnContext.newPage();
      await page.setViewportSize(viewport);
      try {
        await page.goto("/cart");
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Checkout" }).click();
        await page.waitForURL("**/checkout");
        await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);
        const next = page.getByRole("button", { name: "Lanjut", exact: true });
        await expect(next).toBeDisabled();
        await page.getByRole("radio", { name: /JNE REG Fixture/ }).check();
        await next.click();
        await expect(page.getByRole("heading", { name: "Informasi Kontak" })).toBeVisible();
        await expect(page.getByText("Isi kontak pemesan yang aktif untuk keperluan pesanan dan pembayaran.", { exact: true })).toBeVisible();
        await expect(page.getByText("Kontak ini adalah kontak pemesan. Pengiriman menggunakan nama dan nomor penerima pada alamat yang Anda pilih.", { exact: true })).toBeVisible();
        await expect(page.getByText(/kode pickup|mengambil pesanan/i)).toHaveCount(0);
        await page.getByLabel("Nomor Telepon *").fill("123");
        await next.click();
        await expect(page.getByText("Masukkan nomor telepon yang valid (8–15 angka).", { exact: true })).toBeVisible();
        await page.getByLabel("Nomor Telepon *").fill("081234567890");
        await page.getByLabel("Email *").fill("pemesan@example.test");
        await next.click();
        const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
        await expect(review.getByText("Kontak Pemesan", { exact: true })).toBeVisible();
        await expect(review.getByText("Penerima Pengiriman", { exact: true })).toBeVisible();
        await expect(review.getByText("081234567890", { exact: true })).toBeVisible();
        await expect(review.getByText("E2E Quote Penerima 1 · 081300000001", { exact: true })).toBeVisible();
        await expect(review.getByText(TOTAL_CASE1, { exact: true })).toBeVisible();
        await page.getByRole("checkbox").check();
        await page.getByRole("button", { name: "Kembali", exact: true }).click();
        await expect(page.getByLabel("Email *")).toHaveValue("pemesan@example.test");
        await page.getByRole("button", { name: "Kembali", exact: true }).click();
        await expect(page.getByRole("radio", { name: /JNE REG Fixture/ })).toBeChecked();
        await expect(page.getByLabel(ADDRESS_SELECT_LABEL)).toContainText(ADDRESS_STREETS[0]);
        const summary = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
        await expect(summary.getByText(TOTAL_CASE1, { exact: true })).toBeVisible();
        await next.click();
        await next.click();
        await expect(page.getByRole("checkbox")).not.toBeChecked();
        await expect(page.getByRole("button", { name: "Bayar Sekarang" })).toBeDisabled();
        await page.getByRole("button", { name: "Kembali", exact: true }).click();
        await page.getByRole("button", { name: "Kembali", exact: true }).click();
        await page.getByText(OPTION_PICKUP, { exact: true }).click();
        await expect(summary.getByText(TOTAL_CASE1, { exact: true })).toHaveCount(0);
        const date = new Date();
        date.setDate(date.getDate() + 1);
        await page.getByLabel("Tanggal Pickup *").fill(date.toISOString().slice(0, 10));
        await page.getByRole("combobox").click();
        await page.getByRole("option", { name: "10:00", exact: true }).click();
        await next.click();
        await expect(page.getByText("Sebutkan email dan nomor telepon ini kepada staf saat mengambil pesanan.", { exact: true })).toBeVisible();
        await expect(page.getByLabel("Nomor Telepon *")).toHaveValue("081234567890");
        await page.getByRole("button", { name: "Kembali", exact: true }).click();
        await page.getByText(OPTION_DELIVERY, { exact: true }).click();
        await expect(next).toBeDisabled();
        await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await page.close();
      }
    });

    test(`fulfillment cards separate titles from descriptions (${viewport.width}px)`, async () => {
      test.setTimeout(60_000);
      const add = await johnContext!.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok()).toBe(true);
      const page = await johnContext!.newPage();
      await page.setViewportSize(viewport);
      try {
        await page.goto("/cart");
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Checkout" }).click();
        await page.waitForURL("**/checkout");

        // Both selected and unselected cards keep their title above their
        // description, with at least a 4px gap, on desktop and mobile.
        for (const method of [OPTION_PICKUP, OPTION_DELIVERY]) {
          await page.getByText(method, { exact: true }).click();
          for (const [title, description] of [
            [OPTION_DELIVERY, "Cek layanan dan ongkir ke alamat Anda dahulu"],
            [OPTION_PICKUP, "Ambil pesanan di cabang — Gratis (Pickup)"],
          ]) {
            const card = page.getByRole("button").filter({ has: page.getByText(title, { exact: true }) });
            const heading = card.getByText(title, { exact: true });
            const detail = card.getByText(description, { exact: true });
            await expect(heading).toBeVisible();
            await expect(detail).toBeVisible();
            const headingBox = (await heading.boundingBox())!;
            const detailBox = (await detail.boundingBox())!;
            const cardBox = (await card.boundingBox())!;
            expect(detailBox.y - (headingBox.y + headingBox.height), `${title}: description must be below the title`).toBeGreaterThanOrEqual(4);
            expect(Math.abs(detailBox.x - headingBox.x)).toBeLessThanOrEqual(1);
            expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
            expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await page.close();
      }
    });

    test(`courier categories filter before pagination without changing selection (${viewport.width}px)`, async () => {
      test.setTimeout(120_000);
      const add = await johnContext!.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok(), `fixture cart add failed (${add.status()}): ${await add.text()}`).toBe(true);
      const page = await johnContext!.newPage();
      await page.setViewportSize(viewport);
      // Only the browser/server network boundary is controlled; the real quote
      // backend's metadata projection is covered separately by quoteDelivery.
      let quoteRequests = 0;
      await page.route("**/api/checkout/delivery-quote", async (route) => {
        quoteRequests += 1;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const body = await response.json();
        const base = body.data.services[0];
        // Known goods subtotal Rp100.000 and literal vendor-category/price cases.
        const options = [
          ["Reguler F", 1, 25000, "13750.00", "138750.00"],
          ["Same Day Mahal", 5, 40000, "15400.00", "155400.00"],
          ["Ekonomi A", 2, 9000, "11990.00", "120990.00"],
          ["Next Day Mahal", 3, 35000, "14850.00", "149850.00"],
          ["Reguler B", 1, 12000, "12320.00", "124320.00"],
          ["Ekonomi C", 2, 15000, "12650.00", "127650.00"],
          ["Reguler D", 1, 18000, "12980.00", "130980.00"],
          ["Ekonomi E", 2, 20000, "13200.00", "133200.00"],
          ["Same Day Murah", 5, 30000, "14300.00", "144300.00"],
          ["Next Day Murah", 3, 28000, "14080.00", "142080.00"],
          ["Same Day tanpa kategori", null, 8000, "11880.00", "119880.00"],
          ["Kategori baru", 99, 10000, "12100.00", "122100.00"],
          ["Cargo", 6, 50000, "16500.00", "166500.00"],
          ["Truk", 7, 60000, "17600.00", "177600.00"],
        ] as const;
        await route.fulfill({ response, json: {
          ...body,
          data: { services: options.map(([name, serviceCategoryId, shippingCost, ppnAmount, total], index) => ({
            ...base, courierId: index + 1, serviceId: index + 1, name, serviceCategoryId, shippingCost,
            validEta: { from: "2026-10-06T09:18:03.751Z", to: "2026-10-11T09:18:03.751Z" },
            pricing: { ...base.pricing, shippingCost: `${shippingCost}.00`,
              taxableBase: `${100000 + shippingCost}.00`, ppnAmount, total },
          })) },
        } });
      });
      try {
        await page.goto("/cart");
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Checkout" }).click();
        await page.waitForURL("**/checkout");
        await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);
        const filters = page.getByRole("group", { name: "Kategori pengiriman", exact: true });
        const filter = (name: string) => filters.getByRole("button", { name, exact: true });
        const picker = page.getByRole("group", { name: "Pilih pengiriman", exact: true });
        const summary = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
        const next = page.getByRole("button", { name: "Halaman kurir berikutnya" });
        await expect(filter("Semua · Termurah")).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
        await expect(filters.getByRole("button")).toHaveCount(6);
        await expect(filter("Instant")).toBeDisabled();
        await expect(filter("Instant")).toHaveAttribute("title", "Tidak tersedia untuk alamat ini");
        await expect(page.getByText("1–5 dari 14 layanan", { exact: true })).toBeVisible();
        await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
        const requestsBeforeFiltering = quoteRequests;
        await next.click();
        await filter("Reguler/Ekonomi").click();
        await expect(page.getByText("1–5 dari 6 layanan", { exact: true })).toBeVisible();
        await expect(picker.locator("label")).toHaveText([
          /Ekonomi A.*Rp 9.000.*Termurah/, /Reguler B.*Rp 12.000/,
          /Ekonomi C.*Rp 15.000/, /Reguler D.*Rp 18.000/, /Ekonomi E.*Rp 20.000/,
        ]);
        await next.click();
        await expect(picker.locator("label")).toHaveText([/Reguler F.*Rp 25.000/]);
        await expect(page.getByText("6–6 dari 6 layanan", { exact: true })).toBeVisible();
        await filter("Same Day").click();
        await expect(picker.locator("label")).toHaveText([
          /Same Day Murah.*Rp 30.000.*Estimasi tiba 6–11 Okt 2026.*Termurah/,
          /Same Day Mahal.*Rp 40.000/,
        ]);
        await expect(next).toHaveCount(0);
        await picker.getByRole("radio", { name: /Same Day Murah/ }).check();
        await expect(summary.getByText("Rp 144.300", { exact: true })).toBeVisible();
        await filter("Next Day").click();
        await expect(picker.locator("label")).toHaveText([
          /Next Day Murah.*Rp 28.000.*Estimasi tiba 6–11 Okt 2026.*Termurah/, /Next Day Mahal.*Rp 35.000/,
        ]);
        await expect(page.getByText("Terpilih: Same Day Murah", { exact: true })).toBeVisible();
        await expect(continueButton(page)).toBeEnabled();
        await expect(summary.getByText("Rp 144.300", { exact: true })).toBeVisible();
        await filter("Lainnya").click();
        await expect(picker.locator("label")).toHaveText([
          /Same Day tanpa kategori.*Rp 8.000.*Termurah/, /Kategori baru.*Rp 10.000/, /Cargo.*Rp 50.000/, /Truk.*Rp 60.000/,
        ]);
        await filter("Same Day").click();
        await expect(picker.getByRole("radio", { name: /Same Day Murah/ })).toBeChecked();
        expect(quoteRequests).toBe(requestsBeforeFiltering);
        // A changed destination restores the default category/page and clears money.
        await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[1]);
        await expect(filter("Semua · Termurah")).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByText("1–5 dari 14 layanan", { exact: true })).toBeVisible();
        await expect(continueButton(page)).toBeDisabled();
        await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
        await expect(summary.getByText("Rp 144.300", { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await page.close();
      }
    });

    test(`courier picker compares prices and preserves selection across five-option pages (${viewport.width}px)`, async () => {
      const add = await johnContext!.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok()).toBe(true);
      const page = await johnContext!.newPage();
      await page.setViewportSize(viewport);
      // Browser/server boundary: retain the real verified quote shape, replacing
      // only options with controlled display fixtures. No order is placed.
      await page.route("**/api/checkout/delivery-quote", async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const body = await response.json();
        const base = body.data.services[0];
        const options = [
          [7, 1, "Express", 40000, "15400.00", "155400.00"],
          [7, 2, "Economy", 9000, "11990.00", "120990.00"],
          [8, 2, "Regular A", 20000, "13200.00", "133200.00"],
          [9, 3, "Regular B", 12000, "12320.00", "124320.00"],
          [10, 4, "Regular C", 15000, "12650.00", "127650.00"],
          [11, 5, "Priority", 30000, "14300.00", "144300.00"],
          [12, 6, "Regular D", 18000, "12980.00", "130980.00"],
        ];
        await route.fulfill({ response, json: {
          ...body,
          data: { services: options.map(([courierId, serviceId, name, shippingCost, ppnAmount, total]) => ({
            ...base, courierId, serviceId, name, shippingCost,
            validEta: name === "Priority" ? undefined : {
              from: "2026-10-06T09:18:03.751Z", to: "2026-10-11T09:18:03.751Z",
            },
            pricing: { ...base.pricing, shippingCost: `${shippingCost}.00`,
              taxableBase: `${100000 + Number(shippingCost)}.00`, ppnAmount, total },
          })) },
        } });
      });
      try {
        await page.goto("/cart");
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Checkout" }).click();
        await page.waitForURL("**/checkout");
        await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);
        const picker = page.getByRole("group", { name: "Pilih pengiriman", exact: true });
        const summary = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
        const next = page.getByRole("button", { name: "Halaman kurir berikutnya" });
        const previous = page.getByRole("button", { name: "Halaman kurir sebelumnya" });
        await expect(picker.getByRole("radio")).toHaveCount(5);
        await expect(picker.locator("label")).toHaveText([
          /Economy.*Rp 9.000.*Estimasi tiba 6–11 Okt 2026.*Termurah/,
          /Regular B.*Rp 12.000/, /Regular C.*Rp 15.000/,
          /Regular D.*Rp 18.000/, /Regular A.*Rp 20.000/,
        ]);
        await expect(page.getByText("1–5 dari 7 layanan", { exact: true })).toBeVisible();
        await expect(previous).toBeDisabled();
        await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
        await expect(continueButton(page)).toBeDisabled();
        await picker.getByRole("radio", { name: /Economy/ }).check();
        await expect(summary.getByText("Rp 120.990", { exact: true })).toBeVisible();
        await next.click();
        await expect(picker.getByRole("radio")).toHaveCount(2);
        await expect(picker.locator("label")).toHaveText([/Priority.*Rp 30.000.*Estimasi tiba belum tersedia/, /Express.*Rp 40.000/]);
        await expect(page.getByText("6–7 dari 7 layanan", { exact: true })).toBeVisible();
        await expect(next).toBeDisabled();
        await expect(page.getByText("Terpilih: Economy", { exact: true })).toBeVisible();
        await expect(continueButton(page)).toBeEnabled();
        await expect(summary.getByText("Rp 120.990", { exact: true })).toBeVisible();
        await previous.click();
        await expect(picker.getByRole("radio", { name: /Economy/ })).toBeChecked();
        // Two couriers sharing a service id must not both appear selected.
        await picker.getByRole("radio", { name: /Regular A/ }).check();
        await expect(picker.getByRole("radio", { name: /Economy/ })).not.toBeChecked();
        await expect(summary.getByText("Rp 133.200", { exact: true })).toBeVisible();
        await next.click();
        await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[1]);
        await expect(page.getByText("1–5 dari 7 layanan", { exact: true })).toBeVisible();
        await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
        await expect(continueButton(page)).toBeDisabled();
        await expect(summary.getByText("Rp 133.200", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Terpilih: Regular A", { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await page.close();
      }
    });
  }

  test("quote accepts a verified new address without adding it to the address book", async () => {
    const before = await (await johnContext!.request.get("/api/addresses")).json();
    const cartAdd = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(cartAdd.ok()).toBe(true);
    const cart = await (await johnContext!.request.get("/api/cart")).json();
    const itemId = cart.data.items.find((row: { variantId: string }) => row.variantId === FIXTURE_VARIANT_ID)?.id;
    const quote = await johnContext!.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [itemId], newAddress: {
        recipientName: "Penerima Baru", phone: "081300000009", fullAddress: "Jl. Alamat Baru No. 10",
        ...ADDRESS_CHAIN, isDefault: false,
      } },
    });
    expect(quote.ok(), await quote.text()).toBe(true);
    const quoteBody = await quote.json();
    expect(quoteBody.data.services[0]).toMatchObject({
      serviceCategoryId: 1, shippingCost: 20000,
    });
    const invalid = await johnContext!.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [itemId], newAddress: {
        recipientName: "Penerima Baru", phone: "081300000009", fullAddress: "Jl. Alamat Baru No. 10",
        ...ADDRESS_CHAIN, areaId: "99999999", isDefault: false,
      } },
    });
    expect(invalid.status()).toBe(400);
    const after = await (await johnContext!.request.get("/api/addresses")).json();
    expect(after.data).toEqual(before.data);
  });

  test("a customer with no saved addresses can quote inline without leaving checkout", async ({ browser }) => {
    const id = "e2e-delivery-quote-empty-client";
    const email = "e2e-delivery-quote-empty@example.test";
    const password = "fixture-password-123";
    await pool.query("DELETE FROM client WHERE id=$1", [id]);
    await pool.query(
      "INSERT INTO client (id, name, email, email_verified, onboarding_completed) VALUES ($1, 'Empty Address Client', $2, true, true)",
      [id, email]
    );
    await pool.query(
      "INSERT INTO client_account (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $2, 'credential', $3)",
      [`${id}-account`, id, await bcrypt.hash(password, 10)]
    );
    const context = await browser.newContext({ baseURL: STORE_BASE_URL });
    try {
      await httpSignIn(context, STORE_BASE_URL, email, password);
      const add = await context.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok()).toBe(true);
      const before = await (await context.request.get("/api/addresses")).json();
      expect(before.data).toEqual([]);
      const page = await context.newPage();
      await page.goto("/cart");
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL("**/checkout");
      await page.getByText(OPTION_DELIVERY, { exact: true }).click();
      await expect(page.getByText("Belum ada alamat tersimpan.")).toBeVisible();
      await page.getByRole("button", { name: "Gunakan alamat baru" }).click();
      await page.getByLabel("Nama Penerima").fill("Penerima Pertama");
      await page.getByLabel("Telepon Penerima").fill("081300000009");
      await page.getByLabel("Alamat Lengkap").fill("Jl. Tujuan Pertama No. 10");
      for (const [label, option] of [
        ["Provinsi", "Fixture Province"], ["Kota/Kabupaten", "Fixture City"],
        ["Kecamatan", "Fixture District"], ["Kelurahan/Area", "Fixture Area"],
      ]) await page.getByLabel(label, { exact: true }).selectOption({ label: option });
      await expect(page.getByText(SERVICE_LABEL)).toBeVisible({ timeout: 20_000 });
      expect((await (await context.request.get("/api/addresses")).json()).data).toEqual([]);
    } finally {
      await context.close();
      await pool.query("DELETE FROM client WHERE id=$1", [id]);
    }
  });

  test("checkout quotes an unsaved destination entered inline", async () => {
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await johnContext!.newPage();
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByText(OPTION_DELIVERY, { exact: true }).click();
    await page.getByRole("button", { name: "Gunakan alamat baru" }).click();
    await expect(page.getByLabel("Nama Penerima")).toBeVisible();
    await page.getByLabel("Nama Penerima").fill("Penerima Checkout");
    await page.getByLabel("Telepon Penerima").fill("081300000009");
    await page.getByLabel("Alamat Lengkap").fill("Jl. Checkout Baru No. 10");
    for (const [label, option] of [
      ["Provinsi", "Fixture Province"], ["Kota/Kabupaten", "Fixture City"],
      ["Kecamatan", "Fixture District"], ["Kelurahan/Area", "Fixture Area"],
    ]) {
      await page.getByLabel(label, { exact: true }).selectOption({ label: option });
    }
    await page.getByRole("button", { name: "Periksa ongkir" }).click();
    await expect(page.getByText(SERVICE_LABEL)).toBeVisible();
    await page.getByText(SERVICE_LABEL).click();
    const quotePanel = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
    await expect(quotePanel.getByText(TOTAL_CASE1, { exact: true })).toBeVisible();
    await page.getByLabel("Simpan alamat", { exact: true }).check();
    await page.getByLabel("Jadikan alamat utama").check();
    await expect(page.getByRole("button", { name: "Lanjut", exact: true })).toBeDisabled();
    await page.getByRole("radio", { name: /JNE REG Fixture/ }).check();
    // Navigation preserves the complete inline draft and its save intent.
    await page.getByRole("button", { name: "Lanjut", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Informasi Kontak" })).toBeVisible();
    await page.getByRole("button", { name: "Kembali", exact: true }).click();
    await expect(page.getByLabel("Nama Penerima")).toHaveValue("Penerima Checkout");
    await expect(page.getByLabel("Telepon Penerima")).toHaveValue("081300000009");
    await expect(page.getByLabel("Alamat Lengkap")).toHaveValue("Jl. Checkout Baru No. 10");
    await expect(page.getByLabel("Kelurahan/Area", { exact: true })).toHaveValue("01010101");
    await expect(page.getByLabel("Simpan alamat", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Jadikan alamat utama")).toBeChecked();
    await expect(page.getByRole("radio", { name: /JNE REG Fixture/ })).toBeChecked();
    await page.getByLabel("Alamat Lengkap").fill("Jl. Checkout Baru No. 11");
    await expect(quotePanel.getByText(TOTAL_CASE1, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lanjut" }).last()).toBeDisabled();
    await expect(page.getByText(SERVICE_LABEL)).toBeVisible({ timeout: 20_000 });
    await page.close();
  });

  test("an address-list failure is not mistaken for an empty book and can be retried", async () => {
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await johnContext!.newPage();
    let failList = true;
    await page.route("**/api/addresses", async (route) => {
      if (failList) await route.fulfill({ status: 503, json: { success: false } });
      else await route.continue();
    });
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByText(OPTION_DELIVERY, { exact: true }).click();
    await expect(page.getByRole("alert").getByText("Alamat belum dapat dimuat.")).toBeVisible();
    await expect(page.getByText("Belum ada alamat tersimpan.")).toHaveCount(0);
    failList = false;
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await expect(page.getByRole("alert").getByText("Alamat belum dapat dimuat.")).toHaveCount(0);
    await page.close();
  });

  test("an unverified legacy address cannot be chosen for delivery", async () => {
    const id = "e2e-delivery-quote-legacy";
    const street = "Jl. Delivery Quote E2E Legacy";
    const owner = await pool.query<{ id: string }>("SELECT id FROM client WHERE email=$1", [TEST_USERS.store.email]);
    expect(owner.rows).toHaveLength(1);
    await pool.query("DELETE FROM address WHERE id=$1", [id]);
    await pool.query(
      `INSERT INTO address (id, user_id, first_name, last_name, phone, full_address, city, district, postal_code, is_default)
       VALUES ($1, $2, 'Legacy', '', '081300000001', $3, 'Jakarta', 'Kebayoran', '12160', false)`,
      [id, owner.rows[0].id, street]
    );
    try {
      const add = await johnContext!.request.post("/api/cart/items", {
        data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
      });
      expect(add.ok()).toBe(true);
      const page = await johnContext!.newPage();
      await page.goto("/cart");
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL("**/checkout");
      await page.getByText(OPTION_DELIVERY, { exact: true }).click();
      await page.getByLabel("Alamat Pengiriman").click();
      await expect(page.getByRole("option", { name: /Delivery Quote E2E Legacy/ })).toBeDisabled();
      await page.close();
    } finally {
      await pool.query("DELETE FROM address WHERE id=$1", [id]);
    }
  });

  test("checkout automatically chooses the customer's default address", async () => {
    const promoted = await johnContext!.request.post(`/api/addresses/${addressIdOne}/default`);
    expect(promoted.ok()).toBe(true);
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const page = await johnContext!.newPage();
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByText(OPTION_DELIVERY, { exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Alamat Pengiriman" })).toContainText(ADDRESS_STREETS[0]);
    await page.close();
  });

  test("delivery method quotes `rates` (Rp 20.000 / PPN 13.200 / total 133.200) and an address change invalidates the selection", async ({ }) => {
    const page = await johnContext!.newPage();

    // Controlled cart: one fixture item on the origin branch.
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok(), `adding the fixture variant failed: ${await add.text()}`).toBe(true);
    const current = await (await johnContext!.request.get("/api/cart")).json();
    const cartItemId = current.data.items.find((row: { variantId: string }) => row.variantId === FIXTURE_VARIANT_ID)?.id;
    expect(typeof cartItemId).toBe("string");

    // Cart → select → checkout → fulfillment (before contact).
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");

    // NEVER an actual delivery order/payment in this ticket — the flow stops
    // at the method + quote step; Bayar Sekarang is untouched.
    // Record outgoing quote requests: the browser payload must stay a plain
    // {itemIds, addressId} — money is re-derived server-side.
    page.on("request", (request) => {
      if (
        request.url().includes("/api/checkout/delivery-quote") &&
        request.method() === "POST"
      ) {
        const body = request.postData();
        if (body) quotePayloads.push(JSON.parse(body));
      }
    });
    await page.getByText(OPTION_DELIVERY, { exact: true }).click();
    await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);

    await page.getByRole("button", { name: CHECK_ONGKIR }).click();
    await expect(page.getByText(SERVICE_LABEL)).toBeVisible({ timeout: 20_000 });
    await page.getByText(SERVICE_LABEL).click();
    const money = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
    await expect(money.getByText(ONGKIR_LABEL, { exact: true })).toBeVisible();
    await expect(money.getByText(PPN_CASE1, { exact: true })).toBeVisible();
    await expect(money.getByText(TOTAL_CASE1, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination kurir" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Quote Pengiriman" }).getByText(TOTAL_CASE1, { exact: true })).toHaveCount(0);

    // The browser POST stays a plain {itemIds, addressId} — money is re-
    // derived server-side (never trusted from the browser).
    expect(quotePayloads, "the quote request must carry only owned cart ids + the address").toContainEqual({
      itemIds: [cartItemId],
      addressId: addressIdOne,
    });

    const continueBtn = page.getByRole("button", { name: /Lanjut|Bayar/ }).last();
    await expect(continueBtn).toBeEnabled({ timeout: 10_000 });

    // Address change → stale selection dead, pending requote holds the flow.
    await delayQuoteResponses(page, 1_200);
    await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[1]);
    // The requote may fire automatically on the change or wait for the
    // still-offered trigger — both land in the delayed pending window.
    const periksaAgain = page.getByRole("button", { name: CHECK_ONGKIR }).last();
    if (await periksaAgain.isVisible().catch(() => false)) {
      await periksaAgain.click();
    }
    await expect(continueBtn).toBeDisabled({ timeout: 5_000 }); // during the pending quote
    await expect(money.getByText(ONGKIR_LABEL, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(continueBtn).toBeDisabled(); // no selection yet after requote
    await page.getByText(SERVICE_LABEL).click();
    await expect(continueBtn).toBeEnabled({ timeout: 10_000 });
    await expect(money.getByText(TOTAL_CASE1, { exact: true })).toBeVisible();

    // A server price change must reach the checkout summary, not the stale
    // cart price held by the page: 112000+20000+14520=146520.
    try {
      await pool.query("UPDATE product_variant SET price='112000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
      await page.getByRole("button", { name: CHECK_ONGKIR }).click();
      await page.getByText(SERVICE_LABEL).click();
      await expect(money.getByText("Rp 146.520", { exact: true })).toBeVisible();
    } finally {
      await pool.query("UPDATE product_variant SET price='100000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    }
    await page.close();
  });

  test("a cart quantity change requotes at the new subtotal; failed/empty quotes offer Coba lagi or pickup with no stale money", async ({ }) => {
    const page = await johnContext!.newPage();

    // Set up this case's own cart; other cases no longer leak their items.
    const add = await johnContext!.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: ORIGIN_BRANCH_ID, quantity: 1 },
    });
    expect(add.ok()).toBe(true);
    const cart = (await (await johnContext!.request.get("/api/cart")).json()) as {
      data?: { items?: Array<{ id: string }> };
    };
    const items = cart.data?.items ?? [];
    expect(items.length, "the T1 cart item must still be in the cart").toBeGreaterThan(0);
    for (const item of items) {
      const patched = await johnContext!.request.put(`/api/cart/items/${item.id}`, {
        data: { quantity: 2 },
      });
      expect(patched.ok(), `cart quantity change failed: ${await patched.text()}`).toBe(true);
    }
    // The controlled quote for 2 × Rp100.000 + mock ongkir 20.000:
    // taxable 220.000 → PPN 24.200 → total 244.200.

    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");

    // NO stale money from the previous quote may render before the new one.
    await page.getByText(OPTION_DELIVERY, { exact: true }).click();
    await expect(page.getByText(STALE_TOTAL_CASE1, { exact: true })).toHaveCount(0);
    await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[0]);
    await page.getByRole("button", { name: CHECK_ONGKIR }).click();
    await expect(page.getByText(SERVICE_LABEL)).toBeVisible({ timeout: 20_000 });
    await page.getByText(SERVICE_LABEL).click();
    const money = page.getByRole("heading", { name: "Ringkasan", exact: true }).locator("..");
    await expect(money.getByText(ONGKIR_LABEL, { exact: true })).toBeVisible();
    await expect(money.getByText(PPN_CASE2, { exact: true })).toBeVisible();
    await expect(money.getByText(TOTAL_CASE2, { exact: true })).toBeVisible();

    // Failed quote: no zero and NO stale ongkir — offer Coba lagi / pickup.
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "rate-failure" })).status
    ).toBe("ok");
    await pickDeliveryMethodAndAddress(page, ADDRESS_STREETS[1]);
    const periksaFailed = page.getByRole("button", { name: CHECK_ONGKIR }).last();
    if (await periksaFailed.isVisible().catch(() => false)) {
      await periksaFailed.click();
    }
    await expect(page.getByRole("button", { name: RETRY_LABEL })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(TOTAL_CASE2, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ONGKIR_LABEL, { exact: true })).toHaveCount(0);
    // The pickup alternative stays selectable — never forced onto delivery.
    await expect(page.getByText(OPTION_PICKUP)).toBeVisible();
    await mockControl("PUT", "/__control/shipment", { scenario: "rate-empty" });
    const [empty] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/checkout/delivery-quote") && response.request().method() === "POST"),
      page.getByRole("button", { name: RETRY_LABEL }).click(),
    ]);
    expect(empty.status()).toBe(502);
    await expect(page.getByRole("button", { name: RETRY_LABEL })).toBeVisible();
    await expect(page.getByText(TOTAL_CASE2, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ONGKIR_LABEL, { exact: true })).toHaveCount(0);

    await page.close();
  });
});