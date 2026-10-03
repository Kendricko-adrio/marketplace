/**
 * Ticket 05 — mock-only shipment packing + booking (browser/HTTP + admin).
 * ONE spec, two serial cases on OWN fixtures:
 *
 * (1) On the existing admin order detail surfaces a paid, verified delivery
 *     order is packed ("Tandai selesai packing") and then booked ("Pesan
 *     pengiriman" — optional confirmation dialog handled) → the order shows
 *     the AWB + the THREE costs (quote rates Rp 20.000, booking Rp 25.000,
 *     billed Rp 30.000 — distinct, the mismatch audited but blocking
 *     nothing), and the order is NEVER labeled handoff/completed (it stays
 *     Processing until ticket 06 confirms delivery). The HTTP guards: a
 *     wrong-Home-Branch actor with an ALL-scope edit (the seeded HQ role) is
 *     denied, a no-edit-grant actor is denied — all-branch visibility is
 *     never a packing/booking bypass. A CONCURRENT HTTP book after packing
 *     posts to the provider exactly once.
 * (2) A BOOKING AMBIGUITY (mock timeout after apply): the UI HOLDS — no
 *     enabled "Pesan pengiriman" repeat, no second provider POST — and the
 *     order keeps waiting for manual certainty. The AWB (if the provider
 *     applied) must still surface from the reconciliation in a later ticket;
 *     here the state is durable and never re-created.
 *
 * Independent source of truth: the fixture snapshot below (quote rates
 * 20.000; the mock answers price 25.000 / price_bill 30.000) — never
 * recomputed from the implementation.
 *
 * Endpoints under test (guarded orders:edit + Home Branch, exactly the
 * verify-pickup guard idiom):
 *   POST /api/admin/orders/{id}/delivery/packing {}
 *   POST /api/admin/orders/{id}/delivery/book    {}
 *
 * MOCK seam (main implements in apps/jubelio-mock + the ADMIN mock config
 * with separate fake Shipment credentials + 500 ms timeout):
 *   PUT /__control/shipment {scenario: "booking-normal" |
 *     "booking-timeout-after-apply"}; POST /shipments/create with a Bearer
 *     token: booking-normal → {shipment_id, awb "MOCKAWB...", price 25000,
 *     price_bill 30000} immediately; booking-timeout-after-apply → applies
 *     the booking AND delays the response 1000 ms (the 500 ms client timeout
 *     turns it ambiguous). No live writes anywhere.
 *
 * The admin mock config env (JUBELIO_SHIPMENT_URL etc. for the ADMIN app)
 * is main's — until then the endpoints fail closed: that IS the red.
 * Run with the isolated mock config (the parent selects the spec):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (keep in sync with playwright.mock.config.ts)
// ---------------------------------------------------------------------------

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "shipment-booking-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["admin", ADMIN_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `shipment-booking-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures (own rows only; seeded data is never reset)
// ---------------------------------------------------------------------------

const PREFIX = "e2eship";
const ORDER_SUFFIX_EMAIL = "shipmock-e2e@example.test";
const BRANCH_A_ID = "e2eship-branch-a";
const BRANCH_B_ID = "e2eship-branch-b";
const ROLE_EDIT_ID = "e2eship-role-edit";
const ROLE_VIEW_ID = "e2eship-role-view";
const USER_ADMIN_ID = "e2eship-user-admin";
const USER_HQLIKE_ID = "e2eship-user-hq";
const USER_NOEDIT_ID = "e2eship-user-noedit";
const USER_PASSWORD = "E2EShip2026";

const AWB_TEXT = "MOCKAWB";
const QUOTE_RATES_TEXT = "Rp 20.000";
const BOOKING_PRICE_TEXT = "Rp 25.000";
const BILLED_PRICE_TEXT = "Rp 30.000";

// The paid verified delivery order's row values + the snapshot (the ticket-04
// persisted payload shape — five blocks, leading zeros preserved).
const ORDER_TOTAL = "133200.00";
const SNAPSHOT = {
  address: {
    recipientName: "Budi Penerima Order",
    phone: "081299999999",
    fullAddress: "Jl. Ship Booking Asal No. 4",
    provinceId: "01",
    province: "Fixture Province",
    cityId: "0101",
    city: "Fixture City",
    districtId: "010101",
    district: "Fixture District",
    areaId: "01010101",
    area: "Fixture Area",
    postalCode: "01234",
  },
  origin: { branchId: BRANCH_A_ID, name: "E2E Origin Ship Branch", phone: "021999888777", address: "Jl. Origin E2E No. 4", zipcode: "10110", areaId: "01010101" },
  parcel: { weight: 290, items: [{ item_name: "Ship Anchor", quantity: 1, value: 100000, weight: 250, length: 30, width: 20, height: 10 }] },
  service: { courierId: 13, serviceId: 1327, name: "JNE REG Fixture", shippingCost: "20000.00" },
  pricing: { subtotal: "100000.00", discount: "0.00", taxableBase: "120000.00", shippingCost: "20000.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "13200.00", total: "133200.00" },
} as const;

let pool: Pool;
let adminContext: BrowserContext;
let orderIds: string[] = [];

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
    `${base}/api/auth/sign-in/username`,
    { data: { username: identifier, password } }
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

async function shipmentCreatePosts(orderId: string): Promise<number> {
  const result = await mockControl("GET", "/__control/requests");
  const requests = (result.data as Array<{ method: string; path: string; body?: { ref_no?: string } }>) ?? [];
  return requests.filter(
    (record) => record.method === "POST" && record.path === "/shipments/create" && record.body?.ref_no === orderId
  ).length;
}

function orderEndpoint(orderId: string, action: "packing" | "book"): string {
  return `/api/admin/orders/${orderId}/delivery/${action}`;
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Own fixture rows only: the branches, roles, users (bcrypt credential —
  // the seeder's pattern), and TWO paid verified delivery orders with the
  // SAME five-block delivery snapshot.
  await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}%'`);
  await pool.query(`DELETE FROM orders WHERE contact_email = $1`, [ORDER_SUFFIX_EMAIL]);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2eship-%'");
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2eship-%'");
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);

  await pool.query(
    `INSERT INTO branch
       (id, name, code, city, address, status, shipping_phone, shipping_address,
        shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'E2E Origin Ship Branch', 'E2ESHP', 'Jakarta Pusat', 'Jl. Origin E2E No. 4', 'aktif',
             '021999888777', 'Jl. Origin E2E No. 4', '10110', '01010101', 900005),
            ($2, 'E2E Other Ship Branch', 'E2ESHP2', 'Surabaya', 'Jl. Other 2', 'aktif',
             '0315550001', 'Jl. Other 2', '60275', '02020101', 900006)`,
    [BRANCH_A_ID, BRANCH_B_ID]
  );

  // Roles: orders view+edit own (the actor) vs orders view-own only (no edit).
  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, 'E2E Ship Editor'), ($2, 'E2E Ship Viewer')`, [
    ROLE_EDIT_ID,
    ROLE_VIEW_ID,
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'),
            ($3, $2, 'orders', 'edit', 'own_branch'),
            ($4, $5, 'orders', 'view', 'own_branch')`,
    ["gr-view-ship", ROLE_EDIT_ID, "gr-edit-ship", "gr-view-ship2", ROLE_VIEW_ID]
  );

  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
  // The HQ-like identity uses the SEEDED HQ role (all-scope grants untouched)
  // with a deliberately WRONG Home Branch for the bypass probe.
  const hqRole = await pool.query<{ id: string }>(
    "SELECT id FROM admin_role WHERE key = 'hq' LIMIT 1"
  );
  const hqRoleId = hqRole.rows[0]?.id;
  expect(hqRoleId, "the seeded HQ role must exist (npm run db:seed)").toBeTruthy();

  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Admin Ship', 'adminship', 'adminship', 'adminship@example.test', true, $2, $3, true),
            ($4, 'HQ Wrong Ship', 'hqship', 'hqship', 'hqship@example.test', true, $5, $6, true),
            ($7, 'Viewer Ship', 'viewership', 'viewership', 'viewership@example.test', true, $8, $3, true)`,
    [
      USER_ADMIN_ID, ROLE_EDIT_ID, BRANCH_A_ID,
      USER_HQLIKE_ID, hqRoleId as string, BRANCH_B_ID,
      USER_NOEDIT_ID, ROLE_VIEW_ID,
    ]
  );
  for (const id of [USER_ADMIN_ID, USER_HQLIKE_ID, USER_NOEDIT_ID]) {
    await pool.query(
      `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $2, 'credential', $3)`,
      [`${id}-account`, id, passwordHash]
    );
  }

  // Two PAID VERIFIED delivery orders (the ticket-04 persisted shape), each
  // with its own confirmed invoice/payment ledger.
  const clientId = `${PREFIX}-client`;
  await pool.query("INSERT INTO client (id,name,email,email_verified,phone,onboarding_completed) VALUES ($1,'Shipment Fixture Client','shipment-client@example.test',true,'+628123456789',true) ON CONFLICT (id) DO NOTHING", [clientId]);
  orderIds = ["e2eship-order-1", "e2eship-order-2", "e2eship-order-3"];
  for (const orderId of orderIds) {
    await pool.query(
      `INSERT INTO orders
         (id, user_id, branch_id, status, payment_status, total, subtotal,
          shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
          contact_phone, contact_email, jubelio_sales_order_id, jubelio_invoice_id,
          jubelio_payment_id, fulfillment_method, delivery_snapshot, expires_at)
       VALUES ($1, $2, $3, 'processing', 'paid', $4, '100000.00', '20000.00',
          '0', '0', '11', '13200.00', '081299999999', $5, 8001, 8101, 8201,
          'delivery', $6, now() + interval '3 hours')`,
      [
        orderId,
        clientId,
        BRANCH_A_ID,
        ORDER_TOTAL,
        ORDER_SUFFIX_EMAIL,
        JSON.stringify(SNAPSHOT),
      ]
    );
    await pool.query(
      `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
       VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb,8001,8101,NULL), ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb,8001,8101,8201)`,
      [`${orderId}-invoice`, orderId, `${orderId}-payment`]
    );
  }

  // Own admin session on the isolated origin (HTTP sign-in seam).
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(adminContext, ADMIN_BASE_URL, "adminship", USER_PASSWORD);
});

test.afterAll(async () => {
  await adminContext?.close().catch(() => {});
  if (pool) {
    await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}%'`);
    await pool.query(`DELETE FROM orders WHERE contact_email = $1`, [ORDER_SUFFIX_EMAIL]);
    await pool.query('DELETE FROM client WHERE id=$1', [`${PREFIX}-client`]);
    await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2eship-%'");
    await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2eship-%'");
    await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
    await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.end();
  }
});

test.describe("mock-only shipment packing + booking (ticket 05)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "booking-normal" })).status
    ).toBe("ok");
  });

  test("packing then booking via the admin order detail shows AWB + three costs, never handoff; cross-scope and no-grant actors are denied; a concurrent HTTP book posts exactly once", async () => {
    const page = await adminContext!.newPage();
    const orderId = orderIds[0];
    const ordersBefore = await pool!.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM orders WHERE contact_email = $1",
      [ORDER_SUFFIX_EMAIL]
    );

    // HTTP guards BEFORE the UI flow: wrong Home Branch (an all-scope HQ user)
    // and a no-edit-grant actor — both denied, nothing packed.
    const wrongContext = await adminContext!.browser()!.newContext({ baseURL: ADMIN_BASE_URL });
    await httpSignIn(wrongContext, ADMIN_BASE_URL, "hqship", USER_PASSWORD);
    const wrongPack = await wrongContext.request.post(orderEndpoint(orderId, "packing"), { data: {} });
    expect(wrongPack.status(), `wrong-branch pack: ${await wrongPack.text()}`).toBeGreaterThanOrEqual(400);
    const wrongBook = await wrongContext.request.post(orderEndpoint(orderId, "book"), { data: {} });
    expect(wrongBook.status()).toBeGreaterThanOrEqual(400);
    const noEditContext = await adminContext!.browser()!.newContext({ baseURL: ADMIN_BASE_URL });
    await httpSignIn(noEditContext, ADMIN_BASE_URL, "viewership", USER_PASSWORD);
    const noEditPack = await noEditContext.request.post(orderEndpoint(orderId, "packing"), { data: {} });
    expect(noEditPack.status()).toBeGreaterThanOrEqual(400);
    expect(await shipmentCreatePosts(orderId)).toBe(0);
    await wrongContext.close();
    await noEditContext.close();

    // The existing order-detail surface: pack then book through the UI.
    await page.goto(`/admin/orders/${orderId}`);
    await page.getByRole("button", { name: /Tandai selesai packing/i }).click();
    await expect(
      page.getByText(/packed|selesai di-pack|Sudah di-pack/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // Concurrent HTTP book right after packing: exactly ONE provider POST.
    const [first, second] = await Promise.all([
      adminContext!.request.post(orderEndpoint(orderId, "book"), { data: {} }),
      adminContext!.request.post(orderEndpoint(orderId, "book"), { data: {} }),
    ]);
    const statuses = [first.status(), second.status()].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1], `concurrent book: ${statuses[1]}`).toBeGreaterThanOrEqual(400);
    expect(await shipmentCreatePosts(orderId)).toBe(1);

    // The UI surfaces the AWB + the THREE costs; no handoff/completed label.
    await page.goto(`/admin/orders/${orderId}`);
    await expect(page.getByText(new RegExp(AWB_TEXT))).toBeVisible({ timeout: 15_000 });
    const fees = page.getByLabel("Pemenuhan delivery");
    await expect(fees.getByText(QUOTE_RATES_TEXT, { exact: true })).toBeVisible();
    await expect(fees.getByText(BOOKING_PRICE_TEXT, { exact: true })).toBeVisible();
    await expect(fees.getByText(BILLED_PRICE_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Status pesanan")).toHaveText("Processing");
    await expect(page.getByText("Ready for Pickup", { exact: true })).toHaveCount(0);

    // Nothing created beyond the fixtures; the order count is unchanged.
    expect(
      (await pool!.query("SELECT count(*)::int AS n FROM orders WHERE contact_email = $1", [
        ORDER_SUFFIX_EMAIL,
      ])).rows[0].n
    ).toBe(ordersBefore.rows[0].n);

    await page.close();
  });

  test("the booking button sends the approved packed request and shows the AWB", async () => {
    const page = await adminContext!.newPage(); const orderId = orderIds[2];
    await page.goto(`/admin/orders/${orderId}`);
    await page.getByRole("button", { name: "Tandai selesai packing" }).click();
    await expect(page.getByRole("button", { name: "Pesan pengiriman" })).toBeEnabled();
    const booked = page.waitForResponse((r) => r.url().endsWith(`/orders/${orderId}/delivery/book`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Pesan pengiriman" }).click();
    expect((await booked).status()).toBe(200);
    await expect(page.getByLabel("Pemenuhan delivery").getByText(new RegExp(AWB_TEXT))).toBeVisible();
    await expect(page.getByLabel("Status pesanan")).toHaveText("Processing");
    expect(await shipmentCreatePosts(orderId)).toBe(1); await page.close();
  });

  test("booking ambiguity holds the UI without an enabled repeat and never POSTs again", async () => {
    const page = await adminContext!.newPage();
    const orderId = orderIds[1];

    // Pack through the API seam (the UI covered it in the previous case).
    const pack = await adminContext!.request.post(orderEndpoint(orderId, "packing"), { data: {} });
    expect(pack.ok(), `pack failed: ${await pack.text()}`).toBe(true);

    // The ambiguous provider: applies the booking, delays 1000 ms — the 500 ms
    // client timeout turns the response into an ambiguity, never a retry.
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "booking-timeout-after-apply" })).status
    ).toBe("ok");

    const book = await adminContext!.request.post(orderEndpoint(orderId, "book"), { data: {} });
    expect(book.status(), `ambiguous book must refuse: ${await book.text()}`).toBeGreaterThanOrEqual(400);

    // The provider received EXACTLY ONE POST; the ambiguous state is durable.
    expect(await shipmentCreatePosts(orderId)).toBe(1);
    const repeat = await adminContext!.request.post(orderEndpoint(orderId, "book"), { data: {} });
    expect(repeat.status(), `the repeated book must refuse: ${await repeat.text()}`).toBeGreaterThanOrEqual(400);
    expect(await shipmentCreatePosts(orderId)).toBe(1);

    // The UI holds: NO enabled "Pesan pengiriman" repeat is offered.
    await page.goto(`/admin/orders/${orderId}`);
    const bookButton = page.getByRole("button", { name: /Pesan pengiriman/i }).first();
    const count = await bookButton.count();
    if (count > 0) await expect(bookButton).toBeDisabled();
    // An inactive future Completed step is not the current order status.
    await expect(page.getByLabel("Status pesanan")).toHaveText("Processing");

    await page.close();
  });
});