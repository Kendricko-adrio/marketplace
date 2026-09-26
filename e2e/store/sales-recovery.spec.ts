import { test, expect } from "@playwright/test";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env", quiet: true });
test.use({ storageState: { cookies: [], origins: [] } });

const CLIENT_ID = "e2e-jso-recovery-client";
const ORDER_ID = "e2e-jso-recovery-order";
const OPERATION_ID = "e2e-jso-recovery-operation";
let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Remove only this spec's interrupted-run fixture, never other test data.
  await pool.query('DELETE FROM "client" WHERE id = $1', [CLIENT_ID]);
  await pool.query(
    'INSERT INTO "client" (id, name, email, email_verified) VALUES ($1, $2, $3, true)',
    [CLIENT_ID, "SO Recovery E2E", "so-recovery-e2e@example.test"]
  );
  await pool.query(
    `INSERT INTO orders (id, user_id, status, contact_phone, contact_email, subtotal, total)
     VALUES ($1, $2, 'failed_payment', '0000000000', 'so-recovery-e2e@example.test', 100, 100)`,
    [ORDER_ID, CLIENT_ID]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation
     (id, order_id, type, status, reference, payload, attempt_count, dispatched_at)
     VALUES ($1, $2, 'create', 'dispatched_unknown', $3, $4::jsonb, 1, '2020-01-01T00:00:00Z')`,
    [OPERATION_ID, ORDER_ID, `OKCIR_SO_CREATE:${ORDER_ID}:${OPERATION_ID}`,
      JSON.stringify({ type: "create", create: { note: OPERATION_ID } })]
  );
});

test.afterAll(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM "client" WHERE id = $1', [CLIENT_ID]);
  await pool.end();
});

test("cron auth protects stale SO recovery; authorized sweep queues unknown write once", async ({ request }) => {
  const denied = await request.post("/api/cron/sweep-reservations", {
    headers: { "x-cron-secret": "incorrect-secret" },
  });
  expect(denied.status()).toBe(401);
  const stillUnknown = await pool.query(
    "SELECT status FROM jubelio_sales_operation WHERE id = $1", [OPERATION_ID]
  );
  expect(stillUnknown.rows[0].status).toBe("dispatched_unknown");

  const secret = process.env.CRON_SECRET;
  expect(secret).toBeTruthy();
  const response = await request.post("/api/cron/sweep-reservations", {
    headers: { "x-cron-secret": secret! },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.jubelioSalesReview.marked).toBeGreaterThanOrEqual(1);
  const operation = await pool.query(
    "SELECT status, attempt_count, sales_order_id FROM jubelio_sales_operation WHERE id = $1", [OPERATION_ID]
  );
  expect(operation.rows[0]).toMatchObject({
    status: "manual_review", attempt_count: 1, sales_order_id: null,
  });
  const replay = await request.post("/api/cron/sweep-reservations", {
    headers: { "x-cron-secret": secret! },
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).jubelioSalesReview.marked).toBe(0);
});
