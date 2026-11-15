import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../../.env"), quiet: true });
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { listCheckoutAttemptReviews } from "./checkout-attempt-review-repository";

// Direct SQL verification is intentional here: the invariant under test is that
// an unresolved checkout has NO order row, which the interface alone cannot prove.
const url = process.env.DATABASE_URL ?? "";
const enabled = !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
if (url && !enabled) throw new Error("Checkout attempt review tests refuse non-disposable databases");
const pool = new Pool({ connectionString: url });
const PREFIX = `checkout-attempt-review-${crypto.randomUUID()}`;
const branchA = `${PREFIX}-branch-a`;
const branchB = `${PREFIX}-branch-b`;
const clientIds = [`${PREFIX}-client-a`, `${PREFIX}-client-b`, `${PREFIX}-client-c`];
const snapshot = {
  version: 1 as const,
  order: { branchId: branchA, contactPhone: "0800000000", contactEmail: "review@example.test", subtotal: "100000", total: "111000" },
  items: [{ id: `${PREFIX}-item`, variantId: `${PREFIX}-variant`, productName: "Fixture", price: "100000", quantity: 1 }],
  cart: [{ itemId: `${PREFIX}-cart-line`, cartId: `${PREFIX}-cart`, variantId: `${PREFIX}-variant`, branchId: branchA, quantity: 1, updatedAt: "2040-01-01T00:00:00.000Z" }],
  createRequest: { contactId: -1, customerName: "Fixture", locationId: 1, note: `${PREFIX}-note`, items: [{ itemId: 1, quantity: 1, price: 100000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] },
  addressToSave: null,
};

async function insertAttempt(input: { id: string; branchId: string; state: string; paymentState: string; clientId: string; stockHoldState?: string; failureCode?: string | null }) {
  await pool.query(`INSERT INTO checkout_attempt (id, client_id, branch_id, request_key, fingerprint, reserved_order_id,
      state, payment_state, stock_hold_state, failure_code, snapshot, payment_started_at, expires_at)
    VALUES ($1,$2,$3,gen_random_uuid(),$4,$5,$6,$7,$8,$9,$10::jsonb,'2040-01-01T00:00:00Z','2040-01-01T00:15:00Z')`,
    [input.id, input.clientId, input.branchId, "a".repeat(64), `${PREFIX}-reserved-${input.id}`, input.state, input.paymentState,
      input.stockHoldState ?? "held", input.failureCode ?? null,
      JSON.stringify({ ...snapshot, order: { ...snapshot.order, branchId: input.branchId } })]);
}

describe.skipIf(!enabled)("checkout attempt operator review (PostgreSQL)", () => {
  beforeAll(async () => {
    await pool.query("INSERT INTO client (id,name,email) VALUES ($1,'Review A','review-a@example.test'), ($2,'Review B','review-b@example.test'), ($3,'Review C','review-c@example.test')",
      clientIds);
    await pool.query("INSERT INTO branch (id,name,code,city,address) VALUES ($1,'Branch A',$3,'City','Address'), ($2,'Branch B',$4,'City','Address')",
      [branchA, branchB, `${PREFIX}-A`, `${PREFIX}-B`]);
    await insertAttempt({ id: `${PREFIX}-manual`, branchId: branchA, state: "manual_review", paymentState: "none", clientId: clientIds[0] });
    await insertAttempt({ id: `${PREFIX}-processing`, branchId: branchB, state: "processing", paymentState: "intent", clientId: clientIds[1] });
    await insertAttempt({ id: `${PREFIX}-rejected`, branchId: branchA, state: "rejected", paymentState: "rejected", clientId: clientIds[2], stockHoldState: "released", failureCode: "SALES_ORDER_REJECTED" });
  });
  afterAll(async () => {
    await pool.query("DELETE FROM jubelio_sales_operation WHERE checkout_attempt_id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM checkout_attempt WHERE id LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM branch WHERE id = ANY($1::text[])", [[branchA, branchB]]);
    await pool.query("DELETE FROM client WHERE id = ANY($1::text[])", [clientIds]);
    await pool.end();
  });

  it("lists unresolved attempts for all-branch scope without fabricating an order", async () => {
    const rows = await listCheckoutAttemptReviews({ scope: { mode: "all" } });
    const ids = rows.map((row) => row.attemptId);
    expect(ids).toEqual(expect.arrayContaining([`${PREFIX}-manual`, `${PREFIX}-processing`]));
    expect(ids).not.toContain(`${PREFIX}-rejected`);
    for (const row of rows) expect(row).not.toHaveProperty("addressId");
    expect(rows.find((row) => row.attemptId === `${PREFIX}-processing`)?.stage).toBe("payment");
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE user_id = ANY($1::text[])", [clientIds])).rows).toEqual([{ count: 0 }]);
  });

  it("hides other branches for own-branch scope", async () => {
    const rows = await listCheckoutAttemptReviews({ scope: { mode: "own", branchId: branchA } });
    expect(rows.map((row) => row.attemptId)).toEqual([`${PREFIX}-manual`]);
  });
});
