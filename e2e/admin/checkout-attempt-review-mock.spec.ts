/**
 * Pre-order checkout attempts (plan: checkout-attempt-before-order) must be
 * visible to operators even though no Order row exists, and own-branch scope
 * must hide another branch's attempt. Fixtures are created directly in the
 * disposable database: the API and page are the seams under test.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { TEST_USERS } from "../config";

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const PREFIX = "e2e-checkout-attempt-review";
const branchA = `${PREFIX}-branch-a`;
const branchB = `${PREFIX}-branch-b`;
const clientId = `${PREFIX}-client-a`;
const clientIdB = `${PREFIX}-client-b`;
const attemptA = `${PREFIX}-attempt-a`;
const attemptB = `${PREFIX}-attempt-b`;
const requestKeyA = "c9300000-0000-4000-8000-000000000001";
const requestKeyB = "c9300000-0000-4000-8000-000000000002";

let pool: Pool;
let adminContext: BrowserContext;

function snapshot(branchId: string) {
  return {
    version: 1,
    order: { branchId, contactPhone: "0800000000", contactEmail: "attempt-review@example.test", subtotal: "100000", total: "111000" },
    items: [{ id: `${PREFIX}-item`, variantId: `${PREFIX}-variant`, productName: "Fixture", price: "100000", quantity: 1 }],
    cart: [{ itemId: `${PREFIX}-cart-line`, cartId: `${PREFIX}-cart`, variantId: `${PREFIX}-variant`, branchId, quantity: 1, updatedAt: "2040-01-01T00:00:00.000Z" }],
    createRequest: { contactId: -1, customerName: "Fixture", locationId: 1, note: `${PREFIX}-note`, items: [{ itemId: 1, quantity: 1, price: 100000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] },
    addressToSave: null,
  };
}

async function httpSignIn(context: BrowserContext, identifier: string, password: string) {
  const response = await context.request.post(`${ADMIN_BASE_URL}/api/auth/sign-in/username`, {
    data: { username: identifier, password },
  });
  expect(response.ok(), `admin sign-in failed for ${identifier}: ${await response.text()}`).toBe(true);
}

test.beforeAll(async ({ browser }) => {
  if (!process.env.E2E_PROVIDER_MOCKS || !process.env.DATABASE_URL) {
    throw new Error("checkout-attempt-review-mock.spec.ts must run under playwright.mock.config.ts with a disposable DATABASE_URL");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("DELETE FROM checkout_attempt WHERE id LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM branch WHERE id = ANY($1::text[])", [[branchA, branchB]]);
  await pool.query("DELETE FROM client WHERE id = ANY($1::text[])", [[clientId, clientIdB]]);
  await pool.query("INSERT INTO client (id,name,email) VALUES ($1,'Attempt Review','attempt-review@example.test'), ($2,'Attempt Review B','attempt-review-b@example.test')",
    [clientId, clientIdB]);
  await pool.query("INSERT INTO branch (id,name,code,city,address,jubelio_location_id) VALUES ($1,'Attempt Branch A',$3,'City','Address',901), ($2,'Attempt Branch B',$4,'City','Address',902)",
    [branchA, branchB, `${PREFIX}-A`, `${PREFIX}-B`]);
  // Home Branch of admintoko, so own-branch scope sees attempt A only.
  const home = await pool.query(`SELECT b.id FROM branch b JOIN "user" u ON u.branch_id=b.id WHERE u.username=$1`, [TEST_USERS.admin.identifier]);
  if (home.rows[0]?.id) {
    await pool.query("UPDATE branch SET name='Attempt Branch A' WHERE id=$1", [home.rows[0].id]);
    await pool.query("DELETE FROM branch WHERE id=$1", [branchA]);
    await pool.query("UPDATE checkout_attempt SET branch_id=$1 WHERE branch_id=$1", [home.rows[0].id]);
  }
  for (const [id, ownerId, branchId, requestKey] of [[attemptA, clientId, home.rows[0]?.id ?? branchA, requestKeyA], [attemptB, clientIdB, branchB, requestKeyB]] as const) {
    await pool.query(`INSERT INTO checkout_attempt (id, client_id, branch_id, request_key, fingerprint, reserved_order_id,
        state, payment_state, stock_hold_state, snapshot, payment_started_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,'manual_review','none','held',$7::jsonb,'2040-01-01T00:00:00Z','2040-01-01T00:15:00Z')`,
      [id, ownerId, branchId, requestKey, "b".repeat(64), `${PREFIX}-reserved-${id}`, JSON.stringify(snapshot(branchId))]);
  }
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(adminContext, TEST_USERS.admin.identifier, TEST_USERS.admin.password);
});

test.afterAll(async () => {
  await adminContext?.close().catch(() => {});
  if (pool) {
    await pool.query("DELETE FROM jubelio_sales_operation WHERE checkout_attempt_id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM checkout_attempt WHERE id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM branch WHERE id = ANY($1::text[])", [[branchA, branchB]]);
    await pool.query("DELETE FROM client WHERE id = ANY($1::text[])", [[clientId, clientIdB]]);
    await pool.end();
  }
});

test("the review queue lists an attempt that has no order and hides other branches", async () => {
  const response = await adminContext.request.get("/api/admin/reviews/sales-operations");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  const attempts = body.data.checkoutAttempts as Array<{ attemptId: string; state: string; requestKey: string }>;
  expect(attempts.map((row) => row.attemptId)).toContain(attemptA);
  expect(attempts.map((row) => row.attemptId)).not.toContain(attemptB);

  const page = await adminContext.newPage();
  try {
    await page.goto("/admin/orders/reviews");
    await expect(page.getByText("Checkout belum selesai").first()).toBeVisible();
    await expect(page.getByText(requestKeyA)).toBeVisible();
    await expect(page.getByText(requestKeyB)).toHaveCount(0);
    // No fabricated order link for a pre-order attempt.
    await expect(page.locator(`a[href="/admin/orders/${attemptA}"]`)).toHaveCount(0);
  } finally {
    await page.close();
  }
  expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id LIKE $1", [`${PREFIX}%`])).rows).toEqual([{ count: 0 }]);
});
