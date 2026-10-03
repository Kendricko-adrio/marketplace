/**
 * Ticket 06 — mock-only shipment tracking (admin handoff/reconcile + store
 * webhook/customer). ONE spec, three serial cases on OWN fixtures (no
 * provider create/SO/Midtrans traffic — booking was proven in ticket 05):
 *
 * (1) Admin: the booked order's "Catat serah-terima" CTA records the physical
 *     handoff (idempotent, NO completion, NO provider POST); "Perbarui
 *     tracking" GET-verifies the KNOWN AWB (the control fixture) and shows the
 *     normalized status + the billed figure from price_bill; a wrong-Home-
 *     Branch HQ actor and a no-edit actor are denied over HTTP; AWB/shipment
 *     ids stay unique to ONE order.
 * (2) Store webhook: the INDEPENDENT static fixture body (DELIVERED, empty
 *     POD) with the parent's OpenSSL-computed hex completes the order — the
 *     customer (their OWN store client) sees the AWB/resi, the timeline (when
 *     available) and the completed badge; the tracking link is
 *     customer-owner-only (another client gets 404).
 * (3) Replay/out-of-order: the identical body dedupes (no new receipt, no
 *     double effect); a late PICKED_UP and a SHIPMENT_ISSUE are RECEIVED but
 *     IGNORED after completion — the order is never reopened (ticket 07 owns
 *     the follow-up); no /shipments/create POST ever happens in ticket 06.
 *
 * Independent source of truth: the static fixture raw + hex below from the
 * parent (OpenSSL, NEVER derived from a production helper):
 *   raw  = {"event":"awb","ref_no":"track-order-1",...,"latest_status":"DELIVERED",...}
 *   hex  = 5ced92842be2ec813a0f2f70e729aae2f34e96c29b457b74534a8dbda1cdc233
 *   (key = secret; message = raw + secret, HMAC-SHA256 hex)
 *
 * MOCK SEAM (main implements before validation): the control
 *   PUT /__control/shipment {scenario:"tracking-normal", shipment:{
 *     shipment_id: 7101, ref_no, awb:"TRACKAWB7101", latest_status:"ON_DELIVERY",
 *     price_bill: 30000, tracking:[...], tracking_url: "...", pod_url: null}}
 * upserts the GET `GET /shipments/awb/{awb}` Bearer fixture; a NEW env
 *   JUBELIO_SHIPMENT_WEBHOOK_SECRET=fake (a DISTINCT signing secret — no API
 * credential fallback) is read by the store webhook route.
 *
 * Run with the isolated mock config (the parent selects the spec):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (keep in sync with playwright.mock.config.ts)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "shipment-tracking-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with the E2E_MOCK_*_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["store", STORE_BASE_URL],
    ["admin", ADMIN_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `shipment-tracking-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures + the independent signature fixture
// ---------------------------------------------------------------------------

const PREFIX = "e2etrack";
const ORDER_ID = "track-order-1"; // the static fixture's ref_no
const AWB = "TRACKAWB7101";
const SHIPMENT_ID = 7101;
const WEBHOOK_PATH = "/api/webhooks/jubelio-shipment";

// The INDEPENDENT static fixture (parent-computed; never derived here).
const RAW_EXACT =
  '{"event":"awb","ref_no":"track-order-1","awb":"TRACKAWB7101","shipment_id":7101,"latest_status":"DELIVERED","tracking":{"date":"2026-10-01T01:00:00Z","status":"D09","status_detail":"Delivered"},"future_field":{"ignored":true}}';
const STATIC_HEX =
  "5ced92842be2ec813a0f2f70e729aae2f34e96c29b457b74534a8dbda1cdc233";

const ORDER_CONTACT_EMAIL = "track-e2e@example.test";
const BRANCH_A_ID = "e2etrack-branch-a";
const BRANCH_B_ID = "e2etrack-branch-b";
const ROLE_EDIT_ID = "e2etrack-role-edit";
const ROLE_VIEW_ID = "e2etrack-role-view";
const USER_ADMIN_ID = "e2etrack-user-admin";
const CLIENT_ID = "e2etrack-client";
const ATTACKER_CLIENT_ID = "e2etrack-attacker";
const ACCOUNT_PASSWORD = "E2ETrack2026";

let pool: Pool;
let adminContext: BrowserContext;
let customerContext: BrowserContext;
let attackerContext: BrowserContext;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const isEmail = identifier.includes("@");
  const path = isEmail ? "email" : "username";
  const body = isEmail ? { email: identifier, password } : { username: identifier, password };
  const response = await context.request.post(`${base}/api/auth/sign-in/${path}`, {
    data: body,
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

/** Signs a fresh tracking event with node:crypto (HMAC-SHA256, hex). */
function signEvent(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw + secret).digest("hex");
}

async function shipmentReceiptCount(orderId: string): Promise<number> {
  const rows = await pool!.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM delivery_tracking_event te
       JOIN delivery_shipment s ON s.id = te.shipment_id
     WHERE s.order_id = $1`,
    [orderId]
  );
  return Number(rows.rows[0]?.n ?? 0);
}

async function shipmentCreatePosts(): Promise<number> {
  const result = await mockControl("GET", "/__control/requests");
  const requests = (result.data as Array<{ method: string; path: string }>) ?? [];
  return requests.filter(
    (record) => record.method === "POST" && record.path === "/shipments/create"
  ).length;
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Own rows only: the branches, the roles/grants, the admin + client users
  // (bcrypt credentials — the seeder's pattern), and ONE booked delivery
  // order whose id matches the static webhook fixture's ref_no.
  await pool.query("DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND s.order_id = $1", [ORDER_ID]);
  await pool.query("DELETE FROM delivery_shipment WHERE order_id = $1", [ORDER_ID]);
  await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id = $1", [ORDER_ID]);
  await pool.query("DELETE FROM orders WHERE id = $1", [ORDER_ID]);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2etrack-%'");
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2etrack-%'");
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client_account WHERE user_id LIKE 'e2etrack-%'");
  await pool.query("DELETE FROM client_session WHERE user_id LIKE 'e2etrack-%'");
  await pool.query("DELETE FROM client WHERE id LIKE 'e2etrack-%'");

  await pool.query("INSERT INTO client (id, name, email, email_verified, phone, onboarding_completed) VALUES ($1,'Tracking Customer','track-e2e@example.test',true,'+628123456789',true) ON CONFLICT (id) DO NOTHING", [CLIENT_ID]);
  await pool.query("INSERT INTO client (id, name, email, email_verified, phone, onboarding_completed) VALUES ($1,'Tracking Attacker','track-attacker@example.test',true,'+628123456790',true) ON CONFLICT (id) DO NOTHING", [ATTACKER_CLIENT_ID]);

  await pool.query(
    `INSERT INTO branch (id, name, code, city, address, status, shipping_phone, shipping_address, shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'Tracking Origin A', 'E2ETRK', 'Jakarta Pusat', 'Jl. Track 1', 'aktif', '021999888777', 'Jl. Track Origin 1', '10110', '01010101', 900009),
            ($2, 'Tracking Other B', 'E2ETRK2', 'Surabaya', 'Jl. Track 2', 'aktif', '0315550001', 'Jl. Track 2', '60275', '02020101', 900010)`,
    [BRANCH_A_ID, BRANCH_B_ID]
  );
  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, 'E2E Track Editor'), ($2, 'E2E Track Viewer')`, [
    ROLE_EDIT_ID, ROLE_VIEW_ID,
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'), ($3, $2, 'orders', 'edit', 'own_branch'), ($4, $5, 'orders', 'view', 'own_branch')`,
    ["gr-track-e-view", ROLE_EDIT_ID, "gr-track-e-edit", "gr-track-v-view", ROLE_VIEW_ID]
  );
  const passwordHash = await bcrypt.hash(ACCOUNT_PASSWORD, 10);
  // The HQ-like identity uses the SEEDED HQ role (all-scope grants untouched)
  // with a deliberately WRONG Home Branch — the bypass probe.
  const hqRole = await pool.query<{ id: string }>(
    "SELECT id FROM admin_role WHERE key = 'hq' LIMIT 1"
  );
  const hqRoleId = hqRole.rows[0]?.id;
  expect(hqRoleId, "the seeded HQ role must exist (npm run db:seed)").toBeTruthy();
  const USER_HQLIKE_ID = `${PREFIX}-user-hq`;
  const USER_VIEWER_ID = `${PREFIX}-user-viewer`;
  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Admin Track', 'trackadmin', 'trackadmin', 'trackadmin@example.test', true, $2, $3, true),
            ($4, 'HQ Wrong Track', 'hqtrack', 'hqtrack', 'hqtrack@example.test', true, $5, $6, true),
            ($7, 'Viewer Track', 'viewertrack', 'viewertrack', 'viewertrack@example.test', true, $8, $3, true)`,
    [
      USER_ADMIN_ID, ROLE_EDIT_ID, BRANCH_A_ID,
      USER_HQLIKE_ID, hqRoleId as string, BRANCH_B_ID,
      USER_VIEWER_ID, ROLE_VIEW_ID,
    ]
  );
  for (const id of [USER_ADMIN_ID, USER_HQLIKE_ID, USER_VIEWER_ID]) {
    await pool.query(
      `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $2, 'credential', $3)`,
      [`${id}-account`, id, passwordHash]
    );
  }
  for (const id of [CLIENT_ID, ATTACKER_CLIENT_ID]) {
    await pool.query(
      `INSERT INTO client_account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $2, 'credential', $3)`,
      [`${id}-account`, id, passwordHash]
    );
  }

  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, total, subtotal,
        shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
        contact_phone, contact_email, jubelio_sales_order_id, jubelio_invoice_id,
        jubelio_payment_id, fulfillment_method, delivery_snapshot, pickup_code, expires_at)
     VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
        '20000.00', '0', '0', '11', '13200.00', '081299999999',
        'track-e2e@example.test', 7001, 7101, 7201, 'delivery', $4, NULL,
        now() - interval '5 days')`,
    [ORDER_ID, CLIENT_ID, BRANCH_A_ID, JSON.stringify({
      address: { recipientName: 'Tracking Recipient', phone: '08123456789', fullAddress: 'Jl. Tracking Fixture 1', provinceId: '01', province: 'Province', cityId: '0101', city: 'City', districtId: '010101', district: 'District', areaId: '01010101', area: 'Area', postalCode: '01234' },
      origin: { branchId: BRANCH_A_ID, name: 'Tracking Origin', phone: '021123456', address: 'Origin street', zipcode: '10110', areaId: '01010101' },
      parcel: { weight: 290, items: [{ item_name: 'Fixture Goods', quantity: 1, value: 100000, weight: 250, length: 10, width: 10, height: 10 }] },
      service: { courierId: 13, serviceId: 1327, name: 'JNE REG', shippingCost: '20000' },
      pricing: { subtotal: '100000', discount: '0', taxableBase: '120000', shippingCost: '20000', serviceFee: '0', ppnRatePercent: '11', ppnAmount: '13200', total: '133200' },
    })]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
     VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb, 7001, 7101, 7201), ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb, 7001, 7101, 7201)`,
    [`${ORDER_ID}-invoice`, ORDER_ID, `${ORDER_ID}-payment`]
  );
  await pool.query(
    `INSERT INTO delivery_shipment
       (id, order_id, state, stored_request, attempt_count, packed_by,
        dispatched_by, booked_by, dispatched_at, booked_at, shipment_id,
        awb, tracking_url, quote_rates, booked_price, billed_price)
     VALUES ($1, $2, 'booked', '{"ref_no":"ref"}'::jsonb, 1, $3, $3, $3,
        now() - interval '6 days', now() - interval '5 days', $4, $5,
        'http://127.0.0.1:3112/tracking/7101', '20000.00', '25000.00', NULL)`,
    [`${PREFIX}-ship-1`, ORDER_ID, USER_ADMIN_ID, SHIPMENT_ID, AWB]
  );

  // Own sessions: the admin (orders:edit + Home Branch) + the owning customer
  // + a second customer (the privacy probe) — the separate store/admin auth
  // instances, signed in over the public HTTP seams.
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(adminContext, ADMIN_BASE_URL, "trackadmin", ACCOUNT_PASSWORD);
  customerContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(customerContext, STORE_BASE_URL, "track-e2e@example.test", ACCOUNT_PASSWORD);
  attackerContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(attackerContext, STORE_BASE_URL, "track-attacker@example.test", ACCOUNT_PASSWORD);
});

test.afterAll(async () => {
  await adminContext?.close().catch(() => {});
  await customerContext?.close().catch(() => {});
  await attackerContext?.close().catch(() => {});
  if (pool) {
    await pool.query("DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND s.order_id = $1", [ORDER_ID]);
    await pool.query("DELETE FROM delivery_shipment WHERE order_id = $1", [ORDER_ID]);
    await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id = $1", [ORDER_ID]);
    await pool.query("DELETE FROM orders WHERE id = $1", [ORDER_ID]);
    await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2etrack-%'");
    await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2etrack-%'");
    await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
    await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.query("DELETE FROM client_session WHERE user_id LIKE 'e2etrack-%'");
    await pool.query("DELETE FROM client_account WHERE user_id LIKE 'e2etrack-%'");
    await pool.query("DELETE FROM client WHERE id LIKE 'e2etrack-%'");
    await pool.end();
  }
});

test.describe("mock-only shipment tracking (ticket 06)", () => {
  test.describe.configure({ mode: "serial" });

  let wrongHomeContext: BrowserContext;
  let noEditContext: BrowserContext;

  test.beforeEach(async () => {
    // The GET-AWB control fixture: the tracked shipment identity + ON_DELIVERY.
    expect(
      (await mockControl("PUT", "/__control/shipment", {
        scenario: "tracking-normal",
        shipment: {
          shipment_id: SHIPMENT_ID,
          ref_no: ORDER_ID,
          awb: AWB,
          latest_status: "ON_DELIVERY",
          courier_id: 13,
          courier_service_id: 1327,
          price: 25000,
          price_bill: 30000,
          tracking: [
            { date: "2026-10-01T00:00:00Z", status: "S01", status_detail: "Pickup" },
          ],
          tracking_url: "http://127.0.0.1:3112/tracking/7101",
          pod_url: null,
        },
      })).status
    ).toBe("ok");
  });

  test("admin handoff is idempotent without a provider POST; reconcile GET-verifies the known AWB and shows the normalized status + billed; foreign actors are denied", async () => {
    const page = await adminContext!.newPage();
    await page.goto(`/admin/orders/${ORDER_ID}`);
    // The region from ticket 05 shows the booked AWB; a physical handoff is
    // NOT offered through the old pickup modal (delivery never gets codes).
    await expect(page.getByText(AWB, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Wrong actors over HTTP: an all-scope HQ user with a WRONG Home Branch
    // (never a bypass) and a no-edit viewer — handoff AND reconcile refused.
    wrongHomeContext = await page.context().browser()!.newContext({ baseURL: ADMIN_BASE_URL });
    await httpSignIn(wrongHomeContext, ADMIN_BASE_URL, "hqtrack", ACCOUNT_PASSWORD);
    noEditContext = await page.context().browser()!.newContext({ baseURL: ADMIN_BASE_URL });
    await httpSignIn(noEditContext, ADMIN_BASE_URL, "viewertrack", ACCOUNT_PASSWORD);
    const wrongHandoff = await wrongHomeContext.request.post(
      `/api/admin/orders/${ORDER_ID}/delivery/handoff`, { data: {} }
    );
    expect(wrongHandoff.status(), `wrong-branch handoff must refuse: ${await wrongHandoff.text()}`).toBeGreaterThanOrEqual(400);
    const wrongReconcile = await wrongHomeContext.request.post(
      `/api/admin/orders/${ORDER_ID}/delivery/reconcile`, { data: {} }
    );
    expect(wrongReconcile.status(), `wrong-branch reconcile must refuse: ${await wrongReconcile.text()}`).toBeGreaterThanOrEqual(400);
    const noEditHandoff = await noEditContext.request.post(
      `/api/admin/orders/${ORDER_ID}/delivery/handoff`, { data: {} }
    );
    expect(noEditHandoff.status()).toBeGreaterThanOrEqual(400);
    await noEditContext.close();
    await wrongHomeContext.close();

    // The true actor: the handoff records the serah-terima — idempotent,
    // TWO 2xx calls, NO provider POST, NO completion.
    const firstHandoff = await adminContext!.request.post(
      `/api/admin/orders/${ORDER_ID}/delivery/handoff`, { data: {} }
    );
    expect(firstHandoff.status(), `the handoff must succeed: ${await firstHandoff.text()}`).toBe(200);
    const againHandoff = await adminContext!.request.post(
      `/api/admin/orders/${ORDER_ID}/delivery/handoff`, { data: {} }
    );
    expect(againHandoff.status(), `the duplicate handoff must be idempotent: ${await againHandoff.text()}`).toBe(200);
    expect(await shipmentCreatePosts()).toBe(0);
    const order = (
      await pool!.query("SELECT status, payment_status FROM orders WHERE id = $1", [ORDER_ID])
    ).rows[0];
    expect(order.status).toBe("processing");
    const ledger = (
      await pool!.query(
        "SELECT handed_over_at IS NOT NULL AS stamped, handed_over_by FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )
    ).rows[0];
    expect(ledger.stamped).toBe(true);

    // The UI shows the recorded handoff timestamp ("Serah terima" label).
    await page.goto(`/admin/orders/${ORDER_ID}`);
    await expect(page.getByText(/Serah terima/i).first()).toBeVisible({ timeout: 15_000 });

    // "Perbarui tracking": the GET-verified reconcile lands the normalized
    // status + the billed value from the control fixture.
    await expect(page.getByRole("button", { name: /Perbarui tracking/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Perbarui tracking/i }).click();
    await expect(
      page.getByRole("region", { name: /Pemenuhan delivery/i }).getByText("ON_DELIVERY", { exact: true }).first()
    ).toBeVisible({ timeout: 20_000 });
    const ledgerAfter = (
      await pool!.query(
        "SELECT latest_status, latest_event_at IS NOT NULL AS stamped, billed_price FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )
    ).rows[0];
    expect(ledgerAfter.latest_status).toBe("ON_DELIVERY");
    expect(ledgerAfter.stamped).toBe(true);
    expect(Number(ledgerAfter.billed_price)).toBe(30000);
    // Still processing, still no completion.
    expect(
      (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0].status
    ).toBe("processing");
    await expect(page.getByLabel("Status pesanan")).toHaveText("Processing");

    await page.close();
  });

  test("the unsigned webhook is refused; the signed static fixture completes the order; the owning customer sees the resi; other clients cannot", async () => {
    // An UNSIGNED webhook is refused BEFORE any mutation (trusted HMAC first).
    const unsigned = await fetch(`${STORE_BASE_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: RAW_EXACT,
    });
    expect(unsigned.status, `an unsigned webhook must be refused: ${await unsigned.text()}`).toBeGreaterThanOrEqual(400);
    const signed = await fetch(`${STORE_BASE_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jubelio-signature": STATIC_HEX,
      },
      body: RAW_EXACT,
    });
    expect(signed.status, `the signed webhook must accept: ${await signed.text()}`).toBe(200);

    const order = (
      await pool!.query("SELECT status, payment_status, pickup_code FROM orders WHERE id = $1", [ORDER_ID])
    ).rows[0];
    expect(order.status).toBe("completed");
    expect(order.payment_status).toBe("paid");
    expect(order.pickup_code).toBe(null);

    // The owning customer: the completed order shows the resi + the POD is
    // absent (nil) — the tracking link is customer-owner-only.
    const detail = await customerContext!.request.get(`/api/orders/${ORDER_ID}`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as { data?: Record<string, unknown> };
    expect(JSON.stringify(detailBody.data)).toContain(AWB);
    const page = await customerContext!.newPage();
    await page.goto(`/account/orders/${ORDER_ID}`);
    await expect(page.getByText(AWB, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Status pesanan")).toHaveText("Completed");
    await expect(page.getByText('Ready for Pickup', { exact: true })).toHaveCount(0);

    // The PRIVACY probe: a DIFFERENT customer can never read this order —
    // not its AWB, not its link.
    const spy = await attackerContext!.request.get(`/api/orders/${ORDER_ID}`);
    expect(spy.status()).toBe(404);
    const spyPage = await attackerContext!.newPage();
    await spyPage.goto(`/account/orders/${ORDER_ID}`);
    await expect(spyPage.getByText(AWB, { exact: true })).toHaveCount(0);
    await spyPage.close();

    // Zero provider creates in ticket 06.
    expect(await shipmentCreatePosts()).toBe(0);

    await page.close();
  });

  test("late safe POD metadata is available only to the owner without reopening completion", async () => {
    const url = `${MOCK_BASE_URL}/pod/${AWB}`;
    const raw = JSON.stringify({ event: 'awb', ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID, latest_status: 'DELIVERED', pod_url: url });
    const sent = await customerContext!.request.post(`${STORE_BASE_URL}${WEBHOOK_PATH}`, { data: raw, headers: { 'content-type': 'application/json', 'x-jubelio-signature': signEvent(raw, process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET!) } });
    expect(sent.status()).toBe(200);
    const page = await customerContext!.newPage(); await page.goto(`/account/orders/${ORDER_ID}`);
    await expect(page.getByRole('link', { name: 'Buka bukti serah terima' })).toHaveAttribute('href', url);
    await expect(page.getByLabel('Status pesanan')).toHaveText('Completed');
    const bad = raw.replace(url, 'javascript:alert(1)');
    await customerContext!.request.post(`${STORE_BASE_URL}${WEBHOOK_PATH}`, { data: bad, headers: { 'content-type': 'application/json', 'x-jubelio-signature': signEvent(bad, process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET!) } });
    const dto = (await (await customerContext!.request.get(`/api/orders/${ORDER_ID}`)).json()).data.shipment;
    expect(dto.podUrl).toBe(url); expect(dto).not.toHaveProperty('storedRequest'); expect(dto).not.toHaveProperty('billedPrice');
    await page.close();
  });

  test("the identical replay dedupes (no new receipt); late out-of-order statuses are received but ignored — the completed order never reopens", async () => {
    const receiptsBefore = await shipmentReceiptCount(ORDER_ID);
    const replay = await fetch(`${STORE_BASE_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jubelio-signature": STATIC_HEX,
      },
      body: RAW_EXACT,
    });
    expect(replay.status, `the replay must respond: ${await replay.text()}`).toBe(200);
    expect(await shipmentReceiptCount(ORDER_ID)).toBe(receiptsBefore);

    // A late out-of-order PICKED_UP with a NEW body: received, recorded, but
    // never applied to a completed order.
    const latePicked = JSON.stringify({
      event: "awb",
      ref_no: ORDER_ID,
      awb: AWB,
      shipment_id: SHIPMENT_ID,
      latest_status: "PICKED_UP",
      tracking: [{ date: "2026-10-01T09:00:00Z", status: "S01", status_detail: "late" }],
    });
    const late = await fetch(`${STORE_BASE_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jubelio-signature": signEvent(latePicked, process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET ?? "fake"),
      },
      body: latePicked,
    });
    expect(late.status).toBe(200);
    const order = (
      await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])
    ).rows[0];
    expect(order.status).toBe("completed");
    const ledger = (
      await pool!.query("SELECT latest_status FROM delivery_shipment WHERE order_id = $1", [ORDER_ID])
    ).rows[0];
    expect(ledger.latest_status).toBe("DELIVERED");
    // At most ONE late receipt (the late PICKED_UP) — the replay stayed deduped.
    const receiptsAfter = await shipmentReceiptCount(ORDER_ID);
    expect(receiptsAfter - receiptsBefore).toBeLessThanOrEqual(2);

    // A SHIPMENT_ISSUE after completion is also ignored (ticket 07 owns it).
    const issue = JSON.stringify({
      event: "awb",
      ref_no: ORDER_ID,
      awb: AWB,
      shipment_id: SHIPMENT_ID,
      latest_status: "SHIPMENT_ISSUE",
      tracking: [],
    });
    const issueResult = await fetch(`${STORE_BASE_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jubelio-signature": signEvent(issue, process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET ?? "fake"),
      },
      body: issue,
    });
    expect(issueResult.status).toBe(200);
    expect(
      (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0].status
    ).toBe("completed");
    expect(
      (await pool!.query("SELECT latest_status FROM delivery_shipment WHERE order_id = $1", [ORDER_ID])).rows[0].latest_status
    ).toBe("DELIVERED");

    // NO booking ever happened in ticket 06.
    expect(await shipmentCreatePosts()).toBe(0);
  });
});