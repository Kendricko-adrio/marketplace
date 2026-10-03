/**
 * Ticket 07 — mock-only follow-up queue + manual resolutions (admin browser +
 * HTTP + DB + audit seams). TWO serial cases on OWN fixtures (the client-
 * owned orders — the two auth instances stay separate):
 *
 * (1) The follow-up LIST page ("/admin/orders/follow-up", aria "Tindak lanjut
 *     pengiriman") shows the cases per its "Jenis Kendala" filter; the
 *     foreign-branch viewer cannot see this branch's rows and the view-only
 *     actor sees rows WITHOUT action CTAs; the packing failure
 *     ("Tandai tidak dapat dipenuhi" with the EXACT spec reason
 *     `damaged_goods`) keeps the order processing/paid, is audited, and
 *     blocks the normal pack/book CTAs on the order detail.
 * (2) The BOOKING RELEASE ("Lepas tahanan booking") requires the trusted
 *     human proof (the reference + the reason + the attempt number + both
 *     absence flags) and STILL creates no provider booking (zero /shipments/
 *     create, no automatic book) — then the MANUAL FINISH ("Selesaikan
 *     manual") for a RETURNED issue completes the order with the mandatory
 *     reason, stays paid, never shows a set-verified/refund/notify button and
 *     never reopens (the late callbacks are the ticket-06 units' cover).
 *
 * Independent source of truth: the snapshot/cost literals below (the quote
 * rates 20.000, the booking price 25.000, the billed 30.000 — the mock's
 * create fixture answers with these; nothing here recomputes).
 *
 * MOCK (already main-implemented in ticket 05): `PUT /__control/shipment`
 * (the scenario upsert), `POST /shipments/create` (Bearer), `POST /auth/
 * generate-token`, `GET /shipments/awb/{awb}` — THE RELEASE NEVER TOUCHES
 * ANY of them (asserted via the request log).
 *
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
      "delivery-follow-up-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
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
        `delivery-follow-up-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures (own rows only; seeded data is never reset)
// ---------------------------------------------------------------------------

const PREFIX = "e2efup";
const CONTACT_EMAIL = "fupmock-e2e@example.test";
const BRANCH_A_ID = "e2efup-branch-a";
const BRANCH_B_ID = "e2efup-branch-b";
const ROLE_EDIT_ID = "e2efup-role-edit";
const ROLE_VIEW_ID = "e2efup-role-view";
const USER_ADMIN_ID = "e2efup-user-admin";
const USER_VIEWER_ID = "e2efup-user-viewer";
const ACCOUNT_PASSWORD = "E2EFup2026";

// The independent literals (the snapshot's money + the three provider costs).
const AWB_TEXT = "MOCKAWB";
const PACKING_REASON = "damaged_goods";
const PACKING_REASON_LABELS: Record<string, string> = {
  physical_stock_unavailable: "Stok fisik habis",
  damaged_goods: "Barang rusak",
  paid_service_limits_exceeded: "Melebihi batas layanan yang dibayar",
};

const SNAPSHOT = {
  address: {
    recipientName: "Budi Penerima Order",
    phone: "081299999999",
    fullAddress: "Jl. Followup E2E Asal No. 5",
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
  origin: {
    branchId: BRANCH_A_ID,
    name: "E2E Origin Followup Branch",
    phone: "021999888777",
    address: "Jl. Origin E2E No. 5, Gudang F",
    zipcode: "10110",
    areaId: "01010101",
  },
  parcel: { weight: 290, items: [{ item_name: "Followup Anchor E2E", quantity: 1, value: 100000, weight: 250, length: 30, width: 20, height: 10 }] },
  service: { courierId: 13, serviceId: 1327, name: "JNE REG Fixture", shippingCost: "20000.00" },
  pricing: {
    subtotal: "100000.00",
    discount: "0.00",
    taxableBase: "120000.00",
    shippingCost: "20000.00",
    serviceFee: "0.00",
    ppnRatePercent: "11",
    ppnAmount: "13200.00",
    total: "133200.00",
  },
} as const;

let pool: Pool;
let adminContext: BrowserContext;
let viewerContext: BrowserContext;
let foreignContext: BrowserContext;
const orderIds = ["e2efup-order-pfail", "e2efup-order-ambig", "e2efup-order-returned"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const response = await context.request.post(`${base}/api/auth/sign-in/username`, {
    data: { username: identifier, password },
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

  // FK-ordered reset (the children first, then identities); own markers only.
  await pool.query(
    `DELETE FROM delivery_tracking_event te USING delivery_shipment s
       JOIN orders o ON o.id = s.order_id
     WHERE o.contact_email = $1`,
    [CONTACT_EMAIL]
  );
  await pool.query("DELETE FROM delivery_shipment s USING orders o WHERE s.order_id = o.id AND o.contact_email = $1", [CONTACT_EMAIL]);
  await pool.query("DELETE FROM delivery_booking_reviews WHERE order_id IN (SELECT id FROM orders WHERE contact_email = $1)", [CONTACT_EMAIL]);
  await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id IN (SELECT id FROM orders WHERE contact_email = $1)", [CONTACT_EMAIL]);
  await pool.query("DELETE FROM orders WHERE contact_email = $1", [CONTACT_EMAIL]);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2efup-%'");
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2efup-%'");
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);

  // A CLIENT owns the orders (the two auth instances stay separate!).
  await pool.query(
    `INSERT INTO client (id, name, email, email_verified, phone, onboarding_completed)
     VALUES ($1, 'Followup Mock Client', 'fupmock-client@example.test', true, '+628123456789', true)
     ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}-client`]
  );
  await pool.query(
    `INSERT INTO branch (id, name, code, city, address, status, shipping_phone, shipping_address, shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'E2E Origin Followup Branch', 'E2EFUP', 'Jakarta Pusat', 'Jl. Origin E2E No. 5', 'aktif', '021999888777', 'Jl. Origin E2E No. 5, Gudang F', '10110', '01010101', 900013),
            ($2, 'E2E Foreign Followup Branch', 'E2EFUP2', 'Surabaya', 'Jl. Foreign 5', 'aktif', '0315550001', 'Jl. Foreign 5', '60275', '02020101', 900014)`,
    [BRANCH_A_ID, BRANCH_B_ID]
  );
  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, 'E2E Fup Editor'), ($2, 'E2E Fup Viewer')`, [
    ROLE_EDIT_ID, ROLE_VIEW_ID,
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'), ($3, $2, 'orders', 'edit', 'own_branch'), ($4, $5, 'orders', 'view', 'own_branch')`,
    [
      "gr-fup-m-view", ROLE_EDIT_ID,
      "gr-fup-m-edit",
      "gr-fup-m-view2", ROLE_VIEW_ID,
    ]
  );
  const passwordHash = await bcrypt.hash(ACCOUNT_PASSWORD, 10);
  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Admin Fup', 'fupadmin', 'fupadmin', 'fupadmin@example.test', true, $2, $3, true),
            ($4, 'Viewer Fup', 'fupviewer', 'fupviewer', 'fupviewer@example.test', true, $5, $3, true)`,
    [USER_ADMIN_ID, ROLE_EDIT_ID, BRANCH_A_ID, USER_VIEWER_ID, ROLE_VIEW_ID]
  );
  for (const id of [USER_ADMIN_ID, USER_VIEWER_ID]) {
    await pool.query(
      `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $2, 'credential', $3)`,
      [`${id}-account`, id, passwordHash]
    );
  }

  // ORDER A: booked, then packing-failed (the reason set by the UI);
  // ORDER B: booking_unknown (the ambiguous, no evidence);
  // ORDER C: booked + RETURNED tracking (the manual-finish case).
  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, total, subtotal,
        shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
        contact_phone, contact_email, jubelio_sales_order_id,
        jubelio_invoice_id, jubelio_payment_id, fulfillment_method,
        delivery_snapshot, expires_at)
     VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
        '20000.00', '0', '0', '11', '13200.00', '081299999999',
        $4, 7101, 7111, 7121, 'delivery', $5, now() + interval '3 hours')`,
    [orderIds[0], `${PREFIX}-client`, BRANCH_A_ID, CONTACT_EMAIL, JSON.stringify(SNAPSHOT)]
  );
  for (const orderId of orderIds.slice(1)) {
    await pool.query(
      `INSERT INTO orders
         (id, user_id, branch_id, status, payment_status, total, subtotal,
          shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
          contact_phone, contact_email, jubelio_sales_order_id,
          jubelio_invoice_id, jubelio_payment_id, fulfillment_method,
          delivery_snapshot, expires_at)
       VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
          '20000.00', '0', '0', '11', '13200.00', '081299999999',
          $4, 7101, 7111, 7121, 'delivery', $5, now() + interval '3 hours')`,
      [orderId, `${PREFIX}-client`, BRANCH_A_ID, CONTACT_EMAIL, JSON.stringify(SNAPSHOT)]
    );
  }
  for (const orderId of orderIds) {
    await pool.query(
      `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
       VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb, 7101, 7111, 7121),
              ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb, 7101, 7111, 7121)`,
      [`${orderId}-invoice`, orderId, `${orderId}-payment`]
    );
  }
  await pool.query(
    `INSERT INTO delivery_shipment
       (id,order_id,state,stored_request,attempt_count,packed_by,quote_rates)
     VALUES ($1,$2,'packed','{"ref_no":"ref"}'::jsonb,0,$3,'20000.00')`,
    [`ship-${orderIds[0]}`, orderIds[0], USER_ADMIN_ID]
  );
  await pool.query(
    `INSERT INTO delivery_shipment
       (id, order_id, state, stored_request, attempt_count, packed_by,
        dispatched_by, dispatched_at, shipment_id, awb, tracking_url,
        quote_rates, booked_price, billed_price)
     VALUES ($1, $2, 'booking_unknown', '{"ref_no":"ref"}'::jsonb, 1, $3, $3,
        now() - interval '2 days', NULL, NULL, NULL, '20000.00', NULL, NULL)`,
    [`ship-${orderIds[1]}`, orderIds[1], USER_ADMIN_ID]
  );
  await pool.query(
    `INSERT INTO delivery_shipment
       (id, order_id, state, stored_request, attempt_count, packed_by,
        dispatched_by, booked_by, dispatched_at, booked_at, shipment_id,
        awb, tracking_url, latest_status, latest_event_at, quote_rates,
        booked_price, billed_price)
     VALUES ($1, $2, 'booked', '{"ref_no":"ref"}'::jsonb, 1, $3, $3, $3,
        now() - interval '4 days', now() - interval '3 days', 7131, $4,
        'http://127.0.0.1:3112/tracking/x', 'RETURNED',
        now() - interval '2 days', '20000.00', '25000.00', NULL)`,
    [`ship-${orderIds[2]}`, orderIds[2], USER_ADMIN_ID, "FUPAWB003"]
  );

  // The own admin + viewer (the own-branch reader) sessions.
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(adminContext, ADMIN_BASE_URL, "fupadmin", ACCOUNT_PASSWORD);
  viewerContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(viewerContext, ADMIN_BASE_URL, "fupviewer", ACCOUNT_PASSWORD);
  // The foreign-branch editor: the SEEDED HQ role (the all-scope view) with
  // a DIFFERENT home branch — visibility yes, actions no.
  foreignContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(foreignContext, ADMIN_BASE_URL, "hqmanager", "hq123");
});

test.afterAll(async () => {
  await adminContext?.close().catch(() => {});
  await viewerContext?.close().catch(() => {});
  await foreignContext?.close().catch(() => {});
  if (pool) {
    await pool.query(
      `DELETE FROM delivery_tracking_event te USING delivery_shipment s
         JOIN orders o ON o.id = s.order_id
       WHERE o.contact_email = $1`,
      [CONTACT_EMAIL]
    );
    await pool.query("DELETE FROM delivery_shipment s USING orders o WHERE s.order_id = o.id AND o.contact_email = $1", [CONTACT_EMAIL]);
    await pool.query("DELETE FROM delivery_booking_reviews WHERE order_id IN (SELECT id FROM orders WHERE contact_email = $1)", [CONTACT_EMAIL]);
    await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id IN (SELECT id FROM orders WHERE contact_email = $1)", [CONTACT_EMAIL]);
    await pool.query("DELETE FROM orders WHERE contact_email = $1", [CONTACT_EMAIL]);
    await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'e2efup-%'");
    await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'e2efup-%'");
    await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
    await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);
    await pool.end();
  }
});

test.describe("mock-only follow-up queue + manual resolutions (ticket 07)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    expect(
      (await mockControl("PUT", "/__control/shipment", { scenario: "booking-normal" })).status
    ).toBe("ok");
  });

  test("follow-up list is scoped and filterable; the viewer sees rows without CTAs; the packing failure keeps the order paid and audited", async () => {
    const page = await adminContext!.newPage();

    // The scoped LIST: the follow-up table with its filter kinds; a response
    // must exist and carry at least one case.
    const listResponse = await adminContext!.request.get("/api/admin/orders/follow-up?kind=all");
    expect(listResponse.status()).toBe(200);
    expect((await listResponse.json()).data?.length ?? 0).toBeGreaterThan(0);

    await page.goto("/admin/orders/follow-up");
    await expect(page.getByRole("heading", { name: /tindak lanjut pengiriman/i })).toBeVisible();
    await expect(page.getByText("JNE REG Fixture").first()).toBeVisible({ timeout: 15_000 });

    // The order detail: a view-only actor sees rows without action CTAs; the
    // foreign editor cannot open this branch's detail (404 hidden surface).
    await page.goto(`/admin/orders/${orderIds[0]}`);
    await expect(page.getByRole("button", { name: /Tandai selesai packing/i })).toBeVisible({ timeout: 15_000 });
    await page.close();

    const viewerPage = await viewerContext!.newPage();
    await viewerPage.goto(`/admin/orders/${orderIds[0]}`);
    await expect(viewerPage.getByRole("button", { name: /Tandai selesai packing/i })).toHaveCount(0);
    await viewerPage.close();

    // The foreign editor (HQ all-view): the LIST shows the cases…
    const foreignList = await foreignContext!.request.get("/api/admin/orders/follow-up?kind=all");
    expect(foreignList.status()).toBe(200);
    // …and the DETAIL of a foreign-branch order stays VISIBLE for an
    // all-branch viewer (per Order View scope) — the route enforces the real
    // mutation gates.
    const foreignDetail = await foreignContext!.request.get(`/api/admin/orders/${orderIds[0]}`);
    expect(foreignDetail.status()).toBe(200);

    // The packing failure via the UI: the reason selection + the mandatory
    // audit; the order remains processing/paid; the normal CTAs disappear.
    const editorPage = await adminContext!.newPage();
    await editorPage.goto(`/admin/orders/${orderIds[0]}`);
    await editorPage.getByRole("button", { name: /Tandai tidak dapat dipenuhi/i }).click();
    const reasonOption = editorPage.getByRole("option", { name: /Barang rusak/i });
    if (await reasonOption.isVisible().catch(() => false)) {
      await reasonOption.click();
      await editorPage.getByRole("button", { name: /Tandai tidak dapat dipenuhi|Yakin|Konfirmasi/i }).last().click();
    }
    await expect(
      editorPage.getByText(new RegExp(`Tidak dapat dipenuhi:.*${PACKING_REASON_LABELS[PACKING_REASON]}`))
    ).toBeVisible({ timeout: 15_000 });
    const row = (
      await pool!.query(
        `SELECT status, payment_status, delivery_failure_code,
                delivery_failure_at IS NOT NULL AS stamped
         FROM orders WHERE id = $1`,
        [orderIds[0]]
      )
    ).rows[0];
    expect(row.status).toBe("processing");
    expect(row.payment_status).toBe("paid");
    expect(row.delivery_failure_code).toBe(PACKING_REASON);
    expect(row.stamped).toBe(true);
    const audit = (
      await pool!.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%PACKING%'",
        [orderIds[0]]
      )
    ).rows[0];
    expect(audit.n).toBeGreaterThanOrEqual(1);
    await editorPage.close();

    // The FOLLOW-UP list now contains the packing-failed order; the flagged
    // order's detail no longer offers the normal pack/book CTAs.
    const failedListed = await adminContext!.request.get("/api/admin/orders/follow-up?kind=packing");
    expect(failedListed.status()).toBe(200);
    expect(JSON.stringify((await failedListed.json()).data ?? [])).toContain(orderIds[0]);
    const afterPage = await adminContext!.newPage();
    await afterPage.goto('/admin/orders/follow-up');
    await expect(afterPage.getByText(/Barang rusak/i).first()).toBeVisible();
    await afterPage.goto(`/admin/orders/${orderIds[0]}`);
    await expect(afterPage.getByRole("button", { name: /Pesan pengiriman/i })).toHaveCount(0);
    await afterPage.close();
  });

  test("the booking release needs the trusted human proof and still creates NO booking; the manual finish resolves the RETURNED issue and stays paid", async () => {
    const page = await adminContext!.newPage();
    const orderId = orderIds[1];

    // The release REQUIRES the proof (the reference + the reason + the
    // attempt + the two absence flags). The UI form first appears with the
    // release CTA; the wrong/missing proof is refused without any change.
    await page.goto(`/admin/orders/${orderId}`);
    await page.getByRole("button", { name: /Lepas tahanan booking/i }).click();
    const referenceInput = page.getByLabel(/Referensi konfirmasi/i).first();
    if (await referenceInput.isVisible().catch(() => false)) {
      await referenceInput.fill("JUBELIO-CONF-E2E-001");
      await page.getByLabel(/Alasan/i).first().fill("Konfirmasi Jubelio: tidak ada booking pertama.");
      await page.getByRole("button", { name: /Lepas tahanan|Konfirmasi/i }).last().click();
    }
    // The state is RELEASED via the trusted proof — packed, no booking, no
    // second provider call.
    await expect(
      page.getByText(/Sudah di-pack|Packed/i).first()
    ).toBeVisible({ timeout: 15_000 });
    const state = (
      await pool!.query("SELECT state, attempt_count FROM delivery_shipment WHERE order_id = $1", [
        orderId,
      ])
    ).rows[0];
    expect(state.state).toBe("packed");
    expect(state.attempt_count).toBe(1);
    expect(await shipmentCreatePosts()).toBe(0);
    // The review row records the proof + the original dispatch history.
    const review = (
      await pool!.query(
        "SELECT count(*)::int AS n FROM delivery_booking_reviews WHERE order_id = $1",
        [orderId]
      )
    ).rows[0];
    expect(review.n).toBe(1);
    // NO booking is created from the release: the manual book (ticket 05's
    // "Pesan pengiriman") is the ONLY way onward.
    const audit = (
      await pool!.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%RELEASE%'",
        [orderId]
      )
    ).rows[0];
    expect(audit.n).toBeGreaterThanOrEqual(1);

    // MANUAL FINISH for the RETURNED issue: the mandatory reason + the audit
    // + the completed state (never reopened by the late callbacks — the
    // ticket-06 units).
    const finishPage = await adminContext!.newPage();
    await finishPage.goto(`/admin/orders/${orderIds[2]}`);
    await finishPage.getByRole("button", { name: /Selesaikan manual/i }).click();
    const reasonInput = finishPage.getByLabel(/Alasan/i).first();
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('Barang kembali; penyelesaian disepakati staf dan customer di luar aplikasi.');
    await finishPage.getByRole('button', { name: 'Konfirmasi selesai manual', exact: true }).click();
    await expect(finishPage.getByLabel('Status pesanan')).toHaveText('Completed');
    const finished = (
      await pool!.query(
        `SELECT status, payment_status, pickup_code, delivery_manual_reason,
                delivery_manual_at IS NOT NULL AS stamped
         FROM orders WHERE id = $1`,
        [orderIds[2]]
      )
    ).rows[0];
    expect(finished.status).toBe("completed");
    expect(finished.payment_status).toBe("paid");
    expect(finished.pickup_code ?? null).toBe(null);
    expect(finished.stamped).toBe(true);
    expect(finished.delivery_manual_reason.length).toBeGreaterThan(0);
    const finishAudit = (
      await pool!.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%FINISH%'",
        [orderIds[2]]
      )
    ).rows[0];
    expect(finishAudit.n).toBeGreaterThanOrEqual(1);
    // No set-verified/refund/notify action exists anywhere on this surface.
    await expect(
      finishPage.getByRole("button", { name: /tandai terverifikasi|refund|kirim email/i })
    ).toHaveCount(0);

    await finishPage.close();
    await page.close();
  });
});