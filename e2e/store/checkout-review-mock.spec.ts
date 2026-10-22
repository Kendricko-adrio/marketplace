/**
 * Ticket 02 — mock-only checkout REVIEW PREVIEW: first public HTTP tracer
 * bullet (stage 1, RED until the parent implements the route).
 *
 * ONE real HTTP call through the running store app, authenticated with the
 * spec's OWN Better Auth session (no stubbed internal route, no faked
 * checkout response):
 *
 *   POST /api/checkout/preview
 *   { phone, email, pickupDate, pickupTime, selectedItemIds, promoSelection:{kind:"none"} }
 *   → 200 { success: true, data: { pricing, reviewToken, expiresAt, contextFingerprint } }
 *
 * The expected money is the independent literal of the approved spec/ticket
 * worked case for a pickup order without promo — goods 150.000, PPN 11% ceil
 * 16.500, service fee 0, shipping 0, total 166.500 — never a recomputation of
 * implementation output. Money crosses the wire as decimal strings.
 *
 * Scope of THIS slice (deliberately narrow):
 * - the public envelope and wire names above,
 * - authoritative money that the server derives from its own source price
 *   (the request body carries no money field; the response money is asserted
 *   against independent literals, never recomputed from the response),
 * - a non-empty signed review token, a ~10 minute expiry with an ISO8601
 *   timezone timestamp, and a 64-hex canonical context fingerprint,
 * - two rejection boundaries of the same public seam: an oversized body must
 *   answer 413 INPUT_LIMIT_EXCEEDED on size alone (never 400 INPUT_INVALID),
 *   and a selection that mixes a branch-bound line with a branchless line
 *   must answer 400 INPUT_INVALID instead of pricing the remaining line,
 * - NO provider business write: the preview must not call the Jubelio Sales
 *   API at all (captured by the loopback mock).
 *
 * Token verification/tampering, expired-token, client-binding, reprice,
 * place-order request keys and every replay/parallel case belong to the NEXT
 * vertical cycles and are intentionally NOT written here.
 *
 * Fixture/gate safety:
 * - runs ONLY under playwright.mock.config.ts (loopback ports 3110/3111/3112);
 * - REFUSES any database that is not a disposable `marketplace_discounts_test_*`
 *   name, because it flips `discounts.contractVersion` to 1 for the run;
 * - the gate is restored in afterAll; the catalog fixture uses exact owned IDs
 *   and is deleted in place (product → variant → branch_stock cascade);
 * - setup/teardown SQL touches source/catalog rows only — no order counts and
 *   no order rows are used as a side channel.
 *
 * Run with the isolated mock config (the parent selects the spec):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { createHmac } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";
import { deleteRetainedOrderFixtures } from "../../packages/db/src/testing/retained-order-fixtures";

dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (keep in sync with playwright.mock.config.ts)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112", "3210", "3211", "3212"]);

const PREVIEW_PATH = "/api/checkout/preview";

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "checkout-review-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_API_BASE_URL set"
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
        `checkout-review-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

/**
 * This spec turns the domain gate ON for its run, so it must never point at a
 * shared/real database. Only a disposable `marketplace_discounts_test_*`
 * database name is accepted.
 */
function requireDisposableDatabase(): void {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) {
    throw new Error(
      "checkout-review-mock.spec.ts requires an explicit disposable DATABASE_URL (marketplace_discounts_test_*)"
    );
  }
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(
      "checkout-review-mock.spec.ts cannot parse DATABASE_URL; a disposable marketplace_discounts_test_* database is required"
    );
  }
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      `checkout-review-mock.spec.ts refuses database "${databaseName}": it sets discounts.contractVersion=1 and writes fixture catalog rows, so only a disposable marketplace_discounts_test_* database is allowed`
    );
  }
}

// ---------------------------------------------------------------------------
// Independent expected literals (ticket 02 stage-1 contract, spec §4.2/§4.4):
// pickup without promo → goods 150.000, PPN 11% ceil = 16.500, total 166.500.
// ---------------------------------------------------------------------------

const GOODS_AMOUNT = 150_000;
const PPN_AMOUNT = 16_500;
const TOTAL_AMOUNT = 166_500;
const PPN_RATE_PERCENT = 11;
const REVIEW_TTL_MS = 10 * 60_000;
const TTL_TOLERANCE_MS = 60_000;

// Money wire format (spec §4.3): unsigned whole-IDR decimal string, no
// separator/exponent/sign and no non-zero fraction; an all-zero fraction is
// tolerated because existing scale2 columns persist `.00`.
const DECIMAL_RUPIAH = /^(?:0|[1-9][0-9]*)(?:\.0{1,2})?$/;
// Time wire format (spec §5.2): ISO8601 with an explicit timezone.
const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// Canonical payload fingerprints are SHA-256 (spec §4.3).
const SHA256_HEX = /^[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------
// Owned fixture identity — exactly these IDs/contact are created and deleted.
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "e2e-checkout-review";
const FIXTURE_PRODUCT_ID = `${FIXTURE_PREFIX}-product`;
const FIXTURE_PRODUCT_SLUG = `${FIXTURE_PREFIX}-anchor`;
const FIXTURE_VARIANT_ID = `${FIXTURE_PREFIX}-variant`;
const FIXTURE_VARIANT_SKU = "CHKREV-01";
// Second, DISTINCT variant used only by the mixed-branch case below. Its cart
// line carries no branch (cart_item.branch_id is nullable), which is the
// schema-valid way to express "one line with a branch, one without".
const FIXTURE_SECOND_PRODUCT_ID = `${FIXTURE_PREFIX}-product-2`;
const FIXTURE_SECOND_PRODUCT_SLUG = `${FIXTURE_PREFIX}-anchor-2`;
const FIXTURE_SECOND_VARIANT_ID = `${FIXTURE_PREFIX}-variant-2`;
const FIXTURE_SECOND_VARIANT_SKU = "CHKREV-02";
const FIXTURE_SECOND_VARIANT_PRICE = "200000.00";
const FIXTURE_NULL_BRANCH_CART_LINE_ID = `${FIXTURE_PREFIX}-cart-line-nullbranch`;
const DELIVERY_BRANCH_ID = `${FIXTURE_PREFIX}-delivery-branch`;
const DELIVERY_LOCATION_ID = 920_101;
const MOCK_ITEM_ID = 920_001;
const MOCK_SECOND_ITEM_ID = 920_002;
const MOCK_STOCK_UNITS = 5;
const CONTACT_EMAIL = "checkout-review-mock-e2e@example.com";
const CONTACT_PHONE = "081234567891";
const PICKUP_TIME = "10:00";

const fixtureOrderIds = new Set<string>();
let pool: Pool;
let storeContext: BrowserContext;
let homeBranchId = "";
let gateBefore:
  | { value: string; type: string; description: string | null }
  | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Local YYYY-MM-DD of the next non-Sunday day (branch hours: Mon–Sat 9–21). */
function nextOpenDate(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const isEmail = identifier.includes("@");
  const response = await context.request.post(
    `${base}/api/auth/sign-in/${isEmail ? "email" : "username"}`,
    { data: isEmail ? { email: identifier, password } : { username: identifier, password } }
  );
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

type MockRequestRecord = {
  method: string;
  path: string;
  body: Record<string, unknown>;
};

async function mockControl(
  method: "GET" | "POST" | "PUT",
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

async function getMockRequests(): Promise<MockRequestRecord[]> {
  const result = await mockControl("GET", "/__control/requests");
  return (result.data as MockRequestRecord[]) ?? [];
}

/**
 * Asserts a money field is an exact whole-Rupiah decimal string equal to the
 * independent expected literal. `expected` never comes from the response.
 */
function expectRupiah(actual: unknown, expected: number, field: string): void {
  expect(typeof actual, `${field} must be a decimal money string`).toBe("string");
  const text = actual as string;
  expect(text, `${field} must be an unsigned whole-Rupiah decimal string`).toMatch(
    DECIMAL_RUPIAH
  );
  expect(Number(text), `${field} must equal the independent literal ${expected}`).toBe(
    expected
  );
}

async function preparePickup() {
  await storeContext.request.delete("/api/cart");
  expect((await storeContext.request.post("/api/cart/items", {
    data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
  })).ok()).toBe(true);
  const cart = await (await storeContext.request.get("/api/cart")).json();
  const intent = {
    phone: CONTACT_PHONE, email: CONTACT_EMAIL, pickupDate: nextOpenDate(), pickupTime: PICKUP_TIME,
    selectedItemIds: [cart.data.items[0].id as string], promoSelection: { kind: "none" },
  };
  const preview = await (await storeContext.request.post(PREVIEW_PATH, { data: intent })).json();
  expect(preview.success).toBe(true);
  const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
  await mockControl("POST", "/__control/reset");
  await mockControl("POST", "/__control/stocks/ensure", {
    locationId: location.rows[0].jubelio_location_id, itemId: MOCK_ITEM_ID,
    onHand: MOCK_STOCK_UNITS, sellPrice: GOODS_AMOUNT,
  });
  return { ...intent, reviewToken: preview.data.reviewToken as string };
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  requireDisposableDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Precondition: the seeded PPN config (contract fixture, both pricing paths).
  const ppn = await pool.query<{ value: string }>(
    "SELECT value FROM system_config WHERE key = 'tax.ppnRatePercent'"
  );
  expect(
    ppn.rows[0]?.value,
    "checkout review spec requires the seeded tax.ppnRatePercent = 11 (npm run db:seed)"
  ).toBe("11");

  // The Home Branch of the seeded store customer's admin identity — a mapped,
  // active branch is the pickup origin for this fixture (seeded row, read only).
  const admin = await pool.query<{
    branch_id: string | null;
    jubelio_location_id: number | null;
    status: string | null;
  }>(
    `SELECT u.branch_id, b.jubelio_location_id, b.status
     FROM "user" u JOIN branch b ON b.id = u.branch_id
     WHERE u.username = $1`,
    [TEST_USERS.admin.identifier]
  );
  homeBranchId = admin.rows[0]?.branch_id ?? "";
  expect(
    homeBranchId,
    "the seeded admin must have an active Jubelio-linked Home Branch (npm run db:seed)"
  ).toBeTruthy();
  expect(
    admin.rows[0]?.status,
    "the fixture pickup origin branch must be active"
  ).toBe("aktif");
  expect(
    admin.rows[0]?.jubelio_location_id ?? 0,
    "the seeded admin's Home Branch must be linked to a Jubelio location"
  ).toBeGreaterThan(0);

  // Heal leftovers from an interrupted run (deterministic owned IDs only).
  await pool.query("DELETE FROM cart_item WHERE id = $1", [
    FIXTURE_NULL_BRANCH_CART_LINE_ID,
  ]);
  await pool.query("DELETE FROM branch_stock WHERE product_variant_id = ANY($1)", [
    [FIXTURE_VARIANT_ID, FIXTURE_SECOND_VARIANT_ID],
  ]);
  await pool.query("DELETE FROM product WHERE id = ANY($1) OR slug = ANY($2)", [
    [FIXTURE_PRODUCT_ID, FIXTURE_SECOND_PRODUCT_ID],
    [FIXTURE_PRODUCT_SLUG, FIXTURE_SECOND_PRODUCT_SLUG],
  ]);

  // Fixture catalog: exactly one Rp150.000 variant carried by the Home Branch.
  // These are the SERVER authority for the expected money below; the browser
  // never submits a price.
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Checkout Review Mock Anchor', $2, '150000.00', 'aktif')`,
    [FIXTURE_PRODUCT_ID, FIXTURE_PRODUCT_SLUG]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1, $2, $3, '150000.00', true, $4)`,
    [FIXTURE_VARIANT_ID, FIXTURE_PRODUCT_ID, FIXTURE_VARIANT_SKU, MOCK_ITEM_ID]
  );
  // Provisional local mirror only (cart entry needs a mapped stock row).
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, $3, NOW())`,
    [homeBranchId, FIXTURE_VARIANT_ID, MOCK_STOCK_UNITS]
  );

  await pool.query(`UPDATE product_variant SET parcel_dimensions='{"weight":1000,"length":10,"width":10,"height":10}' WHERE id=$1`, [FIXTURE_VARIANT_ID]);
  await pool.query(`INSERT INTO branch (id,name,code,status,jubelio_location_id,city,address,
    shipping_phone,shipping_address,shipping_postal_code,shipping_area_id,
    shipping_province_id,shipping_city_id,shipping_district_id,
    shipping_province,shipping_city,shipping_district,shipping_area)
    VALUES ($1,'Review Delivery Fixture','CHKREVDEL','aktif',$2,'Fixture City','Jl. Origin Fixture','021999888','Jl. Origin Fixture','01234','01010101',
      '01','0101','010101','Fixture Province','Fixture City','Fixture District','Fixture Area')
    ON CONFLICT (id) DO NOTHING`, [DELIVERY_BRANCH_ID, DELIVERY_LOCATION_ID]);
  await pool.query(`INSERT INTO branch_stock (branch_id,product_variant_id,stock,available_stock,provider_stock_synced_at)
    VALUES ($1,$2,5,5,NOW())`, [DELIVERY_BRANCH_ID, FIXTURE_VARIANT_ID]);

  // Second owned catalog anchor for the mixed-branch case: a distinct variant
  // whose cart line is written with `branch_id = NULL` (schema-valid), so the
  // selection mixes one branch-bound line with one branchless line.
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'Checkout Review Mock Null-Branch Anchor', $2, $3, 'aktif')`,
    [FIXTURE_SECOND_PRODUCT_ID, FIXTURE_SECOND_PRODUCT_SLUG, FIXTURE_SECOND_VARIANT_PRICE]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1, $2, $3, $4, true, $5)`,
    [
      FIXTURE_SECOND_VARIANT_ID,
      FIXTURE_SECOND_PRODUCT_ID,
      FIXTURE_SECOND_VARIANT_SKU,
      FIXTURE_SECOND_VARIANT_PRICE,
      MOCK_SECOND_ITEM_ID,
    ]
  );

  await pool.query(`INSERT INTO branch_stock (branch_id,product_variant_id,stock,available_stock,provider_stock_synced_at)
    VALUES ($1,$2,5,5,NOW())`, [homeBranchId, FIXTURE_SECOND_VARIANT_ID]);

  // Gate 1 for THIS disposable run only; restored in afterAll.
  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key = 'discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type)
     VALUES ('discounts.contractVersion', '1', 'number')
     ON CONFLICT (key) DO UPDATE SET value = '1', type = 'number'`
  );

  // Own session on the isolated origin (public HTTP sign-in seam).
  storeContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(
    storeContext,
    STORE_BASE_URL,
    TEST_USERS.store.email,
    TEST_USERS.store.password
  );
});

test.afterEach(async () => {
  // Kasus ambiguity sengaja mempertahankan hold. Hanya fixture order/variant
  // milik spec ini dibersihkan antar kasus; jangan membawa hold ke kasus lain.
  await deleteRetainedOrderFixtures(pool, [...fixtureOrderIds]);
  fixtureOrderIds.clear();
  await pool.query("UPDATE branch_stock SET pending_remote_stock=0,available_stock=5,stock=5 WHERE product_variant_id=$1", [FIXTURE_VARIANT_ID]);
  const owner = await pool.query("SELECT id FROM client WHERE email=$1", [TEST_USERS.store.email]);
  const hash = (kind: string, value: string) => createHmac("sha256", "mock-e2e-only-shared-auth-secret-do-not-reuse")
    .update(`okcir:checkout-admission:v1:${kind}:${value}`).digest("hex");
  await pool.query("DELETE FROM discount_request_window WHERE subject_hash=ANY($1::text[])",
    [[hash("account", owner.rows[0].id), hash("ip", "127.0.0.1")]]);
});

test.afterAll(async () => {
  await storeContext?.close().catch(() => {});

  if (pool) {
    // Restore the domain gate BEFORE anything else, even after a failure.
    if (gateBefore) {
      await pool.query(
        `UPDATE system_config SET value = $1, type = $2, description = $3
         WHERE key = 'discounts.contractVersion'`,
        [gateBefore.value, gateBefore.type, gateBefore.description]
      );
    } else {
      await pool.query(
        "DELETE FROM system_config WHERE key = 'discounts.contractVersion'"
      );
    }

    await deleteRetainedOrderFixtures(pool, [...fixtureOrderIds]);
    await pool.query("DELETE FROM cart_item WHERE id = $1", [
      FIXTURE_NULL_BRANCH_CART_LINE_ID,
    ]);
    await pool.query("DELETE FROM branch_stock WHERE product_variant_id = ANY($1)", [
      [FIXTURE_VARIANT_ID, FIXTURE_SECOND_VARIANT_ID],
    ]);
    await pool.query("DELETE FROM product WHERE id = ANY($1) OR slug = ANY($2)", [
      [FIXTURE_PRODUCT_ID, FIXTURE_SECOND_PRODUCT_ID],
      [FIXTURE_PRODUCT_SLUG, FIXTURE_SECOND_PRODUCT_SLUG],
    ]);
    await pool.query("DELETE FROM branch WHERE id=$1", [DELIVERY_BRANCH_ID]);
    await pool.end();
  }
});

test.describe("mock-only checkout review preview (ticket 02)", () => {
  test.describe.configure({ mode: "serial", timeout: 60_000 });

  test("pickup preview without promo is authoritative, returns a ~10 minute signed review token, and writes nothing to the provider", async () => {
    // === Deterministic cart: exactly the owned fixture line ================
    const cleared = await storeContext.request.delete("/api/cart");
    expect(
      cleared.ok(),
      `clearing the customer cart failed: ${await cleared.text()}`
    ).toBe(true);

    const added = await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    });
    expect(
      added.ok(),
      `adding the owned fixture variant failed: ${await added.text()}`
    ).toBe(true);

    const cart = (await (
      await storeContext.request.get("/api/cart")
    ).json()) as {
      data?: {
        items?: Array<{ id: string; variantId: string; quantity: number }>;
      };
    };
    const cartItems = cart.data?.items ?? [];
    expect(cartItems, "the cart must hold exactly the owned fixture line").toHaveLength(1);
    const cartLine = cartItems.find((item) => item.variantId === FIXTURE_VARIANT_ID);
    expect(cartLine, "the owned fixture variant must be the checkout line").toBeTruthy();
    expect(cartLine!.quantity).toBe(1);

    // Fresh provider capture window: any Sales traffic below belongs to this
    // preview call.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");

    // === The public technical input contract ===============================
    // Pickup contact + slot + selected cart ids + explicit "no promo". No
    // requestKey (that is a place-order UUID) and NO money/price field: source
    // price is server authority, never a browser number.
    const previewRequest = {
      phone: CONTACT_PHONE,
      email: CONTACT_EMAIL,
      pickupDate: nextOpenDate(),
      pickupTime: PICKUP_TIME,
      selectedItemIds: [cartLine!.id],
      promoSelection: { kind: "none" },
    };

    const requestedAt = Date.now();
    const response = await storeContext.request.post(PREVIEW_PATH, {
      data: previewRequest,
    });
    const raw = await response.text();
    const respondedAt = Date.now();

    // The route must accept the public pickup body and answer 200 JSON; a
    // missing route answers 404 and a rejected body a 4xx.
    expect(
      response.status(),
      `POST ${PREVIEW_PATH} must accept the pickup body and answer 200 (body: ${raw.slice(0, 300)})`
    ).toBe(200);
    expect(
      response.headers()["content-type"] ?? "",
      "the preview must answer JSON"
    ).toContain("application/json");

    const body = JSON.parse(raw) as {
      success?: unknown;
      data?: {
        pricing?: Record<string, unknown>;
        reviewToken?: unknown;
        expiresAt?: unknown;
        contextFingerprint?: unknown;
      };
      error?: unknown;
    };
    expect(
      body.success,
      `success envelope expected (error: ${String(body.error)})`
    ).toBe(true);

    const data = body.data ?? {};

    // === Authoritative money (existing checkout pricing wire names) =======
    expect(
      typeof data.pricing,
      "data.pricing must be the authoritative breakdown object"
    ).toBe("object");
    const pricing = data.pricing ?? {};
    expectRupiah(pricing.subtotal, GOODS_AMOUNT, "data.pricing.subtotal");
    expectRupiah(pricing.discount, 0, "data.pricing.discount");
    expectRupiah(pricing.taxableBase, GOODS_AMOUNT, "data.pricing.taxableBase");
    expectRupiah(pricing.shippingCost, 0, "data.pricing.shippingCost");
    expectRupiah(pricing.serviceFee, 0, "data.pricing.serviceFee");
    expectRupiah(pricing.ppnAmount, PPN_AMOUNT, "data.pricing.ppnAmount");
    expectRupiah(pricing.total, TOTAL_AMOUNT, "data.pricing.total");
    expect(
      Number(pricing.ppnRatePercent),
      "data.pricing.ppnRatePercent must be the configured 11%"
    ).toBe(PPN_RATE_PERCENT);

    // === Signed review token ==============================================
    // Signature/tamper/expiry/client-binding proof is a later vertical slice;
    // this bullet only settles the wire presence and shape.
    expect(
      typeof data.reviewToken,
      "data.reviewToken must be a string"
    ).toBe("string");
    expect(
      (data.reviewToken as string).length,
      "data.reviewToken must be non-empty"
    ).toBeGreaterThan(0);

    // === Expiry: ~10 minutes, ISO8601 with timezone ========================
    expect(typeof data.expiresAt, "data.expiresAt must be a string").toBe("string");
    const expiresAtText = data.expiresAt as string;
    expect(
      expiresAtText,
      "data.expiresAt must be ISO8601 with an explicit timezone"
    ).toMatch(ISO_WITH_TIMEZONE);
    const expiresAtMs = Date.parse(expiresAtText);
    expect(Number.isFinite(expiresAtMs), "data.expiresAt must parse").toBe(true);
    expect(
      expiresAtMs - requestedAt,
      "review expiry must be about 10 minutes after the preview request"
    ).toBeGreaterThanOrEqual(REVIEW_TTL_MS - TTL_TOLERANCE_MS);
    expect(
      expiresAtMs - respondedAt,
      "review expiry must not exceed the 10 minute TTL (plus tolerance)"
    ).toBeLessThanOrEqual(REVIEW_TTL_MS + TTL_TOLERANCE_MS);

    // === Canonical context fingerprint ====================================
    expect(
      typeof data.contextFingerprint,
      "data.contextFingerprint must be a string"
    ).toBe("string");
    expect(
      data.contextFingerprint,
      "data.contextFingerprint must be a canonical SHA-256 hex fingerprint"
    ).toMatch(SHA256_HEX);

    // === No provider BUSINESS write =======================================
    // The preview creates no Redemption/hold/order and must not touch the
    // Jubelio Sales API (stock reads live under /inventory/, not /sales/).
    const captured = await getMockRequests();
    const salesTraffic = captured.filter((record) =>
      record.path.startsWith("/sales/")
    );
    expect(
      salesTraffic,
      "the preview must not dispatch any provider Sales request (no business POST)"
    ).toEqual([]);
  });

  test("place-order rejects a modified signed review before stock or provider activity", async () => {
    await storeContext.request.delete("/api/cart");
    const added = await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    });
    expect(added.ok()).toBe(true);
    const cart = await (await storeContext.request.get("/api/cart")).json();
    const intent = {
      phone: CONTACT_PHONE, email: CONTACT_EMAIL,
      pickupDate: nextOpenDate(), pickupTime: PICKUP_TIME,
      selectedItemIds: [cart.data.items[0].id], promoSelection: { kind: "none" },
    };
    const preview = await (await storeContext.request.post(PREVIEW_PATH, { data: intent })).json();
    expect(preview.success).toBe(true);
    const token = preview.data.reviewToken as string;
    const [payload, signature] = token.split(".");
    const modified = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await mockControl("POST", "/__control/reset");
    const placed = await storeContext.request.post("/api/checkout/place-order", {
      data: { ...intent, requestKey: "b1200000-0000-4000-8000-000000000001", reviewToken: modified },
    });
    expect(placed.status()).toBe(409);
    const result = await placed.json();
    expect(result.success).toBe(false);
    expect(result.code).toBe("CHECKOUT_REVIEW_REQUIRED");
    expect((await getMockRequests()).filter((entry) => !entry.path.startsWith("/__control/"))).toEqual([]);
  });

  test("place-order requires a new review when authoritative source price changes", async () => {
    await storeContext.request.delete("/api/cart");
    expect((await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    })).ok()).toBe(true);
    const cart = await (await storeContext.request.get("/api/cart")).json();
    const intent = {
      phone: CONTACT_PHONE, email: CONTACT_EMAIL,
      pickupDate: nextOpenDate(), pickupTime: PICKUP_TIME,
      selectedItemIds: [cart.data.items[0].id], promoSelection: { kind: "none" },
    };
    const preview = await (await storeContext.request.post(PREVIEW_PATH, { data: intent })).json();
    expect(preview.success).toBe(true);
    await pool.query("UPDATE product_variant SET price='140000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    try {
      await mockControl("POST", "/__control/reset");
      const placed = await storeContext.request.post("/api/checkout/place-order", {
        data: { ...intent, requestKey: "b1200000-0000-4000-8000-000000000002", reviewToken: preview.data.reviewToken },
      });
      expect(placed.status()).toBe(409);
      expect((await placed.json()).code).toBe("CHECKOUT_REVIEW_REQUIRED");
      expect((await getMockRequests()).filter((entry) => !entry.path.startsWith("/__control/"))).toEqual([]);
    } finally {
      await pool.query("UPDATE product_variant SET price='150000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    }
  });

  test("accepted request survives a lost response and cleared cart without a second order or provider write", async ({ browser }) => {
    await storeContext.request.delete("/api/cart");
    expect((await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    })).ok()).toBe(true);
    const cart = await (await storeContext.request.get("/api/cart")).json();
    const intent = {
      phone: CONTACT_PHONE, email: CONTACT_EMAIL,
      pickupDate: nextOpenDate(), pickupTime: PICKUP_TIME,
      selectedItemIds: [cart.data.items[0].id], promoSelection: { kind: "none" },
    };
    const preview = await (await storeContext.request.post(PREVIEW_PATH, { data: intent })).json();
    expect(preview.success).toBe(true);
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: location.rows[0].jubelio_location_id, itemId: MOCK_ITEM_ID,
      onHand: MOCK_STOCK_UNITS, sellPrice: GOODS_AMOUNT,
    });
    const requestKey = "b1200000-0000-4000-8000-000000000003";
    const body = { ...intent, requestKey, reviewToken: preview.data.reviewToken };
    const placed = await storeContext.request.post("/api/checkout/place-order", {
      data: body, headers: { "x-e2e-payment-mock": "true" },
    });
    const created = await placed.json();
    const orderId = created.data?.orderId ?? created.orderId;
    if (orderId) fixtureOrderIds.add(orderId);
    expect(placed.status()).toBe(201);
    expect(created.success).toBe(true);
    expect(created.data.orderId).toBeTruthy();
    const detailBefore = await (await storeContext.request.get(`/api/orders/${orderId}`)).json();
    expectRupiah(detailBefore.data.total, TOTAL_AMOUNT, "accepted total");
    const expiry = detailBefore.data.expiresAt;
    expect((await (await storeContext.request.get("/api/cart")).json()).data.items).toHaveLength(0);
    await pool.query("UPDATE product_variant SET price='190000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    try {
      await mockControl("POST", "/__control/reset");
      const replay = await storeContext.request.post("/api/checkout/place-order", { data: body });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).data.orderId).toBe(orderId);
      const lookup = await storeContext.request.get(`/api/checkout/requests/${requestKey}`);
      expect(lookup.status()).toBe(200);
      expect((await lookup.json()).data.orderId).toBe(orderId);
      const outsiderBefore = (await pool.query("SELECT onboarding_completed FROM client WHERE email=$1", [TEST_USERS.storeFresh.email])).rows[0];
      const outsider = await browser.newContext({ baseURL: STORE_BASE_URL });
      try {
        await pool.query("UPDATE client SET onboarding_completed=true WHERE email=$1", [TEST_USERS.storeFresh.email]);
        await httpSignIn(outsider, STORE_BASE_URL, TEST_USERS.storeFresh.email, TEST_USERS.storeFresh.password);
        expect((await outsider.request.get(`/api/checkout/requests/${requestKey}`)).status()).toBe(404);
        expect((await outsider.request.get(`/api/orders/${orderId}`)).status()).toBe(404);
      } finally {
        await outsider.close();
        await pool.query("UPDATE client SET onboarding_completed=$1 WHERE email=$2", [outsiderBefore.onboarding_completed, TEST_USERS.storeFresh.email]);
      }
      const detailAfter = await (await storeContext.request.get(`/api/orders/${orderId}`)).json();
      expectRupiah(detailAfter.data.total, TOTAL_AMOUNT, "immutable replay total");
      expect(detailAfter.data.expiresAt).toBe(expiry);
      const conflict = await storeContext.request.post("/api/checkout/place-order", {
        data: { ...body, phone: "081234567899" },
      });
      expect(conflict.status()).toBe(409);
      expect((await conflict.json()).code).toBe("REQUEST_KEY_CONFLICT");
      const [payload, signature] = body.reviewToken.split(".");
      const modifiedToken = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
      for (let i = 0; i < 9; i++) {
        const invalid = await storeContext.request.post("/api/checkout/place-order", { data: {
          ...body, requestKey: `b1200000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`, reviewToken: modifiedToken,
        } });
        expect(invalid.status()).toBe(409);
      }
      const limited = await storeContext.request.post("/api/checkout/place-order", { data: {
        ...body, requestKey: "b1200000-0000-4000-8000-000000001099",
      } });
      expect(limited.status()).toBe(429);
      expect((await limited.json()).code).toBe("RATE_LIMITED");
      const limitedReplay = await storeContext.request.post("/api/checkout/place-order", { data: body });
      expect(limitedReplay.status()).toBe(200);
      expect((await limitedReplay.json()).data.orderId).toBe(orderId);
      expect((await getMockRequests()).filter((entry) => !entry.path.startsWith("/__control/"))).toEqual([]);
    } finally {
      await pool.query("UPDATE product_variant SET price='150000.00' WHERE id=$1", [FIXTURE_VARIANT_ID]);
    }
  });

  test("expired signed tokens, missing review and changed contact are rejected without provider activity", async () => {
    const prepared = await preparePickup();
    const fingerprint = JSON.parse(Buffer.from(prepared.reviewToken.split(".")[0], "base64url").toString("utf8")).fp;
    // Independent cryptographic fixture: valid signature, expiry fixed in the past.
    const payload = Buffer.from(JSON.stringify({ v: 1, fp: fingerprint, exp: 1 })).toString("base64url");
    const signingKey = createHmac("sha256", "mock-e2e-only-shared-auth-secret-do-not-reuse")
      .update("okcir:discounts:checkout-review:v1").digest();
    const expired = `${payload}.${createHmac("sha256", signingKey).update(payload).digest("base64url")}`;
    const key = "b1200000-0000-4000-8000-000000000007";
    for (const body of [
      { ...prepared, reviewToken: expired, requestKey: key },
      { ...prepared, reviewToken: undefined, requestKey: key },
      { ...prepared, phone: "081234567899", requestKey: key },
    ]) {
      const response = await storeContext.request.post("/api/checkout/place-order", { data: body });
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("CHECKOUT_REVIEW_REQUIRED");
    }
    expect((await getMockRequests()).filter((entry) => !entry.path.startsWith("/__control/"))).toEqual([]);
    expect((await storeContext.request.get(`/api/checkout/requests/${key}`)).status()).toBe(404);
  });

  test("parallel same-key requests return one accepted order and dispatch one Sales Order", async () => {
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000004" };
    const responses = await Promise.all([0, 1].map(() => storeContext.request.post("/api/checkout/place-order", {
      data: body, headers: { "x-e2e-payment-mock": "true" },
    })));
    const results = await Promise.all(responses.map((response) => response.json()));
    for (const result of results) if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 201]);
    expect(results[0].data.orderId).toBe(results[1].data.orderId);
    const writes = (await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"));
    expect(writes).toHaveLength(1);
    const lookup = await (await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).json();
    expect(lookup.data.orderId).toBe(results[0].data.orderId);
  });

  test("an ambiguous external create returns the committed order with 202 and replay never re-POSTs", async () => {
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000005" };
    await mockControl("PUT", "/__control/scenario", { scenario: "timeout-after-apply" });
    const response = await storeContext.request.post("/api/checkout/place-order", { data: body });
    const result = await response.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(response.status()).toBe(202);
    expect(result.success).toBe(true);
    expect(result.data.state).toBe("manual_review");
    expect(result.data.paymentAvailable).toBe(false);
    const writesBefore = (await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"));
    expect(writesBefore).toHaveLength(1);
    const replay = await storeContext.request.post("/api/checkout/place-order", { data: body });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data.orderId).toBe(result.data.orderId);
    const lookup = await (await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).json();
    expect(lookup.data.orderId).toBe(result.data.orderId);
    expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(1);
    await mockControl("PUT", "/__control/scenario", { scenario: "success" });
  });

  test("delivery review binds address and service and requires reapproval even when quoted total falls", async () => {
    await storeContext.request.delete("/api/cart");
    expect((await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: DELIVERY_BRANCH_ID, quantity: 1 },
    })).ok()).toBe(true);
    const cart = await (await storeContext.request.get("/api/cart")).json();
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", { locationId: DELIVERY_LOCATION_ID, itemId: MOCK_ITEM_ID, onHand: 5 });
    await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal", rates: 30000 });
    const destination = { recipientName: "Review Fixture", phone: CONTACT_PHONE, fullAddress: "Jl. Review Fixture No. 1",
      provinceId: "01", cityId: "0101", districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: false };
    const quoteResponse = await storeContext.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [cart.data.items[0].id], newAddress: destination },
    });
    expect(quoteResponse.status()).toBe(200);
    const service = (await quoteResponse.json()).data.services[0];
    const intent = { fulfillmentMethod: "delivery", itemIds: [cart.data.items[0].id], contactPhone: CONTACT_PHONE,
      contactEmail: CONTACT_EMAIL, newAddress: destination, saveAddress: false,
      saveRequestId: "b1200000-0000-4000-8000-000000000008", courierId: service.courierId, serviceId: service.serviceId,
      originFingerprint: service.originFingerprint, approvedPricing: service.pricing, promoSelection: { kind: "none" } };
    const previewResponse = await storeContext.request.post(PREVIEW_PATH, { data: intent });
    expect(previewResponse.status()).toBe(200);
    const preview = (await previewResponse.json()).data;
    expectRupiah(preview.pricing.total, 196500, "delivery preview total");
    expectRupiah(preview.pricing.ppnAmount, 16500, "goods-only PPN");
    const body = { ...intent, reviewToken: preview.reviewToken, requestKey: "b1200000-0000-4000-8000-000000000006" };
    await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal", rates: 20000 });
    const refused = await storeContext.request.post("/api/checkout/place-order", { data: body });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("DELIVERY_REPRICE_REQUIRED");
    expect((await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).status()).toBe(404);
    expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(0);
    await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal", rates: 30000 });
    const placed = await storeContext.request.post("/api/checkout/place-order", { data: body, headers: { "x-e2e-payment-mock": "true" } });
    const result = await placed.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(placed.status()).toBe(201);
    const detail = (await (await storeContext.request.get(`/api/orders/${result.data.orderId}`)).json()).data;
    expectRupiah(detail.total, 196500, "delivery accepted total");
    expectRupiah(detail.pricingSnapshot.expectedProviderPayable, 180000, "delivery provider payable");
  });

  test("a receipt insert failure rolls back the order and stock hold and the same key can succeed later", async () => {
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000009" };
    await mockControl("POST", "/__control/reset");
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/stocks/ensure", { locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_ITEM_ID, onHand: 1, sellPrice: GOODS_AMOUNT });
    await pool.query(`CREATE OR REPLACE FUNCTION checkout02_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'checkout02 fixture transaction failure'; END $$`);
    await pool.query("DROP TRIGGER IF EXISTS checkout02_reject_receipt ON checkout_request");
    await pool.query(`CREATE TRIGGER checkout02_reject_receipt BEFORE INSERT ON checkout_request
      FOR EACH ROW WHEN (NEW.request_key='b1200000-0000-4000-8000-000000000009') EXECUTE FUNCTION checkout02_reject_receipt()`);
    try {
      const failed = await storeContext.request.post("/api/checkout/place-order", { data: body });
      expect(failed.status()).toBe(503);
      expect((await failed.json()).code).toBe("POLICY_UNAVAILABLE");
      expect((await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).status()).toBe(404);
      expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(0);
      await pool.query("DROP TRIGGER checkout02_reject_receipt ON checkout_request");
      const retried = await storeContext.request.post("/api/checkout/place-order", { data: body, headers: { "x-e2e-payment-mock": "true" } });
      const result = await retried.json();
      if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
      expect(retried.status()).toBe(201);
      expectRupiah((await (await storeContext.request.get(`/api/orders/${result.data.orderId}`)).json()).data.total, TOTAL_AMOUNT, "rollback retry amount");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS checkout02_reject_receipt ON checkout_request");
      await pool.query("DROP FUNCTION IF EXISTS checkout02_reject_receipt()");
    }
  });

  test("the existing sweep claims a never-dispatched checkout intent once and result reads never dispatch it", async () => {
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000010" };
    await pool.query(`CREATE OR REPLACE FUNCTION checkout02_reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'checkout02 fixture before external claim'; END $$`);
    await pool.query("DROP TRIGGER IF EXISTS checkout02_reject_claim ON jubelio_sales_operation");
    // Hanya create intent milik fixture checkout ini; trigger memutus atomic
    // claim sebelum external boundary, bukan memalsukan lock/counter code.
    await pool.query(`CREATE TRIGGER checkout02_reject_claim BEFORE UPDATE ON jubelio_sales_operation
      FOR EACH ROW WHEN (OLD.type='create' AND OLD.status='intent' AND NEW.status='dispatched_unknown')
      EXECUTE FUNCTION checkout02_reject_claim()`);
    let orderId = "";
    try {
      const placed = await storeContext.request.post("/api/checkout/place-order", { data: body });
      const result = await placed.json();
      orderId = result.data?.orderId ?? "";
      if (orderId) fixtureOrderIds.add(orderId);
      expect(placed.status()).toBe(202);
      expect(result.data.state).toBe("processing");
      await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`);
      expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(0);
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS checkout02_reject_claim ON jubelio_sales_operation");
      await pool.query("DROP FUNCTION IF EXISTS checkout02_reject_claim()");
    }
    for (let i = 0; i < 2; i++) {
      const swept = await storeContext.request.post("/api/cron/sweep-reservations", {
        headers: { "x-cron-secret": "checkout02-cron-fixture-only" },
      });
      expect(swept.status()).toBe(200);
    }
    const writes = (await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path === "/sales/orders/" && entry.body.ref_no === orderId);
    expect(writes).toHaveLength(1);
    const result = await (await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).json();
    expect(result.data.orderId).toBe(orderId);
  });

  test("canonical item ordering does not conflict and duplicate selected IDs are rejected", async () => {
    await preparePickup();
    expect((await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_SECOND_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    })).ok()).toBe(true);
    const cart = (await (await storeContext.request.get("/api/cart")).json()).data;
    const intent = { phone: CONTACT_PHONE, email: CONTACT_EMAIL, pickupDate: nextOpenDate(), pickupTime: PICKUP_TIME,
      selectedItemIds: cart.items.map((item: { id: string }) => item.id).sort().reverse(), promoSelection: { kind: "none" } };
    const preview = (await (await storeContext.request.post(PREVIEW_PATH, { data: intent })).json()).data;
    expectRupiah(preview.pricing.total, 388500, "two-line preview total");
    const location = await pool.query("SELECT jubelio_location_id FROM branch WHERE id=$1", [homeBranchId]);
    await mockControl("POST", "/__control/stocks/ensure", { locationId: location.rows[0].jubelio_location_id,
      itemId: MOCK_SECOND_ITEM_ID, onHand: 5, sellPrice: 200000 });
    const body = { ...intent, reviewToken: preview.reviewToken, requestKey: "b1200000-0000-4000-8000-000000000022" };
    const invalid = await storeContext.request.post("/api/checkout/place-order", { data: { ...body,
      selectedItemIds: [intent.selectedItemIds[0], intent.selectedItemIds[0]] } });
    expect(invalid.status()).toBe(400);
    const placed = await storeContext.request.post("/api/checkout/place-order", { data: body, headers: { "x-e2e-payment-mock": "true" } });
    const result = await placed.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(placed.status()).toBe(201);
    const replay = await storeContext.request.post("/api/checkout/place-order", { data: { ...body, selectedItemIds: [...body.selectedItemIds].sort() } });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data.orderId).toBe(result.data.orderId);
  });

  test("definitive create rejection keeps the accepted result and releases only its own hold", async () => {
    const prepared = await preparePickup();
    const body = { ...prepared, requestKey: "b1200000-0000-4000-8000-000000000023" };
    await mockControl("PUT", "/__control/scenario", { scenario: "reject-create" });
    const rejected = await storeContext.request.post("/api/checkout/place-order", { data: body });
    const result = await rejected.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(result.success).toBe(true);
    expect(result.data.state).toBe("failed");
    const replay = await storeContext.request.post("/api/checkout/place-order", { data: body });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data.orderId).toBe(result.data.orderId);
    await mockControl("PUT", "/__control/scenario", { scenario: "success" });
    const next = await storeContext.request.post("/api/checkout/place-order", { data: { ...body,
      requestKey: "b1200000-0000-4000-8000-000000000024" }, headers: { "x-e2e-payment-mock": "true" } });
    const nextResult = await next.json();
    if (nextResult.data?.orderId) fixtureOrderIds.add(nextResult.data.orderId);
    expect(next.status()).toBe(201);
    expect(nextResult.data.orderId).not.toBe(result.data.orderId);
    expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path === "/sales/orders/")).toHaveLength(2);
    expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.includes("cancel"))).toHaveLength(0);
  });

  test("a placement exceeding the total transaction budget rolls back before any dispatch", async () => {
    test.setTimeout(60_000);
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000020" };
    await pool.query(`CREATE OR REPLACE FUNCTION checkout02_slow_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(2.7); RETURN NEW; END $$`);
    const triggers = [
      ["orders", "NEW.contact_email='checkout-review-mock-e2e@example.com'"],
      ["order_item", "NEW.variant_id='e2e-checkout-review-variant'"],
      ["branch_stock", "NEW.product_variant_id='e2e-checkout-review-variant' AND NEW.pending_remote_stock > OLD.pending_remote_stock"],
      ["checkout_request", "NEW.request_key='b1200000-0000-4000-8000-000000000020'"],
    ];
    try {
      for (const [table, predicate] of triggers) {
        await pool.query(`DROP TRIGGER IF EXISTS checkout02_slow_transaction ON ${table}`);
        await pool.query(`CREATE TRIGGER checkout02_slow_transaction BEFORE ${table === "branch_stock" ? "UPDATE" : "INSERT"} ON ${table}
          FOR EACH ROW WHEN (${predicate}) EXECUTE FUNCTION checkout02_slow_transaction()`);
      }
      const response = await storeContext.request.post("/api/checkout/place-order", { data: body, headers: { "x-e2e-payment-mock": "true" } });
      const result = await response.json();
      if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
      expect(response.status()).toBe(503);
      expect((await storeContext.request.get(`/api/checkout/requests/${body.requestKey}`)).status()).toBe(404);
      expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(0);
    } finally {
      for (const [table] of triggers) await pool.query(`DROP TRIGGER IF EXISTS checkout02_slow_transaction ON ${table}`);
      await pool.query("DROP FUNCTION IF EXISTS checkout02_slow_transaction()");
    }
  });

  test("serialization rollback is retried at most three attempts before one external dispatch", async () => {
    const body = { ...await preparePickup(), requestKey: "b1200000-0000-4000-8000-000000000021" };
    await pool.query("DROP SEQUENCE IF EXISTS checkout02_serialization_sequence");
    await pool.query("CREATE SEQUENCE checkout02_serialization_sequence START 1");
    await pool.query(`CREATE OR REPLACE FUNCTION checkout02_serialization_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF nextval('checkout02_serialization_sequence') < 3 THEN
        RAISE EXCEPTION 'checkout02 serialization fixture' USING ERRCODE='40001';
      END IF; RETURN NEW; END $$`);
    await pool.query("DROP TRIGGER IF EXISTS checkout02_serialization_failure ON checkout_request");
    await pool.query(`CREATE TRIGGER checkout02_serialization_failure BEFORE INSERT ON checkout_request
      FOR EACH ROW WHEN (NEW.request_key='b1200000-0000-4000-8000-000000000021') EXECUTE FUNCTION checkout02_serialization_failure()`);
    try {
      const response = await storeContext.request.post("/api/checkout/place-order", { data: body, headers: { "x-e2e-payment-mock": "true" } });
      const result = await response.json();
      if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
      expect(response.status()).toBe(201);
      expect(Number((await pool.query("SELECT last_value FROM checkout02_serialization_sequence")).rows[0].last_value)).toBe(3);
      expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path === "/sales/orders/")).toHaveLength(1);
      expectRupiah((await (await storeContext.request.get(`/api/orders/${result.data.orderId}`)).json()).data.total, TOTAL_AMOUNT, "serialized retry amount");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS checkout02_serialization_failure ON checkout_request");
      await pool.query("DROP FUNCTION IF EXISTS checkout02_serialization_failure()");
      await pool.query("DROP SEQUENCE IF EXISTS checkout02_serialization_sequence");
    }
  });

  test("browser keeps the same request across a lost response and reload finds the committed order after cart removal", async () => {
    await preparePickup();
    const page = await storeContext.newPage();
    let orderId = "";
    let placements = 0;
    await page.route("**/api/checkout/place-order", async (route) => {
      placements++;
      const response = await route.fetch({ headers: { ...route.request().headers(), "x-e2e-payment-mock": "true" } });
      const result = await response.json();
      orderId = result.data?.orderId ?? result.orderId ?? "";
      if (orderId) fixtureOrderIds.add(orderId);
      await route.abort("connectionfailed"); // Backend response hilang; bukan stub checkout.
    });
    try {
      await page.goto("/cart");
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Checkout" }).click();
      await page.waitForURL("**/checkout");
      await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: "10:00" }).click();
      await page.getByRole("button", { name: "Lanjut" }).click();
      await page.getByLabel("Nomor Telepon *").fill(CONTACT_PHONE);
      await page.getByLabel("Email *").fill(CONTACT_EMAIL);
      await page.getByRole("button", { name: "Lanjut" }).click();
      await page.getByText(/Saya telah memeriksa pesanan/).click();
      await page.getByRole("button", { name: /Bayar/ }).click();
      await expect(page.getByRole("button", { name: "Periksa pesanan" })).toBeVisible();
      expect(orderId).toBeTruthy();
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/account/orders/${orderId}$`));
      await expect(page.getByText("Rp 166.500", { exact: true }).first()).toBeVisible();
      expect(placements).toBe(1);
      expect((await getMockRequests()).filter((entry) => entry.method === "POST" && entry.path.startsWith("/sales/"))).toHaveLength(1);
    } finally { await page.close(); }
  });

  test("preview enforces account admission60 and returns 429 with Retry-After despite forged IP headers", async () => {
    const prepared = await preparePickup();
    const { reviewToken: _token, ...intent } = prepared;
    void _token;
    // Fixture cleanup exact account bucket, bukan assertion ke counter internal.
    const owner = await pool.query("SELECT id FROM client WHERE email=$1", [TEST_USERS.store.email]);
    const hash = createHmac("sha256", "mock-e2e-only-shared-auth-secret-do-not-reuse")
      .update(`okcir:checkout-admission:v1:account:${owner.rows[0].id}`).digest("hex");
    await pool.query("DELETE FROM discount_request_window WHERE kind='preview:account' AND subject_hash=$1", [hash]);
    for (let i = 0; i < 60; i++) {
      const response = await storeContext.request.post(PREVIEW_PATH, {
        data: intent, headers: { "x-real-ip": `203.0.113.${i + 1}`, "x-forwarded-for": `203.0.113.${i + 1}` },
      });
      expect(response.status()).toBe(200);
    }
    const limited = await storeContext.request.post(PREVIEW_PATH, { data: intent });
    expect(limited.status()).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMITED");
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(Number(limited.headers()["retry-after"])).toBeLessThanOrEqual(60);
    expect(limited.headers()["cache-control"]).toBe("no-store");
    await pool.query("DELETE FROM discount_request_window WHERE kind='preview:account' AND subject_hash=$1", [hash]);
  });

  test("an oversized JSON body is rejected with 413 INPUT_LIMIT_EXCEEDED, no-store and a request id, before any provider work", async () => {
    // Independent limit literal from the approved spec §5.4 (413
    // INPUT_LIMIT_EXCEEDED = body limit exceeded, 256KiB). Every field of a
    // valid pickup body is length-bounded, so no conforming body can reach the
    // limit; the breach is expressed with an opaque padding member. The
    // limiter must therefore reject on SIZE ALONE — before shape validation
    // runs — so this case distinguishes 413 from 400 INPUT_INVALID (approved
    // spec §5.4 precedence), which is exactly the observed-bug boundary.
    const MAX_BODY_BYTES = 256 * 1024;
    const oversizedBody = JSON.stringify({
      phone: CONTACT_PHONE,
      email: CONTACT_EMAIL,
      pickupDate: nextOpenDate(),
      pickupTime: PICKUP_TIME,
      selectedItemIds: [],
      promoSelection: { kind: "none" },
      padding: "x".repeat(300 * 1024),
    });
    expect(
      new TextEncoder().encode(oversizedBody).byteLength,
      "the fixture request body must exceed the 256KiB checkout body limit"
    ).toBeGreaterThan(MAX_BODY_BYTES);

    // Fresh provider capture window: a rejected body must dispatch nothing.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");

    const response = await storeContext.request.post(PREVIEW_PATH, {
      headers: { "content-type": "application/json" },
      data: oversizedBody,
    });
    const raw = await response.text();

    expect(
      response.status(),
      `an oversized body must answer 413 INPUT_LIMIT_EXCEEDED, not a shape error (body: ${raw.slice(0, 300)})`
    ).toBe(413);
    expect(
      response.headers()["content-type"] ?? "",
      "the limit rejection must answer JSON"
    ).toContain("application/json");

    const body = JSON.parse(raw) as {
      success?: unknown;
      code?: unknown;
      error?: unknown;
      requestId?: unknown;
    };
    expect(body.success, "the limit rejection must not report success").toBe(false);
    expect(
      body.code,
      `the limit rejection must use the approved error code (code: ${String(body.code)})`
    ).toBe("INPUT_LIMIT_EXCEEDED");

    // Same no-store contract as every other checkout response.
    expect(
      response.headers()["cache-control"] ?? "",
      "the limit rejection must not be cacheable"
    ).toContain("no-store");

    // A traceable id for support: the endpoint's existing envelope carries the
    // request id on the header and mirrors it in the body.
    const headerRequestId = response.headers()["x-request-id"] ?? "";
    expect(
      headerRequestId.length,
      "the limit rejection must expose a non-empty x-request-id header"
    ).toBeGreaterThan(0);
    expect(
      body.requestId,
      "the limit rejection body must carry the same request id as the header"
    ).toBe(headerRequestId);

    // Safe error surface: the rejection must not echo the oversized payload.
    expect(
      raw.length,
      "the limit rejection must not echo the request body back"
    ).toBeLessThan(4096);

    // === No provider BUSINESS write =======================================
    const captured = await getMockRequests();
    expect(
      captured.filter((record) => record.path.startsWith("/sales/")),
      "a rejected oversized body must not dispatch any provider Sales request"
    ).toEqual([]);
  });

  test("a selection mixing one branch-bound line with one branchless line is rejected with 400 INPUT_INVALID before any pricing or provider work", async () => {
    // Branch resolution is the seam: the request selects two DISTINCT variants,
    // one bound to the active pickup branch and one whose cart line has no
    // branch at all. A branchless line cannot be priced for pickup, so the
    // preview must reject the whole selection instead of silently dropping the
    // unresolvable line and pricing the remainder.
    //
    // Two DISTINCT variants are deliberate: selecting the same variant twice
    // would trip the pricing duplicate-line guard first and hide this boundary
    // behind an unrelated error.
    const cleared = await storeContext.request.delete("/api/cart");
    expect(
      cleared.ok(),
      `clearing the customer cart failed: ${await cleared.text()}`
    ).toBe(true);

    const added = await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: homeBranchId, quantity: 1 },
    });
    expect(
      added.ok(),
      `adding the owned branch fixture variant failed: ${await added.text()}`
    ).toBe(true);

    const cart = (await (await storeContext.request.get("/api/cart")).json()) as {
      data?: { id?: string };
    };
    const cartId = cart.data?.id ?? "";
    expect(
      cartId,
      "the caller cart must exist before the null-branch fixture line is written"
    ).toBeTruthy();

    // Schema-valid setup row with the EXACT owned id: `cart_item.branch_id` is
    // nullable, which is how a branchless cart line legitimately exists. No
    // order/usage row is created or read here.
    await pool.query(
      `INSERT INTO cart_item (id, cart_id, variant_id, branch_id, quantity)
       VALUES ($1, $2, $3, NULL, 1)`,
      [FIXTURE_NULL_BRANCH_CART_LINE_ID, cartId, FIXTURE_SECOND_VARIANT_ID]
    );

    const populated = (await (
      await storeContext.request.get("/api/cart")
    ).json()) as {
      data?: {
        items?: Array<{ id: string; variantId: string; branchId: string | null }>;
      };
    };
    const lines = populated.data?.items ?? [];
    const branchLine = lines.find((item) => item.variantId === FIXTURE_VARIANT_ID);
    const nullBranchLine = lines.find(
      (item) => item.variantId === FIXTURE_SECOND_VARIANT_ID
    );
    expect(branchLine, "the branch-bound fixture line must be in the cart").toBeTruthy();
    expect(
      nullBranchLine?.id,
      "the null-branch fixture line must be the exact owned cart row"
    ).toBe(FIXTURE_NULL_BRANCH_CART_LINE_ID);
    expect(
      nullBranchLine?.branchId,
      "the second fixture line must carry no branch for this case to be mixed"
    ).toBeNull();
    expect(branchLine!.branchId).toBe(homeBranchId);
    expect(
      branchLine!.id,
      "the two selected lines must be distinct cart rows"
    ).not.toBe(nullBranchLine!.id);

    // Fresh provider capture window: a mixed-branch rejection must dispatch
    // nothing at all.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");

    const response = await storeContext.request.post(PREVIEW_PATH, {
      data: {
        phone: CONTACT_PHONE,
        email: CONTACT_EMAIL,
        pickupDate: nextOpenDate(),
        pickupTime: PICKUP_TIME,
        selectedItemIds: [branchLine!.id, nullBranchLine!.id],
        promoSelection: { kind: "none" },
      },
    });
    const raw = await response.text();

    // Diagnostic safety: a regression that prices this selection answers 200
    // with a signed review token, so the failure message must never embed the
    // raw body. Surface the status, the approved error code and a money-only
    // summary instead (no token, no fingerprint, no raw payload).
    let diagnostic = `status ${response.status()}`;
    try {
      const reported = JSON.parse(raw) as {
        code?: unknown;
        data?: { pricing?: Record<string, unknown> };
      };
      diagnostic += `, code ${String(reported.code ?? "-")}`;
      const reportedPricing = reported.data?.pricing;
      if (reportedPricing) {
        diagnostic +=
          `, priced subtotal=${String(reportedPricing.subtotal)}` +
          ` total=${String(reportedPricing.total)}`;
      }
    } catch {
      diagnostic += ", non-JSON body";
    }

    expect(
      response.status(),
      `a selection with a branchless line must answer 400 INPUT_INVALID, not a priced preview (${diagnostic})`
    ).toBe(400);
    expect(
      response.headers()["content-type"] ?? "",
      "the mixed-branch rejection must answer JSON"
    ).toContain("application/json");

    const body = JSON.parse(raw) as {
      success?: unknown;
      code?: unknown;
      error?: unknown;
      requestId?: unknown;
    };
    expect(body.success, "the mixed-branch rejection must not report success").toBe(
      false
    );
    expect(
      body.code,
      `the mixed-branch rejection must use the approved error code (code: ${String(body.code)})`
    ).toBe("INPUT_INVALID");
    // A rejected selection must not be priced at all — no token, no breakdown.
    expect(
      raw,
      "the mixed-branch rejection must not return pricing or a review token"
    ).not.toContain("reviewToken");

    // Same no-store + request id contract as every other preview response.
    expect(
      response.headers()["cache-control"] ?? "",
      "the mixed-branch rejection must not be cacheable"
    ).toContain("no-store");
    const headerRequestId = response.headers()["x-request-id"] ?? "";
    expect(
      headerRequestId.length,
      "the mixed-branch rejection must expose a non-empty x-request-id header"
    ).toBeGreaterThan(0);
    expect(
      body.requestId,
      "the mixed-branch rejection body must carry the same request id as the header"
    ).toBe(headerRequestId);

    // === No provider BUSINESS write =======================================
    const captured = await getMockRequests();
    expect(
      captured.filter((record) => record.path.startsWith("/sales/")),
      "an unresolvable-branch selection must not dispatch any provider Sales request"
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ticket 11 — subsidi ongkir delivery lewat app HTTP nyata (gate1, mock
// provider). Literal independen: goods150000, ongkir30000, cap20000 → subsidi
// 20000, ongkir net10000, PPN16500, total176500, provider payable160000;
// booking/quote cost tetap original30000.
// ---------------------------------------------------------------------------
test.describe("shipping subsidy delivery (ticket 11)", () => {
  const SHIP_PUBLIC_ID = `${FIXTURE_PREFIX}-ship-public`;
  const SHIP_PUBLIC_REV = `${SHIP_PUBLIC_ID}-rev`;
  const SHIP_PUBLIC_BEN = `${SHIP_PUBLIC_ID}-ben`;
  const SHIP_MANUAL_ID = `${FIXTURE_PREFIX}-ship-manual`;
  const SHIP_MANUAL_REV = `${SHIP_MANUAL_ID}-rev`;
  const SHIP_MANUAL_BEN = `${SHIP_MANUAL_ID}-ben`;
  const SHIP_MANUAL_CODE = `${SHIP_MANUAL_ID}-code`;
  const SHIP_CODE = "ONGKIRMOCK15";
  const GOODS_SMALL_ID = `${FIXTURE_PREFIX}-ship-goods-small`;
  const GOODS_SMALL_REV = `${GOODS_SMALL_ID}-rev`;
  const GOODS_SMALL_BEN = `${GOODS_SMALL_ID}-ben`;
  const SHIP_OFFERS = [SHIP_PUBLIC_ID, SHIP_MANUAL_ID, GOODS_SMALL_ID];
  const SHIP_TOTAL = 176_500;
  const SHIP_NET = 10_000;
  const SHIP_SUBSIDY = 20_000;
  const SHIP_PAYABLE = 160_000;

  test.beforeAll(async () => {
    await pool.query(
      `INSERT INTO discount_offer (id,key,activation_kind,actor_identity) VALUES
         ($1,$4,'public','fixture'), ($2,$5,'manual_only','fixture'), ($3,$6,'public','fixture')`,
      [SHIP_PUBLIC_ID, SHIP_MANUAL_ID, GOODS_SMALL_ID,
        `${SHIP_PUBLIC_ID}-key`, `${SHIP_MANUAL_ID}-key`, `${GOODS_SMALL_ID}-key`]
    );
    await pool.query(
      `INSERT INTO discount_offer_revision
         (id,offer_id,revision_no,name,currency,min_subtotal,published_at,actor_identity) VALUES
         ($1,$4,1,'Subsidi Ongkir Mock','IDR','0',now(),'fixture'),
         ($2,$5,1,'Kode Subsidi Ongkir Mock','IDR','0',now(),'fixture'),
         ($3,$6,1,'Coupon Kecil Mock','IDR','0',now(),'fixture')`,
      [SHIP_PUBLIC_REV, SHIP_MANUAL_REV, GOODS_SMALL_REV,
        SHIP_PUBLIC_ID, SHIP_MANUAL_ID, GOODS_SMALL_ID]
    );
    await pool.query(
      `INSERT INTO discount_benefit (id,revision_id,kind,scope,cap_amount,fixed_amount) VALUES
         ($1,$4,'shipping','shipping','20000',null),
         ($2,$5,'shipping','shipping','15000',null),
         ($3,$6,'fixed_goods','goods',null,'5000')`,
      [SHIP_PUBLIC_BEN, SHIP_MANUAL_BEN, GOODS_SMALL_BEN,
        SHIP_PUBLIC_REV, SHIP_MANUAL_REV, GOODS_SMALL_REV]
    );
    await pool.query(
      `UPDATE discount_offer SET state='enabled',current_revision_id=v.rev,quota_count=50,
         budget_amount='1000000',per_client_limit=1
       FROM (VALUES ($1,$2),($3,$4),($5,$6)) AS v(id,rev) WHERE discount_offer.id=v.id`,
      [SHIP_PUBLIC_ID, SHIP_PUBLIC_REV, SHIP_MANUAL_ID, SHIP_MANUAL_REV,
        GOODS_SMALL_ID, GOODS_SMALL_REV]
    );
    await pool.query(
      `INSERT INTO discount_offer_usage (offer_id) VALUES ($1),($2),($3)`,
      [SHIP_PUBLIC_ID, SHIP_MANUAL_ID, GOODS_SMALL_ID]
    );
    await pool.query(
      `INSERT INTO discount_code (id,offer_id,activation_kind,canonical_code,state,actor_identity)
       VALUES ($1,$2,'manual_only',$3,'active','fixture')`,
      [SHIP_MANUAL_CODE, SHIP_MANUAL_ID, SHIP_CODE]
    );
  });

  test.afterAll(async () => {
    await pool.query(`DELETE FROM discount_redemption_event WHERE redemption_id IN
      (SELECT id FROM discount_redemption WHERE offer_id = ANY($1))`, [SHIP_OFFERS]);
    await pool.query(`DELETE FROM order_discount_allocation WHERE redemption_id IN
      (SELECT id FROM discount_redemption WHERE offer_id = ANY($1))`, [SHIP_OFFERS]);
    await pool.query(`DELETE FROM discount_redemption WHERE offer_id = ANY($1)`, [SHIP_OFFERS]);
    await pool.query(`DELETE FROM discount_client_usage WHERE offer_id = ANY($1)`, [SHIP_OFFERS]);
    await pool.query(`DELETE FROM discount_code WHERE offer_id = ANY($1)`, [SHIP_OFFERS]);
    await pool.query(`DELETE FROM discount_offer_usage WHERE offer_id = ANY($1)`, [SHIP_OFFERS]);
    await pool.query(
      `UPDATE discount_offer SET state='draft',current_revision_id=null WHERE id = ANY($1)`,
      [SHIP_OFFERS]
    );
    await pool.query(`DELETE FROM discount_benefit WHERE revision_id = ANY($1)`,
      [[SHIP_PUBLIC_REV, SHIP_MANUAL_REV, GOODS_SMALL_REV]]);
    await pool.query(`DELETE FROM discount_offer_revision WHERE id = ANY($1)`,
      [[SHIP_PUBLIC_REV, SHIP_MANUAL_REV, GOODS_SMALL_REV]]);
    await pool.query(`DELETE FROM discount_offer WHERE id = ANY($1)`, [SHIP_OFFERS]);
  });

  const DESTINATION = {
    recipientName: "Shipping Fixture", phone: CONTACT_PHONE,
    fullAddress: "Jl. Shipping Fixture No. 1", provinceId: "01", cityId: "0101",
    districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: false,
  };

  async function deliveryIntent(promoSelection: Record<string, unknown>) {
    await storeContext.request.delete("/api/cart");
    expect((await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: DELIVERY_BRANCH_ID, quantity: 1 },
    })).ok()).toBe(true);
    const cart = await (await storeContext.request.get("/api/cart")).json();
    await mockControl("POST", "/__control/reset");
    await mockControl("POST", "/__control/stocks/ensure", {
      locationId: DELIVERY_LOCATION_ID, itemId: MOCK_ITEM_ID, onHand: 5,
    });
    await mockControl("PUT", "/__control/shipment", { scenario: "rate-normal", rates: 30000 });
    const quoteResponse = await storeContext.request.post("/api/checkout/delivery-quote", {
      data: { itemIds: [cart.data.items[0].id], newAddress: DESTINATION },
    });
    expect(quoteResponse.status()).toBe(200);
    const service = (await quoteResponse.json()).data.services[0];
    return {
      fulfillmentMethod: "delivery",
      itemIds: [cart.data.items[0].id],
      contactPhone: CONTACT_PHONE,
      contactEmail: CONTACT_EMAIL,
      newAddress: DESTINATION,
      saveAddress: false,
      saveRequestId: "b1200000-0000-4000-8000-0000000000aa",
      courierId: service.courierId,
      serviceId: service.serviceId,
      originFingerprint: service.originFingerprint,
      approvedPricing: service.pricing,
      promoSelection,
    } as Record<string, unknown>;
  }

  test("public shipping: preview/pickup-disabled/swap confirmation/place menyimpan snapshot original+net dan satu allocation", async () => {
    // Pickup dengan Offer shipping → disabled dengan alasan, bukan subsidi0.
    const { reviewToken: _pickupToken, ...pickupIntent } = await preparePickup();
    const pickupRejected = await storeContext.request.post(PREVIEW_PATH, {
      data: { ...pickupIntent, promoSelection: { kind: "public", offerId: SHIP_PUBLIC_ID } },
    });
    expect(pickupRejected.status()).toBe(409);
    expect((await pickupRejected.json()).code).toBe("PROMO_INELIGIBLE");

    const intent = await deliveryIntent({ kind: "public", offerId: SHIP_PUBLIC_ID });
    const previewResponse = await storeContext.request.post(PREVIEW_PATH, { data: intent });
    expect(previewResponse.status(), await previewResponse.text()).toBe(200);
    const preview = (await previewResponse.json()).data;
    expectRupiah(preview.pricing.total, SHIP_TOTAL, "shipping preview total");
    expectRupiah(preview.pricing.shippingBeforeSubsidy, 30000, "original shipping");
    expectRupiah(preview.pricing.shippingSubsidy, SHIP_SUBSIDY, "subsidy");
    expectRupiah(preview.pricing.shippingCost, SHIP_NET, "net shipping");
    expectRupiah(preview.pricing.ppnAmount, 16500, "goods-only PPN");
    expect(preview.promo.kind).toBe("public");
    expectRupiah(preview.promo.benefitAmount, SHIP_SUBSIDY, "promo amount");

    // Ganti shipping → coupon kecil (5000) menaikkan total final → dialog wajib.
    const swap = await storeContext.request.post(PREVIEW_PATH, {
      data: {
        ...intent,
        promoSelection: { kind: "public", offerId: GOODS_SMALL_ID },
        previous: {
          reviewToken: preview.reviewToken,
          promoSelection: { kind: "public", offerId: SHIP_PUBLIC_ID },
        },
      },
    });
    expect(swap.status(), await swap.text()).toBe(200);
    const swapped = (await swap.json()).data;
    expect(swapped.requiresIncreaseConfirmation).toBe(true);
    expect(swapped.replacement.direction).toBe("increase");
    expectRupiah(swapped.replacement.previous.total, 176500, "previous total");
    expectRupiah(swapped.replacement.candidate.total, 190950, "candidate total");

    const body = {
      ...intent,
      approvedPricing: preview.pricing,
      reviewToken: preview.reviewToken,
      requestKey: "b1200000-0000-4000-8000-0000000000a1",
    };
    const placed = await storeContext.request.post("/api/checkout/place-order", {
      data: body, headers: { "x-e2e-payment-mock": "true" },
    });
    const result = await placed.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(placed.status(), JSON.stringify(result)).toBe(201);

    const row = await pool.query(
      `SELECT total::text AS total, shipping_cost::text AS net, shipping_subsidy::text AS subsidy,
              shipping_before_subsidy::text AS before, merchant_funding::text AS funding,
              delivery_snapshot, pricing_snapshot
         FROM orders WHERE id=$1`, [result.data.orderId]);
    expectRupiah(row.rows[0].total, SHIP_TOTAL, "order total");
    expectRupiah(row.rows[0].net, SHIP_NET, "order net shipping");
    expectRupiah(row.rows[0].subsidy, SHIP_SUBSIDY, "order subsidy");
    expectRupiah(row.rows[0].before, 30000, "order original shipping");
    expectRupiah(row.rows[0].funding, SHIP_SUBSIDY, "merchant funding");
    expect(row.rows[0].delivery_snapshot.service.shippingCost).toBe(30000);
    expectRupiah(row.rows[0].delivery_snapshot.pricing.shippingCost, SHIP_NET, "snapshot net");
    expectRupiah(row.rows[0].pricing_snapshot.expectedProviderPayable, SHIP_PAYABLE, "payable");

    const allocation = await pool.query(
      `SELECT a.component, a.order_item_id, a.amount::text AS amount
         FROM order_discount_allocation a
         JOIN discount_redemption r ON r.id=a.redemption_id
        WHERE r.order_id=$1`, [result.data.orderId]);
    expect(allocation.rows).toEqual([
      { component: "offer_shipping", order_item_id: null, amount: "20000.00" },
    ]);
    const redemption = await pool.query(
      `SELECT status, activation_kind, benefit_amount::text AS amount
         FROM discount_redemption WHERE order_id=$1`, [result.data.orderId]);
    expect(redemption.rows[0]).toEqual({
      status: "reserved", activation_kind: "public", amount: "20000.00",
    });
    const intentRow = await pool.query(
      `SELECT payload->'create'->>'originalShipmentCost' AS original,
              payload->'create'->>'shippingCost' AS net,
              payload->'create'->>'expectedProviderPayable' AS payable
         FROM jubelio_sales_operation WHERE order_id=$1 AND type='create'`,
      [result.data.orderId]);
    expect(intentRow.rows[0]).toEqual({
      original: "30000", net: "10000", payable: "160000",
    });

    // Cart berubah setelah review: token lama tidak boleh membawa promo/uang
    // invalid ke order; customer harus review ulang (bukan retry buta).
    await storeContext.request.post("/api/cart/items", {
      data: { variantId: FIXTURE_VARIANT_ID, branchId: DELIVERY_BRANCH_ID, quantity: 1 },
    });
    const stale = await storeContext.request.post(PREVIEW_PATH, {
      data: {
        ...intent,
        promoSelection: { kind: "none" },
        acknowledgeInvalidation: true,
        previous: {
          reviewToken: preview.reviewToken,
          promoSelection: { kind: "public", offerId: SHIP_PUBLIC_ID },
        },
      },
    });
    // Baris lama bisa hilang (404) atau konteks berubah (409): keduanya memaksa
    // reselect; yang dilarang adalah memakai token lama seolah masih sah.
    expect([404, 409]).toContain(stale.status());
    expect((await stale.json()).success).toBe(false);
  }, 90_000);

  test("manual shipping: kode aktif memakai slot yang sama dan menyimpan Redemption manual", async () => {
    const intent = await deliveryIntent({ kind: "manual", code: SHIP_CODE });
    const previewResponse = await storeContext.request.post(PREVIEW_PATH, { data: intent });
    expect(previewResponse.status(), await previewResponse.text()).toBe(200);
    const preview = (await previewResponse.json()).data;
    expect(preview.promo.kind).toBe("manual");
    expectRupiah(preview.pricing.shippingSubsidy, 15000, "manual subsidy");
    expectRupiah(preview.pricing.shippingCost, 15000, "manual net shipping");
    expectRupiah(preview.pricing.total, 181500, "manual total");

    const placed = await storeContext.request.post("/api/checkout/place-order", {
      data: {
        ...intent,
        approvedPricing: preview.pricing,
        reviewToken: preview.reviewToken,
        requestKey: "b1200000-0000-4000-8000-0000000000a2",
      },
      headers: { "x-e2e-payment-mock": "true" },
    });
    const result = await placed.json();
    if (result.data?.orderId) fixtureOrderIds.add(result.data.orderId);
    expect(placed.status(), JSON.stringify(result)).toBe(201);

    const redemption = await pool.query(
      `SELECT activation_kind, code_id, benefit_amount::text AS amount
         FROM discount_redemption WHERE order_id=$1`, [result.data.orderId]);
    expect(redemption.rows[0]).toEqual({
      activation_kind: "manual_only", code_id: SHIP_MANUAL_CODE, amount: "15000.00",
    });
    const allocation = await pool.query(
      `SELECT component, order_item_id, amount::text AS amount
         FROM order_discount_allocation a JOIN discount_redemption r ON r.id=a.redemption_id
        WHERE r.order_id=$1`, [result.data.orderId]);
    expect(allocation.rows).toEqual([
      { component: "offer_shipping", order_item_id: null, amount: "15000.00" },
    ]);
    const detail = await (await storeContext.request.get(`/api/orders/${result.data.orderId}`)).json();
    expect(detail.success).toBe(true);
  }, 90_000);
});
