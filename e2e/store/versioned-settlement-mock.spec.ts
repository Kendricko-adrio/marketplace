/**
 * Ticket 01 — ONE public-HTTP tracer bullet for the paid v1 (versioned) pickup
 * settlement, entirely on the isolated loopback provider run.
 *
 * What this single case proves, in order:
 *
 *   gate1 goods 150.000 + website PPN 11% 16.500 → customer/Midtrans 166.500
 *   while the provider ledger stays goods-only (Sales Order 150.000, invoice
 *   150.000 settled to due 0, payment 150.000 on account 2 / type 0).
 *
 *   (1) the order is placed through the REAL public checkout seam
 *       (`POST /api/checkout/place-order`, no `x-e2e-payment-mock` shortcut) and
 *       the Snap create is CAPTURED at the controlled loopback boundary;
 *   (2) no pickup code exists while the order is still `pending_payment`;
 *   (3) Midtrans' mock status is authoritative: a signed settlement webhook is
 *       re-verified by the app against the loopback `/v2/{order}/status` and the
 *       customer's OWN order then reports `ready_for_pickup` with a pickup code;
 *   (4) the persisted versioned snapshot is pinned (contract 1 / engine 1 /
 *       provider contract 2) and its money equals the ticket worked example;
 *   (5) the provider side is verified by independent GETs of the Sales Order,
 *       the invoice (`payment_amount` = grand total → due 0) and the payment
 *       (`account_id` 2, `payment_type` 0, one invoice association);
 *   (6) a DUPLICATE signed callback is idempotent: no second Snap, Sales Order,
 *       invoice or payment POST, and the money/pickup code do not move.
 *
 * Ticket 01 juga punya SATU tracer bullet DELIVERY (kontrak v1) di file ini:
 * barang 150.000 + ongkir 30.000, PPN 11% atas net barang saja = 16.500 →
 * pelanggan 196.500 sementara ledger provider (SO/invoice/payment) 180.000 =
 * net barang + net ongkir. Order delivery yang lunas TETAP `processing` (tanpa
 * pickup code, tanpa alasan blokir) dan callback duplikat tidak menulis ulang
 * SO/invoice/payment.
 *
 * Independent source of truth: the approved ticket worked money (150.000 goods,
 * 11% PPN → 16.500, 166.500 customer, 150.000 provider payable; delivery:
 * +30.000 ongkir → 196.500 customer / 180.000 provider), the settlement
 * contract literals (account 2 / type 0 from the mock run's settlement config)
 * and this spec's own fixture rows — never a value recomputed from the
 * implementation and never a mock-internal counter or auto-increment id.
 *
 * Test-only seams: the public store HTTP API (auth, cart, delivery quote,
 * place-order, owned order detail, Midtrans webhook), the loopback mock's public
 * provider API and its `/__control/*` fixtures, plus SQL that touches ONLY this
 * spec's own disposable fixture rows (contact emails
 * `versioned-settlement-e2e@example.test` and
 * `versioned-settlement-delivery@example.test`, the synthetic delivery origin
 * branch and its address) and restores the `discounts.contractVersion` gate in a
 * `finally`.
 *
 * RED / FAILURE CONTRACT: if the loopback provider runtime fields are missing
 * (`E2E_PROVIDER_MOCKS=true` + loopback `JUBELIO_SALES_MOCK_API_BASE_URL` /
 * `MIDTRANS_MOCK_API_BASE_URL`), the Snap / Sales-Order captures below are
 * empty and this spec fails with the captured request list as diagnostics. The
 * mock must never be loosened to hide that.
 *
 * Run (the parent registers this file in playwright.mock.config.ts testMatch):
 *   npx playwright test --config=playwright.mock.config.ts e2e/store/versioned-settlement-mock.spec.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import crypto from "node:crypto";
import { Pool } from "pg";
import { deleteRetainedOrderFixtures } from "../../packages/db/src/testing/retained-order-fixtures";
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
const ISOLATED_MOCK_PORTS = new Set(["3110", "3112"]);
const DISPOSABLE_DB_PREFIX = "marketplace_discounts_test_";

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "versioned-settlement-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["store", STORE_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !ISOLATED_MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `versioned-settlement-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); isolated mock ports are 3110/3112`
      );
    }
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "versioned-settlement-mock.spec.ts requires an explicit disposable DATABASE_URL"
    );
  }
  const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
  if (!database.startsWith(DISPOSABLE_DB_PREFIX)) {
    throw new Error(
      `versioned-settlement-mock.spec.ts refuses a non-disposable database (${database}); expected a ${DISPOSABLE_DB_PREFIX}* database`
    );
  }
  if (!process.env.MIDTRANS_SERVER_KEY) {
    throw new Error(
      "versioned-settlement-mock.spec.ts requires the loopback MIDTRANS_SERVER_KEY supplied by playwright.mock.config.ts"
    );
  }
}

// ---------------------------------------------------------------------------
// Independent money (ticket 01 worked example — NOT implementation output):
// goods 150.000, website PPN 11% = 16.500, customer total 166.500, dan
// kontrak provider3 mencatat PPN yang sama pada SO/invoice/payment (166.500).
// ---------------------------------------------------------------------------

const GOODS_PRICE = 150_000;
const GOODS_QUANTITY = 1;
const EXPECTED_PPN_RATE = 11;
const EXPECTED_PPN_AMOUNT = 16_500;
const EXPECTED_CUSTOMER_TOTAL = 166_500;
const SNAP_GROSS_AMOUNT = `${EXPECTED_CUSTOMER_TOTAL}.00`;
const PROVIDER_PAYABLE = 166_500;
// Settlement contract of this run (playwright.mock.config.ts): account 2, type 0.
const PROVIDER_PAYMENT_ACCOUNT_ID = 2;
const PROVIDER_PAYMENT_TYPE = 0;
const PROVIDER_CONTACT_ID = -1; // the generic walk-in contact ("Pelanggan Umum")

// ---------------------------------------------------------------------------
// Own fixtures (exact markers only — seeded rows are never touched)
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "e2e-versioned-settlement";
const FIXTURE_PRODUCT_ID = `${FIXTURE_PREFIX}-product`;
const FIXTURE_PRODUCT_SLUG = `${FIXTURE_PREFIX}-anchor`;
const FIXTURE_PRODUCT_NAME = "Versioned Settlement Anchor";
const FIXTURE_VARIANT_ID = `${FIXTURE_PREFIX}-variant`;
const FIXTURE_VARIANT_SKU = "VSETTLE-01";
const MOCK_JUBELIO_ITEM_ID = 920002;
const MOCK_STOCK_UNITS = 5;
const CONTACT_EMAIL = "versioned-settlement-e2e@example.test";

// ---------------------------------------------------------------------------
// Delivery fixture (ticket 01, paid delivery lifecycle) — own synthetic origin
// branch + own destination book entry. Seeded branches stay origin-NULL.
// ---------------------------------------------------------------------------

const DELIVERY_CONTACT_EMAIL = "versioned-settlement-delivery@example.test";
const DELIVERY_ORIGIN_BRANCH_ID = `${FIXTURE_PREFIX}-delivery-origin`;
const DELIVERY_ORIGIN_BRANCH_CODE = "VSETDLV";
const DELIVERY_JUBELIO_LOCATION_ID = 920003;
const DELIVERY_STREET = "Jl. Versioned Settlement Delivery E2E No. 1";

// Independent delivery money (ticket 01 worked example, never recomputed):
//   barang 150.000 + ongkir 30.000, PPN 11% atas net barang saja 16.500
//   → pelanggan/Midtrans 196.500 = provider (SO/invoice/payment) 196.500.
const SHIPPING_RATE = 30_000;
const DELIVERY_PPN_AMOUNT = 16_500;
const DELIVERY_CUSTOMER_TOTAL = 196_500;
const DELIVERY_PROVIDER_PAYABLE = 196_500;
const DELIVERY_SNAP_GROSS_AMOUNT = `${DELIVERY_CUSTOMER_TOTAL}.00`;

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let pool: Pool | null = null;
let storeContext: BrowserContext | null = null;
let homeBranchId = "";
let homeLocationId = 0;
let deliveryAddressId = "";
let previousGate: Array<{
  value: string;
  type: string;
  description: string | null;
}> = [];
let gateApplied = false;

function db(): Pool {
  if (!pool) {
    throw new Error("the fixture pool is not initialised (beforeAll must run first)");
  }
  return pool;
}

function store(): BrowserContext {
  if (!storeContext) {
    throw new Error("the store context is not initialised (beforeAll must run first)");
  }
  return storeContext;
}

// ---------------------------------------------------------------------------
// Independent types for the loopback provider reads
// ---------------------------------------------------------------------------

type MockRequestRecord = {
  method: string;
  path: string;
  body: Record<string, unknown>;
};

type MockSalesOrder = {
  salesorder_id: number;
  sub_total: number;
  total_disc: number;
  total_tax: number;
  original_shipment_cost: number;
  shipping_cost: number;
  grand_total: number;
  is_canceled: boolean;
  invoice_id: number | null;
  invoice_no: string | null;
};

type MockInvoice = {
  invoice_id: number;
  invoice_no: string;
  salesorder_id: number;
  sub_total: string;
  total_disc: string;
  total_tax: string;
  grand_total: string;
  payment_amount: number;
  items: Array<Record<string, unknown>>;
};

type MockPayment = {
  payment_id: number;
  amount: string;
  account_id: number;
  payment_type: number;
  contact_id: number;
  note: string;
  // The association line is enriched from the CURRENT invoice state: grand
  // total + remaining due travel with it (contract v2 §10.2).
  invoices: Array<{
    invoice_id: number;
    payment_amount: number;
    salesorder_id: number;
    grand_total: number;
    due: number;
  }>;
};

/** The immutable delivery snapshot block as the owned order detail exposes it. */
type OwnedDeliverySnapshot = {
  address: { fullAddress: string; areaId: string; postalCode: string };
  origin: { branchId: string; name: string; zipcode: string; areaId: string | null };
  parcel: { weight: number; items: Array<{ quantity: number }> };
  service: {
    courierId: number;
    serviceId: number;
    name: string;
    shippingCost: string | number;
  };
  pricing: { subtotal: string; shippingCost: string; total: string };
};

type OwnedOrderDetail = {
  id: string;
  status: string;
  paymentStatus: string;
  fulfillmentMethod: string;
  pickupCode: string | null;
  pickupDate: string | null;
  fulfillmentBlockedReason: string | null;
  subtotal: string;
  shippingCost: string;
  total: string;
  ppnAmount: string;
  deliverySnapshot: OwnedDeliverySnapshot | null;
  snapRedirectUrl: string | null;
  pricingContractVersion: number | null;
  pricingEngineVersion: number | null;
  providerContractVersion: number | null;
  pricingSnapshot: Record<string, string> | null;
  jubelioSalesOrderId: number | null;
  jubelioInvoiceId: number | null;
  jubelioPaymentId: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Loopback mock control + provider seam (never forwards to a live host). */
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
    throw new Error(
      `jubelio-mock ${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function getMockRequests(): Promise<MockRequestRecord[]> {
  const result = await mockControl<{ data?: MockRequestRecord[] }>(
    "GET",
    "/__control/requests"
  );
  return result.data ?? [];
}

/** Bounded diagnostics: which requests actually reached the loopback mock. */
function describeRequests(records: MockRequestRecord[]): string {
  if (records.length === 0) return "(no request reached the loopback mock)";
  return records.map((record) => `${record.method} ${record.path}`).join(", ");
}

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  email: string,
  password: string
): Promise<void> {
  const response = await context.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email, password },
  });
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${email}: ${await response.text()}`
  ).toBe(true);
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

/** Classic Snap signature: SHA512(order_id + status_code + gross_amount + key). */
function signMidtransNotification(orderId: string, grossAmount: string): string {
  return crypto
    .createHash("sha512")
    .update(`${orderId}200${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
}

async function postSignedWebhook(
  orderId: string,
  grossAmount: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${STORE_BASE_URL}/api/webhooks/midtrans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      transaction_status: "settlement",
      status_code: "200",
      gross_amount: grossAmount,
      signature_key: signMidtransNotification(orderId, grossAmount),
    }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** The customer's OWN order detail (session-pinned public read). */
async function readOwnedOrder(orderId: string): Promise<OwnedOrderDetail> {
  const response = await store().request.get(`/api/orders/${orderId}`);
  expect(
    response.ok(),
    `GET /api/orders/${orderId} failed: ${await response.text()}`
  ).toBe(true);
  const body = (await response.json()) as {
    success: boolean;
    data: OwnedOrderDetail;
  };
  expect(body.success).toBe(true);
  return body.data;
}

/** Applies the gate1 (v1) pricing contract for this spec only. */
async function applyGate1(): Promise<void> {
  previousGate = (
    await db().query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key = 'discounts.contractVersion'"
    )
  ).rows;
  await db().query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ('discounts.contractVersion', '1', 'number', 'Disposable E2E fixture (ticket 01 settlement)')
     ON CONFLICT (key) DO UPDATE
       SET value = '1', type = 'number', description = 'Disposable E2E fixture (ticket 01 settlement)'`
  );
  gateApplied = true;
}

/** Restores the pre-run pricing gate (idempotent; safe from `finally`). */
async function restoreGate1(): Promise<void> {
  if (!gateApplied || !pool) return;
  gateApplied = false;
  if (previousGate.length > 0) {
    const row = previousGate[0];
    await pool.query(
      "UPDATE system_config SET value = $1, type = $2, description = $3 WHERE key = 'discounts.contractVersion'",
      [row.value, row.type, row.description]
    );
    return;
  }
  await pool.query("DELETE FROM system_config WHERE key = 'discounts.contractVersion'");
}

/** FK-ordered, contact-scoped teardown of this spec's own orders. */
async function deleteOwnedOrders(): Promise<void> {
  const rows = await db().query<{ id: string }>(
    "SELECT id FROM orders WHERE contact_email = $1",
    [CONTACT_EMAIL]
  );
  await deleteRetainedOrderFixtures(db(), rows.rows.map((row) => row.id));
}

/** Same teardown for the DELIVERY fixture orders (own contact email only). */
async function deleteOwnedDeliveryOrders(): Promise<void> {
  const rows = await db().query<{ id: string }>(
    "SELECT id FROM orders WHERE contact_email = $1",
    [DELIVERY_CONTACT_EMAIL]
  );
  await deleteRetainedOrderFixtures(db(), rows.rows.map((row) => row.id));
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted run (own contact emails only).
  await deleteOwnedOrders();
  await deleteOwnedDeliveryOrders();

  // Precondition: the seeded PPN contract fixture this money depends on.
  const ppn = await db().query<{ value: string }>(
    "SELECT value FROM system_config WHERE key = 'tax.ppnRatePercent'"
  );
  expect(
    ppn.rows[0]?.value,
    "this spec requires the seeded tax.ppnRatePercent = 11 (npm run db:seed)"
  ).toBe("11");

  // The isolated Home Branch of the seeded admin identity (has provider stock).
  const branch = await db().query<{
    branch_id: string;
    jubelio_location_id: number | null;
  }>(
    `SELECT b.id AS branch_id, b.jubelio_location_id
     FROM "user" u JOIN branch b ON b.id = u.branch_id
     WHERE u.username = $1 AND b.status = 'aktif' AND b.jubelio_location_id IS NOT NULL
     LIMIT 1`,
    [TEST_USERS.admin.identifier]
  );
  expect(
    branch.rows[0]?.branch_id,
    "the seeded admin must have an active Jubelio-linked Home Branch (npm run db:seed)"
  ).toBeTruthy();
  homeBranchId = branch.rows[0].branch_id;
  homeLocationId = branch.rows[0].jubelio_location_id ?? 0;
  expect(
    homeLocationId,
    "the seeded admin's Home Branch must be linked to a Jubelio location"
  ).toBeGreaterThan(0);

  // Own fixture catalog rows: exactly one Rp150.000 variant at the Home Branch.
  await db().query("DELETE FROM cart_item WHERE variant_id = $1", [FIXTURE_VARIANT_ID]);
  await db().query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
  await db().query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, $2, $3, '150000.00', 'aktif')`,
    [FIXTURE_PRODUCT_ID, FIXTURE_PRODUCT_NAME, FIXTURE_PRODUCT_SLUG]
  );
  await db().query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id)
     VALUES ($1, $2, $3, '150000.00', true, $4)`,
    [FIXTURE_VARIANT_ID, FIXTURE_PRODUCT_ID, FIXTURE_VARIANT_SKU, MOCK_JUBELIO_ITEM_ID]
  );
  // Provisional local mirror only; the provider observation still authorizes
  // the checkout and reconciles this row before the Sales Order create.
  await db().query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, $3, NOW())`,
    [homeBranchId, FIXTURE_VARIANT_ID, MOCK_STOCK_UNITS]
  );

  // Delivery slice fixtures: the seeded branches stay origin-NULL by design,
  // so the delivery origin is a SYNTHETIC branch (own id/location) with its
  // own stock mirror at that provider location.
  await db().query("DELETE FROM branch_stock WHERE branch_id = $1", [
    DELIVERY_ORIGIN_BRANCH_ID,
  ]);
  await db().query("DELETE FROM branch WHERE id = $1", [DELIVERY_ORIGIN_BRANCH_ID]);
  await db().query(
    `INSERT INTO branch
       (id, name, code, city, address, status, shipping_phone, shipping_address,
        shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'E2E Versioned Settlement Delivery Origin', $2, 'Jakarta Pusat',
             $3, 'aktif', '021999888778',
             'Jl. Versioned Settlement Origin E2E No. 4, Gudang E',
             '01234', '01010101', $4)`,
    [
      DELIVERY_ORIGIN_BRANCH_ID,
      DELIVERY_ORIGIN_BRANCH_CODE,
      "Jl. Versioned Settlement Origin E2E No. 4",
      DELIVERY_JUBELIO_LOCATION_ID,
    ]
  );
  await db().query(
    `UPDATE branch SET shipping_province_id = '01', shipping_city_id = '0101',
            shipping_district_id = '010101', shipping_province = 'Fixture Province',
            shipping_city = 'Fixture City', shipping_district = 'Fixture District',
            shipping_area = 'Fixture Area'
     WHERE id = $1`,
    [DELIVERY_ORIGIN_BRANCH_ID]
  );
  await db().query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock,
        on_order_stock, provider_reserved_stock, available_stock, provider_stock_synced_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, $3, NOW())`,
    [DELIVERY_ORIGIN_BRANCH_ID, FIXTURE_VARIANT_ID, MOCK_STOCK_UNITS]
  );

  // Own session through the public Better Auth HTTP seam. Deliberately NO
  // `x-e2e-payment-mock` header: the payment must go through the real Snap
  // client against the controlled loopback provider.
  storeContext = await browser.newContext({
    baseURL: STORE_BASE_URL,
    extraHTTPHeaders: {},
  });
  await httpSignIn(
    storeContext,
    STORE_BASE_URL,
    TEST_USERS.store.email,
    TEST_USERS.store.password
  );

  // Destination book entry for the delivery slice (server-verified region
  // chain against the loopback region fixture).
  await db().query("DELETE FROM address WHERE full_address = $1", [
    DELIVERY_STREET,
  ]);
  const address = await storeContext.request.post("/api/addresses", {
    data: {
      recipientName: "Penerima Versioned Settlement",
      phone: "081300000022",
      fullAddress: DELIVERY_STREET,
      provinceId: "01",
      cityId: "0101",
      districtId: "010101",
      areaId: "01010101",
      postalCode: "01234",
      isDefault: false,
    },
  });
  expect(
    address.ok(),
    `membuat alamat fixture delivery gagal: ${await address.text()}`
  ).toBe(true);
  const addressBody = (await address.json()) as {
    data?: { id?: string };
    id?: string;
  };
  deliveryAddressId = String(addressBody.data?.id ?? addressBody.id ?? "");
  expect(deliveryAddressId.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await storeContext?.close().catch(() => {});
  if (!pool) return;
  await restoreGate1().catch(() => {});
  await deleteOwnedOrders();
  await deleteOwnedDeliveryOrders();
  await pool.query("DELETE FROM cart_item WHERE variant_id = $1", [FIXTURE_VARIANT_ID]);
  await pool.query("DELETE FROM address WHERE full_address = $1", [DELIVERY_STREET]);
  await pool.query("DELETE FROM branch_stock WHERE branch_id = $1", [
    DELIVERY_ORIGIN_BRANCH_ID,
  ]);
  // Fixture rows cascade: product → product_variant → branch_stock.
  await pool.query("DELETE FROM product WHERE id = $1", [FIXTURE_PRODUCT_ID]);
  await pool.query("DELETE FROM branch WHERE id = $1", [DELIVERY_ORIGIN_BRANCH_ID]);
  await pool.end();
});

// ---------------------------------------------------------------------------
// The single tracer bullet
// ---------------------------------------------------------------------------

test.describe("public-HTTP pickup settlement (ticket 01, one tracer bullet)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("gate1 pickup 166.500 settles once at the loopback provider: SO/invoice/payment 166.500 linked, due 0, account 2/type 0, no duplicate post on replay", async () => {
    // Fresh loopback provider state + the fixture stock observation.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");
    expect(
      (
        await mockControl("POST", "/__control/stocks/ensure", {
          locationId: homeLocationId,
          itemId: MOCK_JUBELIO_ITEM_ID,
          onHand: MOCK_STOCK_UNITS,
        })
      ).status
    ).toBe("ok");

    // Deterministic cart start for this fixture variant only.
    const cartBefore = (await (await store().request.get("/api/cart")).json()) as {
      data?: { items?: Array<{ id: string; variantId: string }> };
    };
    for (const item of cartBefore.data?.items ?? []) {
      if (item.variantId === FIXTURE_VARIANT_ID) {
        await store().request.delete(`/api/cart/items/${item.id}`);
      }
    }

    await applyGate1();
    try {
      // === 1. Real placement over the public checkout seam ==================
      const added = await store().request.post("/api/cart/items", {
        data: {
          variantId: FIXTURE_VARIANT_ID,
          branchId: homeBranchId,
          quantity: GOODS_QUANTITY,
        },
      });
      expect(
        added.ok(),
        `adding the fixture variant failed: ${await added.text()}`
      ).toBe(true);

      const cart = (await (await store().request.get("/api/cart")).json()) as {
        data?: {
          pricingContractVersion?: number;
          items?: Array<{ id: string; variantId: string }>;
        };
      };
      expect(
        cart.data?.pricingContractVersion,
        "the gate1 pricing contract (discounts.contractVersion = 1) must drive this checkout"
      ).toBe(1);
      const cartItemId = (cart.data?.items ?? []).find(
        (item) => item.variantId === FIXTURE_VARIANT_ID
      )?.id;
      expect(cartItemId, "the fixture variant must be in the cart").toBeTruthy();

      const pickupDate = nextOpenDate();
      const previewResponse = await store().request.post("/api/checkout/preview", {
        data: {
          phone: "081234567890",
          email: CONTACT_EMAIL,
          pickupDate,
          pickupTime: "10:00",
          selectedItemIds: [cartItemId],
          promoSelection: { kind: "none" },
        },
      });
      const previewText = await previewResponse.text();
      expect(
        previewResponse.ok(),
        `gate1 preview must issue the review token: ${previewText}`
      ).toBe(true);
      const preview = JSON.parse(previewText) as {
        data: { reviewToken: string };
      };
      expect(preview.data.reviewToken).toBeTruthy();

      const placedResponse = await store().request.post(
        "/api/checkout/place-order",
        {
          data: {
            requestKey: crypto.randomUUID(),
            reviewToken: preview.data.reviewToken,
            promoSelection: { kind: "none" },
            phone: "081234567890",
            email: CONTACT_EMAIL,
            pickupDate,
            pickupTime: "10:00",
            selectedItemIds: [cartItemId],
          },
        }
      );
      const placedText = await placedResponse.text();
      expect(
        placedResponse.status(),
        `place-order must succeed through the real loopback Snap boundary: ${placedText}`
      ).toBe(201);
      const placed = JSON.parse(placedText) as {
        success: boolean;
        orderId: string;
        redirectUrl: string;
      };
      expect(placed.success, `place-order reported: ${placedText}`).toBe(true);
      const orderId = placed.orderId;
      expect(orderId, "place-order must return the durable orderId").toBeTruthy();

      // === 2. The Snap create really went to the loopback boundary ==========
      const captured = await getMockRequests();
      const snaps = captured.filter(
        (record) =>
          record.method === "POST" &&
          record.path === "/snap/v1/transactions" &&
          (record.body.transaction_details as { order_id?: string } | undefined)
            ?.order_id === orderId
      );
      expect(
        snaps,
        `the Snap create must reach the loopback provider (captured: ${describeRequests(captured)}). ` +
          `An empty list means the controlled-provider runtime fields did not take effect ` +
          `(E2E_PROVIDER_MOCKS=true, MIDTRANS_MOCK_API_BASE_URL / JUBELIO_SALES_MOCK_API_BASE_URL = ${MOCK_BASE_URL}); ` +
          `that failure must stay visible instead of being mocked away in the app or the mock.`
      ).toHaveLength(1);
      expect(snaps[0].body.transaction_details).toEqual({
        order_id: orderId,
        gross_amount: EXPECTED_CUSTOMER_TOTAL,
      });
      expect(
        snaps[0].body.item_details,
        "the Snap lines are the website ledger: goods + website PPN"
      ).toEqual([
        {
          id: FIXTURE_VARIANT_ID,
          name: FIXTURE_PRODUCT_NAME,
          price: GOODS_PRICE,
          quantity: GOODS_QUANTITY,
        },
        { id: "PPN", name: `PPN ${EXPECTED_PPN_RATE}%`, price: EXPECTED_PPN_AMOUNT, quantity: 1 },
      ]);
      expect(
        placed.redirectUrl,
        "the Snap redirect must stay on the controlled loopback mock"
      ).toBe(`${MOCK_BASE_URL}/snap/${orderId}`);

      // === 3. The provider Sales Order is goods-only (no website PPN) ======
      const soPosts = captured.filter(
        (record) =>
          record.method === "POST" &&
          record.path === "/sales/orders/" &&
          record.body.salesorder_id === 0 &&
          record.body.ref_no === orderId
      );
      expect(
        soPosts,
        `exactly ONE goods-only Sales Order create POST (captured: ${describeRequests(captured)})`
      ).toHaveLength(1);
      expect(soPosts[0].body).toMatchObject({
        sub_total: GOODS_PRICE,
        total_disc: 0,
        // Kontrak provider3: PPN yang dibayar customer ikut tercatat pada SO.
        total_tax: 16500,
        grand_total: PROVIDER_PAYABLE,
        location_id: homeLocationId,
        contact_id: PROVIDER_CONTACT_ID,
      });
      const soItems = soPosts[0].body.items as Array<Record<string, unknown>> | undefined;
      expect(soItems).toHaveLength(1);
      expect(soItems?.[0]).toMatchObject({
        item_id: MOCK_JUBELIO_ITEM_ID,
        qty_in_base: GOODS_QUANTITY,
        price: GOODS_PRICE,
        disc_amount: 0,
        tax_id: -2,
        tax_amount: 16500,
        amount: PROVIDER_PAYABLE,
      });

      // === 4. Gate: paid? no. pickup code? never before settlement =========
      const pending = await readOwnedOrder(orderId);
      expect({
        status: pending.status,
        paymentStatus: pending.paymentStatus,
        pickupCode: pending.pickupCode,
      }).toEqual({
        status: "pending_payment",
        paymentStatus: "pending",
        pickupCode: null,
      });
      expect(Number(pending.total), "the website ledger charges goods + PPN").toBe(
        EXPECTED_CUSTOMER_TOTAL
      );
      expect(Number(pending.ppnAmount)).toBe(EXPECTED_PPN_AMOUNT);

      // === 5. Authoritative Midtrans settlement + signed webhook ===========
      expect(
        (
          await mockControl("PUT", "/__control/midtrans-status", {
            orderId,
            transactionStatus: "settlement",
            grossAmount: SNAP_GROSS_AMOUNT,
            paymentType: "gopay",
            transactionId: "versioned-settlement-txn",
          })
        ).status
      ).toBe("ok");
      const webhook = await postSignedWebhook(orderId, SNAP_GROSS_AMOUNT);
      expect(
        webhook.status,
        `the signed webhook must accept the customer total ${SNAP_GROSS_AMOUNT}: ${JSON.stringify(webhook.body)}`
      ).toBe(200);

      // === 6. The customer's OWN order reaches ready_for_pickup ============
      await expect
        .poll(async () => (await readOwnedOrder(orderId)).status, {
          timeout: 30_000,
          message:
            "the verified settlement must move the owned order to ready_for_pickup",
        })
        .toBe("ready_for_pickup");

      const settled = await readOwnedOrder(orderId);
      expect(settled.paymentStatus).toBe("paid");
      expect(settled.fulfillmentBlockedReason).toBeNull();
      expect(settled.pickupCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(
        settled.snapRedirectUrl,
        "the persisted Snap link is the loopback one that was captured"
      ).toBe(placed.redirectUrl);

      // === 7. Versioned snapshot (1 / 1 / 2) pinned to the worked money =====
      expect({
        pricingContractVersion: settled.pricingContractVersion,
        pricingEngineVersion: settled.pricingEngineVersion,
        providerContractVersion: settled.providerContractVersion,
      }).toEqual({
        pricingContractVersion: 1,
        pricingEngineVersion: 1,
        providerContractVersion: 3,
      });
      expect(settled.pricingSnapshot).toMatchObject({
        sourceGoodsSubtotal: "150000",
        subtotal: "150000",
        netGoods: "150000",
        ppnRatePercent: "11",
        taxableBase: "150000",
        ppnAmount: "16500",
        serviceFee: "0",
        shippingBeforeSubsidy: "0",
        shippingCost: "0",
        total: "166500",
        expectedProviderPayable: "166500",
        providerTax: { taxId: -2, ratePercent: "11" },
      });

      // === 8. Provider linkage: SO → invoice (due 0) → payment ==============
      const soId = settled.jubelioSalesOrderId as number;
      const invoiceId = settled.jubelioInvoiceId as number;
      const paymentId = settled.jubelioPaymentId as number;
      expect(soId, "confirmed Sales Order id").toBeGreaterThan(0);
      expect(invoiceId, "confirmed invoice id").toBeGreaterThan(0);
      expect(paymentId, "confirmed payment id").toBeGreaterThan(0);

      const so = await mockControl<MockSalesOrder>("GET", `/sales/orders/${soId}`);
      expect(so).toMatchObject({
        salesorder_id: soId,
        sub_total: GOODS_PRICE,
        total_disc: 0,
        total_tax: 16500,
        grand_total: PROVIDER_PAYABLE,
        is_canceled: false,
        invoice_id: invoiceId,
        invoice_no: expect.any(String),
      });

      const invoice = await mockControl<MockInvoice>(
        "GET",
        `/sales/invoices/${invoiceId}`
      );
      expect(invoice).toMatchObject({
        invoice_id: invoiceId,
        invoice_no: expect.any(String),
        salesorder_id: soId,
        sub_total: String(GOODS_PRICE),
        total_disc: "0",
        total_tax: "16500",
        grand_total: String(PROVIDER_PAYABLE),
        payment_amount: PROVIDER_PAYABLE,
      });
      expect(invoice.items, "one goods-only invoice line").toHaveLength(1);
      expect(invoice.items[0]).toMatchObject({
        item_id: MOCK_JUBELIO_ITEM_ID,
        qty_in_base: GOODS_QUANTITY,
        price: GOODS_PRICE,
        disc_amount: 0,
        tax_amount: 16500,
        amount: PROVIDER_PAYABLE,
      });
      expect(
        Number(invoice.grand_total) - invoice.payment_amount,
        "the settled invoice must have no remaining due"
      ).toBe(0);

      const payment = await mockControl<MockPayment>(
        "GET",
        `/sales/payments/${paymentId}`
      );
      expect(payment).toMatchObject({
        payment_id: paymentId,
        amount: String(PROVIDER_PAYABLE),
        account_id: PROVIDER_PAYMENT_ACCOUNT_ID,
        payment_type: PROVIDER_PAYMENT_TYPE,
        contact_id: PROVIDER_CONTACT_ID,
      });
      expect(payment.note, "the payment note carries the order linkage").toContain(
        orderId
      );
      expect(payment.invoices, "exactly ONE invoice association").toHaveLength(1);
      expect(payment.invoices[0]).toMatchObject({
        invoice_id: invoiceId,
        payment_amount: PROVIDER_PAYABLE,
      });
      // Kontrak provider3 menyatukan nominal: payment provider = total customer
      // (PPN sudah dibayar customer, tidak ada tagihan kedua).
      expect(Number(payment.amount)).toBe(PROVIDER_PAYABLE);
      expect(Number(payment.amount)).toBe(EXPECTED_CUSTOMER_TOTAL);

      // === 9. Duplicate callback is idempotent: no second provider write ====
      const replay = await postSignedWebhook(orderId, SNAP_GROSS_AMOUNT);
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.success).toBe(true);

      const afterReplay = await readOwnedOrder(orderId);
      expect({
        status: afterReplay.status,
        pickupCode: afterReplay.pickupCode,
      }).toEqual({
        status: "ready_for_pickup",
        pickupCode: settled.pickupCode,
      });

      const capturedAfter = await getMockRequests();
      const countPosts = (
        predicate: (record: MockRequestRecord) => boolean
      ): number => capturedAfter.filter(predicate).length;

      expect(
        countPosts(
          (record) =>
            record.method === "POST" && record.path === "/snap/v1/transactions"
        ),
        "one Snap transaction in total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/orders/" &&
            record.body.salesorder_id === 0 &&
            record.body.ref_no === orderId
        ),
        "one Sales Order create in total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/packlists/create-invoice" &&
            record.body.salesorder_id === soId
        ),
        "one invoice conversion in total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/payments/" &&
            String(record.body.note ?? "").includes(orderId)
        ),
        "one payment write in total"
      ).toBe(1);

      // The settled provider money did not move either.
      const invoiceAfter = await mockControl<MockInvoice>(
        "GET",
        `/sales/invoices/${invoiceId}`
      );
      expect(invoiceAfter.payment_amount).toBe(PROVIDER_PAYABLE);
      expect(Number(invoiceAfter.grand_total) - invoiceAfter.payment_amount).toBe(0);
    } finally {
      await restoreGate1();
    }
  });
});

// ---------------------------------------------------------------------------
// The single DELIVERY tracer bullet (paid lifecycle, contract v1)
// ---------------------------------------------------------------------------

test.describe("public-HTTP delivery settlement (ticket 01, satu tracer bullet)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("gate1 delivery 196.500 lunas tetap `processing` tanpa pickup code: SO/invoice/payment provider 196.500 tertaut (due 0, account 2/type 0), callback duplikat tidak menulis ulang", async () => {
    // Boundary loopback yang bersih: rate normal 30.000 + stok fixture di
    // location milik origin delivery sintetis ini.
    expect((await mockControl("POST", "/__control/reset")).status).toBe("ok");
    expect(
      (
        await mockControl("PUT", "/__control/shipment", {
          scenario: "rate-normal",
          rates: SHIPPING_RATE,
        })
      ).status
    ).toBe("ok");
    expect(
      (
        await mockControl("POST", "/__control/stocks/ensure", {
          locationId: DELIVERY_JUBELIO_LOCATION_ID,
          itemId: MOCK_JUBELIO_ITEM_ID,
          onHand: MOCK_STOCK_UNITS,
        })
      ).status
    ).toBe("ok");

    // Keranjang deterministik: hanya varian fixture milik spec ini.
    const cartBefore = (await (await store().request.get("/api/cart")).json()) as {
      data?: { items?: Array<{ id: string; variantId: string }> };
    };
    for (const item of cartBefore.data?.items ?? []) {
      if (item.variantId === FIXTURE_VARIANT_ID) {
        await store().request.delete(`/api/cart/items/${item.id}`);
      }
    }

    await applyGate1();
    try {
      const added = await store().request.post("/api/cart/items", {
        data: {
          variantId: FIXTURE_VARIANT_ID,
          branchId: DELIVERY_ORIGIN_BRANCH_ID,
          quantity: GOODS_QUANTITY,
        },
      });
      expect(
        added.ok(),
        `menambahkan varian fixture gagal: ${await added.text()}`
      ).toBe(true);
      const cart = (await (await store().request.get("/api/cart")).json()) as {
        data?: {
          pricingContractVersion?: number;
          items?: Array<{ id: string; variantId: string }>;
        };
      };
      expect(
        cart.data?.pricingContractVersion,
        "kontrak harga gate1 (discounts.contractVersion = 1) harus memayungi checkout ini"
      ).toBe(1);
      const cartItemId = (cart.data?.items ?? []).find(
        (item) => item.variantId === FIXTURE_VARIANT_ID
      )?.id;
      expect(cartItemId, "varian fixture harus berada di keranjang").toBeTruthy();

      // === 1. Seam quote: ongkir + PPN + total diturunkan server-side ========
      const quoteResponse = await store().request.post(
        "/api/checkout/delivery-quote",
        { data: { itemIds: [cartItemId], addressId: deliveryAddressId } }
      );
      expect(
        quoteResponse.ok(),
        `delivery-quote gagal: ${await quoteResponse.text()}`
      ).toBe(true);
      const service = (
        (await quoteResponse.json()) as {
          data: {
            services: Array<{
              originFingerprint: string;
              courierId: number;
              serviceId: number;
              name: string;
              shippingCost: number;
              pricing: Record<string, string>;
            }>;
          };
        }
      ).data.services[0];
      expect(service.pricing).toMatchObject({
        subtotal: "150000",
        shippingCost: "30000",
        serviceFee: "0",
        ppnRatePercent: `${EXPECTED_PPN_RATE}`,
        ppnAmount: "16500",
        total: "196500",
      });
      expect(service.shippingCost).toBe(SHIPPING_RATE);

      // === 2. Place-order lewat seam publik asli (tanpa x-e2e-payment-mock) ==
      const deliveryPreviewResponse = await store().request.post(
        "/api/checkout/preview",
        {
          data: {
            fulfillmentMethod: "delivery",
            itemIds: [cartItemId],
            addressId: deliveryAddressId,
            contactPhone: "081234567890",
            contactEmail: DELIVERY_CONTACT_EMAIL,
            courierId: service.courierId,
            serviceId: service.serviceId,
            approvedPricing: service.pricing,
            originFingerprint: service.originFingerprint,
            promoSelection: { kind: "none" },
          },
        }
      );
      const deliveryPreviewText = await deliveryPreviewResponse.text();
      expect(
        deliveryPreviewResponse.ok(),
        `gate1 delivery preview must issue the review token: ${deliveryPreviewText}`
      ).toBe(true);
      const deliveryPreview = JSON.parse(deliveryPreviewText) as {
        data: { reviewToken: string };
      };
      expect(deliveryPreview.data.reviewToken).toBeTruthy();

      const placedResponse = await store().request.post(
        "/api/checkout/place-order",
        {
          data: {
            requestKey: crypto.randomUUID(),
            reviewToken: deliveryPreview.data.reviewToken,
            promoSelection: { kind: "none" },
            fulfillmentMethod: "delivery",
            itemIds: [cartItemId],
            addressId: deliveryAddressId,
            contactPhone: "081234567890",
            contactEmail: DELIVERY_CONTACT_EMAIL,
            courierId: service.courierId,
            serviceId: service.serviceId,
            approvedPricing: service.pricing,
            originFingerprint: service.originFingerprint,
          },
        }
      );
      const placedText = await placedResponse.text();
      expect(
        placedResponse.status(),
        `place-order delivery harus sukses lewat boundary Snap loopback: ${placedText}`
      ).toBe(201);
      const placed = JSON.parse(placedText) as {
        success: boolean;
        orderId: string;
        redirectUrl: string;
      };
      expect(placed.success, `place-order melaporkan: ${placedText}`).toBe(true);
      const orderId = placed.orderId;
      expect(orderId, "place-order harus mengembalikan orderId yang durable").toBeTruthy();

      // === 3. Snap + Sales Order benar-benar mencapai boundary loopback =====
      const captured = await getMockRequests();
      const snaps = captured.filter(
        (record) =>
          record.method === "POST" &&
          record.path === "/snap/v1/transactions" &&
          (record.body.transaction_details as { order_id?: string } | undefined)
            ?.order_id === orderId
      );
      expect(
        snaps,
        `Snap create harus sampai ke provider loopback (terekam: ${describeRequests(captured)}). ` +
          `Daftar kosong berarti runtime controlled-provider tidak berlaku ` +
          `(E2E_PROVIDER_MOCKS=true, MIDTRANS_MOCK_API_BASE_URL / JUBELIO_SALES_MOCK_API_BASE_URL = ${MOCK_BASE_URL}); ` +
          `kegagalan itu harus tetap terlihat, bukan dimock-away.`
      ).toHaveLength(1);
      expect(snaps[0].body.transaction_details).toEqual({
        order_id: orderId,
        gross_amount: DELIVERY_CUSTOMER_TOTAL,
      });
      const snapItems = snaps[0].body.item_details as Array<{
        price: number;
        quantity: number;
      }>;
      // Baris Midtrans harus menjumlah ke total pelanggan: barang + ongkir + PPN.
      expect(snapItems.map((item) => item.price).sort((a, b) => a - b)).toEqual([
        DELIVERY_PPN_AMOUNT,
        SHIPPING_RATE,
        GOODS_PRICE,
      ]);
      expect(snapItems.every((item) => item.quantity === 1)).toBe(true);
      expect(
        snapItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        "Σ baris Snap harus sama dengan total pelanggan"
      ).toBe(DELIVERY_CUSTOMER_TOTAL);
      expect(
        placed.redirectUrl,
        "redirect Snap harus tetap di mock loopback yang dikendalikan"
      ).toBe(`${MOCK_BASE_URL}/snap/${orderId}`);

      const soPosts = captured.filter(
        (record) =>
          record.method === "POST" &&
          record.path === "/sales/orders/" &&
          record.body.salesorder_id === 0 &&
          record.body.ref_no === orderId
      );
      expect(
        soPosts,
        `tepat SATU Sales Order create untuk order ini (terekam: ${describeRequests(captured)})`
      ).toHaveLength(1);
      expect(soPosts[0].body).toMatchObject({
        sub_total: GOODS_PRICE,
        total_disc: 0,
        // Kontrak provider3: PPN barang ikut tercatat pada SO.
        total_tax: 16500,
        original_shipment_cost: SHIPPING_RATE,
        shipping_cost: SHIPPING_RATE,
        grand_total: DELIVERY_PROVIDER_PAYABLE,
        location_id: DELIVERY_JUBELIO_LOCATION_ID,
        ref_no: orderId,
        contact_id: PROVIDER_CONTACT_ID,
      });
      // Request provider tidak membawa key diskon ongkir sama sekali.
      expect(soPosts[0].body.shipping_cost_discount).toBeUndefined();
      const soItems = soPosts[0].body.items as
        | Array<Record<string, unknown>>
        | undefined;
      expect(soItems).toHaveLength(1);
      expect(soItems?.[0]).toMatchObject({
        item_id: MOCK_JUBELIO_ITEM_ID,
        qty_in_base: GOODS_QUANTITY,
        price: GOODS_PRICE,
        disc_amount: 0,
        tax_id: -2,
        tax_amount: 16500,
        // Nominal baris provider = harga barang + PPN baris (ongkir bukan
        // bagian pajak barang, dan header grand_total tetap 196500).
        amount: GOODS_PRICE + DELIVERY_PPN_AMOUNT,
      });

      // === 4. Sebelum lunas: belum bayar, belum ada pickup code =============
      const pending = await readOwnedOrder(orderId);
      expect({
        status: pending.status,
        paymentStatus: pending.paymentStatus,
        fulfillmentMethod: pending.fulfillmentMethod,
        pickupCode: pending.pickupCode,
        pickupDate: pending.pickupDate,
      }).toEqual({
        status: "pending_payment",
        paymentStatus: "pending",
        fulfillmentMethod: "delivery",
        pickupCode: null,
        pickupDate: null,
      });
      expect(Number(pending.total)).toBe(DELIVERY_CUSTOMER_TOTAL);
      expect(Number(pending.ppnAmount)).toBe(DELIVERY_PPN_AMOUNT);

      // Snapshot berversi (1/1/2) pin ke worked money delivery.
      expect({
        pricingContractVersion: pending.pricingContractVersion,
        pricingEngineVersion: pending.pricingEngineVersion,
        providerContractVersion: pending.providerContractVersion,
      }).toEqual({
        pricingContractVersion: 1,
        pricingEngineVersion: 1,
        providerContractVersion: 3,
      });
      expect(pending.pricingSnapshot).toMatchObject({
        fulfillmentMethod: "delivery",
        sourceGoodsSubtotal: "150000",
        subtotal: "150000",
        netGoods: "150000",
        shippingBeforeSubsidy: "30000",
        shippingSubsidy: "0",
        shippingCost: "30000",
        serviceFee: "0",
        taxableBase: "150000",
        ppnRatePercent: `${EXPECTED_PPN_RATE}`,
        ppnAmount: "16500",
        total: "196500",
        expectedProviderPayable: "196500",
        providerTax: { taxId: -2, ratePercent: "11" },
      });

      // Snapshot delivery: tujuan, origin sintetis, dan ongkir yang di-approve.
      expect(pending.deliverySnapshot).not.toBeNull();
      expect(pending.deliverySnapshot?.service).toMatchObject({
        name: service.name,
        courierId: service.courierId,
        serviceId: service.serviceId,
      });
      expect(Number(pending.deliverySnapshot?.service.shippingCost)).toBe(
        SHIPPING_RATE
      );
      expect(Number(pending.deliverySnapshot?.pricing.shippingCost)).toBe(
        SHIPPING_RATE
      );
      expect(Number(pending.deliverySnapshot?.pricing.total)).toBe(
        DELIVERY_CUSTOMER_TOTAL
      );
      expect(pending.deliverySnapshot?.address.fullAddress).toBe(DELIVERY_STREET);
      expect(pending.deliverySnapshot?.origin.branchId).toBe(
        DELIVERY_ORIGIN_BRANCH_ID
      );

      // === 5. Drift master/rate setelah order: snapshot tidak boleh bergerak ==
      // SQL hanya menyentuh baris fixture milik spec ini; assertion-nya HTTP.
      const snapshotBefore = JSON.stringify(pending.deliverySnapshot);
      const pricingBefore = JSON.stringify(pending.pricingSnapshot);
      await db().query(
        "UPDATE product_variant SET price = '990000.00' WHERE id = $1",
        [FIXTURE_VARIANT_ID]
      );
      expect(
        (
          await mockControl("PUT", "/__control/shipment", {
            scenario: "rate-normal",
            rates: 45_000,
          })
        ).status
      ).toBe("ok");
      const drifted = await readOwnedOrder(orderId);
      expect(JSON.stringify(drifted.deliverySnapshot)).toBe(snapshotBefore);
      expect(JSON.stringify(drifted.pricingSnapshot)).toBe(pricingBefore);
      expect(Number(drifted.deliverySnapshot?.service.shippingCost)).toBe(
        SHIPPING_RATE
      );

      // === 6. Midtrans yang berwenang: settlement + webhook bertanda tangan ==
      expect(
        (
          await mockControl("PUT", "/__control/midtrans-status", {
            orderId,
            transactionStatus: "settlement",
            grossAmount: DELIVERY_SNAP_GROSS_AMOUNT,
            paymentType: "gopay",
            transactionId: "versioned-delivery-txn",
          })
        ).status
      ).toBe("ok");
      const webhook = await postSignedWebhook(
        orderId,
        DELIVERY_SNAP_GROSS_AMOUNT
      );
      expect(
        webhook.status,
        `webhook bertanda tangan harus menerima total pelanggan ${DELIVERY_SNAP_GROSS_AMOUNT}: ${JSON.stringify(webhook.body)}`
      ).toBe(200);

      // === 7. Delivery lunas TETAP `processing`, tanpa pickup code ==========
      await expect
        .poll(async () => (await readOwnedOrder(orderId)).paymentStatus, {
          timeout: 30_000,
          message:
            "settlement terverifikasi harus menjadikan order milik pelanggan `paid`",
        })
        .toBe("paid");

      const settled = await readOwnedOrder(orderId);
      expect({
        status: settled.status,
        paymentStatus: settled.paymentStatus,
        fulfillmentMethod: settled.fulfillmentMethod,
        fulfillmentBlockedReason: settled.fulfillmentBlockedReason,
        pickupCode: settled.pickupCode,
        pickupDate: settled.pickupDate,
      }).toEqual({
        status: "processing",
        paymentStatus: "paid",
        fulfillmentMethod: "delivery",
        fulfillmentBlockedReason: null,
        pickupCode: null,
        pickupDate: null,
      });
      expect(
        settled.snapRedirectUrl,
        "link Snap yang tersimpan adalah link loopback yang tertangkap"
      ).toBe(placed.redirectUrl);
      // Ledger berversi tidak bergerak setelah settlement; ongkir quote asli
      // (30.000) tetap yang tersimpan di snapshot delivery.
      expect(JSON.stringify(settled.pricingSnapshot)).toBe(pricingBefore);
      expect(Number(settled.deliverySnapshot?.service.shippingCost)).toBe(
        SHIPPING_RATE
      );
      expect(Number(settled.deliverySnapshot?.pricing.shippingCost)).toBe(
        SHIPPING_RATE
      );
      expect(Number(settled.deliverySnapshot?.pricing.total)).toBe(
        DELIVERY_CUSTOMER_TOTAL
      );
      expect(settled.deliverySnapshot?.address.fullAddress).toBe(DELIVERY_STREET);

      // === 8. Tautan provider: SO → invoice (due 0) → payment ================
      const soId = settled.jubelioSalesOrderId as number;
      const invoiceId = settled.jubelioInvoiceId as number;
      const paymentId = settled.jubelioPaymentId as number;
      expect(soId, "Sales Order provider terkonfirmasi").toBeGreaterThan(0);
      expect(invoiceId, "invoice provider terkonfirmasi").toBeGreaterThan(0);
      expect(paymentId, "payment provider terkonfirmasi").toBeGreaterThan(0);

      const so = await mockControl<MockSalesOrder>(
        "GET",
        `/sales/orders/${soId}`
      );
      expect(so).toMatchObject({
        salesorder_id: soId,
        sub_total: GOODS_PRICE,
        total_disc: 0,
        total_tax: 16500,
        original_shipment_cost: SHIPPING_RATE,
        shipping_cost: SHIPPING_RATE,
        grand_total: DELIVERY_PROVIDER_PAYABLE,
        is_canceled: false,
        invoice_id: invoiceId,
        invoice_no: expect.any(String),
      });

      const invoice = await mockControl<MockInvoice>(
        "GET",
        `/sales/invoices/${invoiceId}`
      );
      expect(invoice).toMatchObject({
        invoice_id: invoiceId,
        invoice_no: expect.any(String),
        salesorder_id: soId,
        sub_total: String(GOODS_PRICE),
        total_disc: "0",
        total_tax: "16500",
        grand_total: String(DELIVERY_PROVIDER_PAYABLE),
        payment_amount: DELIVERY_PROVIDER_PAYABLE,
      });
      expect(invoice.items, "satu baris invoice barang saja").toHaveLength(1);
      expect(invoice.items[0]).toMatchObject({
        item_id: MOCK_JUBELIO_ITEM_ID,
        qty_in_base: GOODS_QUANTITY,
        price: GOODS_PRICE,
        disc_amount: 0,
        tax_amount: 16500,
        // Nominal baris = harga barang + PPN baris; ongkir bukan pajak barang.
        amount: GOODS_PRICE + DELIVERY_PPN_AMOUNT,
      });
      expect(
        Number(invoice.grand_total) - invoice.payment_amount,
        "invoice yang sudah lunas tidak menyisakan due"
      ).toBe(0);

      const payment = await mockControl<MockPayment>(
        "GET",
        `/sales/payments/${paymentId}`
      );
      expect(payment).toMatchObject({
        payment_id: paymentId,
        amount: String(DELIVERY_PROVIDER_PAYABLE),
        account_id: PROVIDER_PAYMENT_ACCOUNT_ID,
        payment_type: PROVIDER_PAYMENT_TYPE,
        contact_id: PROVIDER_CONTACT_ID,
      });
      expect(payment.note, "note payment memuat tautan order").toContain(
        orderId
      );
      expect(payment.invoices, "tepat SATU asosiasi invoice").toHaveLength(1);
      expect(payment.invoices[0]).toMatchObject({
        invoice_id: invoiceId,
        payment_amount: DELIVERY_PROVIDER_PAYABLE,
        salesorder_id: soId,
        grand_total: DELIVERY_PROVIDER_PAYABLE,
        due: 0,
      });
      // Kontrak provider3: payment provider = total customer (PPN sudah
      // dibayar customer, tanpa tagihan kedua).
      expect(Number(payment.amount)).toBe(DELIVERY_PROVIDER_PAYABLE);
      expect(Number(payment.amount)).toBe(DELIVERY_CUSTOMER_TOTAL);

      // === 9. Callback duplikat idempoten: nol tulis provider kedua ==========
      const replay = await postSignedWebhook(
        orderId,
        DELIVERY_SNAP_GROSS_AMOUNT
      );
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.success).toBe(true);

      const afterReplay = await readOwnedOrder(orderId);
      expect({
        status: afterReplay.status,
        paymentStatus: afterReplay.paymentStatus,
        pickupCode: afterReplay.pickupCode,
        fulfillmentBlockedReason: afterReplay.fulfillmentBlockedReason,
      }).toEqual({
        status: "processing",
        paymentStatus: "paid",
        pickupCode: null,
        fulfillmentBlockedReason: null,
      });
      expect(JSON.stringify(afterReplay.pricingSnapshot)).toBe(pricingBefore);
      expect(Number(afterReplay.deliverySnapshot?.service.shippingCost)).toBe(
        SHIPPING_RATE
      );

      const capturedAfter = await getMockRequests();
      const countPosts = (
        predicate: (record: MockRequestRecord) => boolean
      ): number => capturedAfter.filter(predicate).length;

      expect(
        countPosts(
          (record) =>
            record.method === "POST" && record.path === "/snap/v1/transactions"
        ),
        "satu transaksi Snap total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/orders/" &&
            record.body.salesorder_id === 0 &&
            record.body.ref_no === orderId
        ),
        "satu Sales Order create total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/packlists/create-invoice" &&
            record.body.salesorder_id === soId
        ),
        "satu konversi invoice total"
      ).toBe(1);
      expect(
        countPosts(
          (record) =>
            record.method === "POST" &&
            record.path === "/sales/payments/" &&
            String(record.body.note ?? "").includes(orderId)
        ),
        "satu tulis payment total"
      ).toBe(1);

      // Uang provider yang sudah settle juga tidak bergerak.
      const invoiceAfter = await mockControl<MockInvoice>(
        "GET",
        `/sales/invoices/${invoiceId}`
      );
      expect(invoiceAfter.payment_amount).toBe(DELIVERY_PROVIDER_PAYABLE);
      expect(
        Number(invoiceAfter.grand_total) - invoiceAfter.payment_amount
      ).toBe(0);
    } finally {
      await db().query(
        "UPDATE product_variant SET price = '150000.00' WHERE id = $1",
        [FIXTURE_VARIANT_ID]
      );
      await restoreGate1();
    }
  });
});
