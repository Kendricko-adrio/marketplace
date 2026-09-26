import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

// Admin review queue (Sales-Order flow, plan feature 5): a paid-but-ambiguous
// order stays paid, is visible in the read-only review queue with its remote
// ids and reason, and verify-pickup can never complete it.
//
// Fixtures are keyed by a dedicated prefix and removed in afterAll.

dotenv.config({ path: ".env" });

const CLIENT_ID = "e2e-review-queue-client";
const ORDER_ID = "e2e-review-queue-order";
const OPERATION_ID = "e2e-review-queue-operation";

let pool: Pool;
// Both assertions share one fixed fixture identity; avoid parallel setup races.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DELETE FROM "client" WHERE id = $1', [CLIENT_ID]);
  await pool.query(
    `INSERT INTO "client" (id, name, email, email_verified)
     VALUES ($1, 'Review Queue E2E', 'review-queue-e2e@example.test', true)`,
    [CLIENT_ID]
  );
  // The admin session (admintoko) is own-branch scoped to its Home Branch —
  // attach the fixture order to that branch so the queue returns it.
  const homeBranch = await pool.query(
    "SELECT id FROM branch WHERE name = 'Cabang Jakarta Pusat' LIMIT 1"
  );
  // Paid-but-blocked order: Midtrans authoritative paid, Jubelio settlement
  // unverified. No pickup code may exist.
  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, payment_method,
        contact_phone, contact_email, subtotal, total,
        jubelio_sales_order_id, fulfillment_blocked_reason)
     VALUES ($1, $2, $3, 'processing', 'paid', 'gopay',
             '0000000000', 'review-queue-e2e@example.test', 100000, 111000,
             69000999,
             'Sales-Order invoice is unverified: invoice grand total mismatch (e2e fixture)')`,
    [ORDER_ID, CLIENT_ID, homeBranch.rows[0].id]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation
       (id, order_id, type, status, reference, payload, sales_order_id, invoice_id,
        attempt_count, dispatched_at, last_error)
     VALUES ($1, $2, 'invoice', 'manual_review', $3, $4::jsonb, 69000999, null,
             1, NOW(), 'Invoice conversion outcome unknown after timeout (e2e fixture)')`,
    [
      OPERATION_ID,
      ORDER_ID,
      `OKCIR_SO_INVOICE:${ORDER_ID}:e2e`,
      JSON.stringify({ type: "invoice", invoice: { salesOrderId: 69000999 } }),
    ]
  );
});

test.afterAll(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM "client" WHERE id = $1', [CLIENT_ID]);
  await pool.end();
});

test("review queue lists manual-review operations and paid-but-blocked orders (read-only)", async ({
  request,
}) => {
  const res = await request.get("/api/admin/reviews/sales-operations");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);

  const operation = body.data.operations.find(
    (op: { id: string }) => op.id === OPERATION_ID
  );
  expect(operation).toBeTruthy();
  expect(operation).toMatchObject({
    type: "invoice",
    status: "manual_review",
    salesOrderId: 69000999,
    orderId: ORDER_ID,
  });
  expect(operation.lastError).toContain("e2e fixture");

  const blocked = body.data.blockedOrders.find(
    (row: { orderId: string }) => row.orderId === ORDER_ID
  );
  expect(blocked).toBeTruthy();
  expect(blocked).toMatchObject({
    status: "processing",
    paymentStatus: "paid",
    jubelioSalesOrderId: 69000999,
  });
  expect(blocked.fulfillmentBlockedReason).toContain("e2e fixture");
  // A blocked order never carries a pickup code.
  expect(blocked.jubelioPaymentId).toBeNull();
});

test("a paid-but-blocked order never exposes a pickup code", async ({ request }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const state = await pool.query(
    "SELECT pickup_code, status, payment_status FROM orders WHERE id = $1",
    [ORDER_ID]
  );
  await pool.end();
  expect(state.rows[0]).toMatchObject({
    pickup_code: null,
    status: "processing",
    payment_status: "paid",
  });
  // Defense in depth: verify-pickup refuses blocked orders outright (or
  // 404s them behind branch scope).
  const attempt = await request.post(
    `/api/admin/orders/${ORDER_ID}/verify-pickup`,
    { data: { pickupCodeInput: "AAAAAA" } }
  );
  expect([400, 403, 404, 409]).toContain(attempt.status());
});