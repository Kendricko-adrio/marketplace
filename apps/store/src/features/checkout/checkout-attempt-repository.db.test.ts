import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { claimCheckoutPayment, recordCheckoutPaymentEvidence, readOwnedCheckoutAttempt, reserveCheckoutAttempt, finalizeRejectedCheckoutAttempt, promoteCheckoutAttempt } from "./checkout-attempt-repository";
import { recordJubelioSalesIntent, getJubelioSalesOperation } from "@/lib/jubelio-sales-operations";
import { placeCheckout } from "./place-order-service";
import { recoverCheckoutAttempts } from "./recover-checkout-service";
import { JubelioSalesGatewayError } from "@/lib/jubelio-sales-client";

const url = process.env.DATABASE_URL;
const enabled = !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
if (url && !enabled) throw new Error("Checkout attempt tests refuse non-disposable databases");
const pool = new Pool({ connectionString: url, max: 2 });
afterAll(async () => { await pool.end(); });
let connection: PoolClient;
const anchor = new Date("2040-01-01T00:00:00Z");
const paymentDatabase = drizzle(pool, { schema });
const snapshot: schema.CheckoutAttemptSnapshot = {
  version: 1, order: { branchId: "attempt-fixture-branch", contactPhone: "0800000000", contactEmail: "attempt@example.test", subtotal: "100000", ppnRate: "11", ppnAmount: "11000", total: "111000" },
  items: [{ id: "future-order-item", variantId: "fixture-variant", productName: "Fixture shoes", price: "100000", quantity: 1 }],
  cart: [{ itemId: "cart-line", cartId: "cart", variantId: "fixture-variant", branchId: "attempt-fixture-branch", quantity: 1, updatedAt: anchor.toISOString() }],
  createRequest: { contactId: -1, customerName: "Fixture", locationId: 1, note: "fixture-create", items: [{ itemId: 1, quantity: 1, price: 100000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] },
  addressToSave: null,
};

function fixture(overrides: Partial<typeof schema.checkoutAttempts.$inferInsert> = {}) {
  return { id: "attempt-fixture", clientId: "attempt-fixture-owner", branchId: "attempt-fixture-branch",
    requestKey: "b1200000-0000-4000-8000-000000000023", fingerprint: "a".repeat(64),
    reservedOrderId: "not-an-order-yet", snapshot, paymentStartedAt: anchor,
    expiresAt: new Date("2040-01-01T00:15:00Z"), ...overrides };
}
function database() { return drizzle(connection, { schema }); }

// Direct DB assertions are intentional: spec acceptance requires proving zero order rows,
// not only that the UI happens to hide a failed order.
describe.skipIf(!enabled)("checkout attempt persistence boundary (PostgreSQL)", () => {
  beforeAll(async () => { await pool.query("SELECT 1"); });
  beforeEach(async () => {
    connection = await pool.connect();
    await connection.query("BEGIN");
    await connection.query("INSERT INTO client (id,name,email) VALUES ('attempt-fixture-owner','Fixture','attempt-owner@example.test'), ('attempt-fixture-other','Other','attempt-other@example.test')");
    await connection.query("INSERT INTO branch (id,name,code,city,address) VALUES ('attempt-fixture-branch','Fixture','ATTEMPT-FIXTURE','Fixture city','Fixture address')");
  });
  afterEach(async () => { await connection.query("ROLLBACK"); connection.release(); });

  it("retains and reads rejected SO evidence without an order, and does not leak the snapshot", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture({ state: "rejected", failureCode: "SALES_ORDER_REJECTED", stockHoldState: "released" }));
    const result = await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000023" }, database());
    expect(result).toMatchObject({ version: 2, attemptId: "attempt-fixture", state: "rejected", orderId: null, paymentAvailable: false, redirectUrl: null, retryAllowed: true });
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("reservedOrderId");
    expect((await connection.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 0 }]);
  });

  it("retains a create operation on the attempt before any order exists", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture());
    await connection.query(`INSERT INTO jubelio_sales_operation (id,checkout_attempt_id,type,reference,payload)
      VALUES ('attempt-create-op','attempt-fixture','create','attempt-ledger-reference',$1::jsonb)`,
      [JSON.stringify({ type: "create", create: snapshot.createRequest })]);
    expect((await connection.query("SELECT order_id, checkout_attempt_id FROM jubelio_sales_operation WHERE id='attempt-create-op'")).rows)
      .toEqual([{ order_id: null, checkout_attempt_id: "attempt-fixture" }]);
  });

  it("replays an attempt-owned intent through the public ledger without duplicating it", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture());
    const input = { owner: { kind: "attempt" as const, attemptId: "attempt-fixture" },
      type: "create" as const, reference: "owned-create-reference", payload: { type: "create" as const, create: snapshot.createRequest } };
    const first = await recordJubelioSalesIntent(database(), input);
    const replay = await recordJubelioSalesIntent(database(), input);
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.operation.id).toBe(first.operation.id);
    expect(await getJubelioSalesOperation(database(), { owner: input.owner, type: "create" }))
      .toMatchObject({ id: first.operation.id, checkoutAttemptId: "attempt-fixture", orderId: null, status: "intent" });
  });

  it("refuses a provider operation with no order or attempt owner", async () => {
    await expect(connection.query(`INSERT INTO jubelio_sales_operation (id,type,reference,payload)
      VALUES ('orphan-create-op','create','orphan-reference',$1::jsonb)`,
      [JSON.stringify({ type: "create", create: snapshot.createRequest })]))
      .rejects.toMatchObject({ code: "23514", constraint: "jubelio_sales_operation_owner_required" });
  });

  it("hides another client's attempt and an unknown key", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture());
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-other", requestKey: "b1200000-0000-4000-8000-000000000023" }, database())).toBeNull();
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000024" }, database())).toBeNull();
  });

  it("refuses a second unresolved attempt with a different request key", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture());
    await expect(database().insert(schema.checkoutAttempts).values(fixture({ id: "second-attempt", requestKey: "b1200000-0000-4000-8000-000000000024", reservedOrderId: "second-future-order" })))
      .rejects.toMatchObject({ cause: { code: "23505", constraint: "checkout_attempt_active_owner_unique" } });
  });

  it("allows a fresh attempt after a terminal rejection without reusing the old identity", async () => {
    await database().insert(schema.checkoutAttempts).values(fixture({ state: "rejected", failureCode: "SALES_ORDER_REJECTED", stockHoldState: "released" }));
    await database().insert(schema.checkoutAttempts).values(fixture({ id: "second-attempt", requestKey: "b1200000-0000-4000-8000-000000000024", reservedOrderId: "second-future-order" }));
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000024" }, database()))
      .toMatchObject({ state: "preparing", orderId: null, retryAllowed: false });
  });

  it.each([
    { state: "promoted" as const },
    { state: "rejected" as const, failureCode: "SALES_ORDER_REJECTED" as const, stockHoldState: "held" },
    { state: "rejected" as const, stockHoldState: "released" },
    { paymentState: "ready" as const, paymentDispatchedAt: anchor },
    { paymentState: "dispatched_unknown" as const },
    { expiresAt: anchor },
  ])("refuses unsafe or incomplete lifecycle evidence %o", async (patch) => {
    await expect(database().insert(schema.checkoutAttempts).values(fixture(patch)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

// Committed fixtures let two real connections contend for the same payment claim.
describe.skipIf(!enabled)("checkout payment dispatch safety (PostgreSQL)", () => {
  beforeEach(async () => {
    await pool.query("INSERT INTO client (id,name,email) VALUES ('attempt-fixture-owner','Fixture','attempt-owner@example.test')");
    await pool.query("INSERT INTO branch (id,name,code,city,address) VALUES ('attempt-fixture-branch','Fixture','ATTEMPT-FIXTURE','Fixture city','Fixture address')");
    await paymentDatabase.insert(schema.checkoutAttempts).values(fixture({ stockHoldState: "mirrored" }));
    await pool.query(`INSERT INTO jubelio_sales_operation (id,checkout_attempt_id,type,reference,payload,status,sales_order_id,hold_accounted_at)
      VALUES ('claim-create-op','attempt-fixture','create','claim-create-reference',$1::jsonb,'confirmed',42,$2)`,
      [JSON.stringify({ type: "create", create: snapshot.createRequest }), anchor]);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM jubelio_sales_operation WHERE checkout_attempt_id='attempt-fixture'");
    await pool.query("DELETE FROM checkout_attempt WHERE id='attempt-fixture'");
    await pool.query("DELETE FROM branch WHERE id='attempt-fixture-branch'");
    await pool.query("DELETE FROM client WHERE id='attempt-fixture-owner'");
  });

  it("grants only one payment dispatch across concurrent connections and replay", async () => {
    const outcomes = await Promise.all([
      claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase),
      claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase),
    ]);
    expect(outcomes.filter((outcome) => outcome.claimed)).toHaveLength(1);
    expect(await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ claimed: false });
    expect((await pool.query("SELECT payment_state,order_id FROM checkout_attempt WHERE id='attempt-fixture'")).rows)
      .toEqual([{ payment_state: "dispatched_unknown", order_id: null }]);
  });

  it("does not dispatch payment at or after the approved reservation deadline", async () => {
    expect(await claimCheckoutPayment({ attemptId: "attempt-fixture", now: new Date("2040-01-01T00:15:00Z") }, paymentDatabase))
      .toMatchObject({ claimed: false, reason: "not_ready" });
  });

  it("does not initialize payment before independent SO confirmation", async () => {
    await pool.query("UPDATE jubelio_sales_operation SET status='manual_review',hold_accounted_at=NULL WHERE id='claim-create-op'");
    expect(await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ claimed: false });
    expect((await pool.query("SELECT payment_state FROM checkout_attempt WHERE id='attempt-fixture'")).rows)
      .toEqual([{ payment_state: "none" }]);
  });

  it("retains an unknown payment outcome without releasing the attempt or allowing a second dispatch", async () => {
    await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase);
    await recordCheckoutPaymentEvidence({ attemptId: "attempt-fixture", outcome: { kind: "unknown" } }, paymentDatabase);
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000023" }, paymentDatabase))
      .toMatchObject({ state: "manual_review", retryAllowed: false, orderId: null, paymentAvailable: false });
    expect(await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ claimed: false });
    expect((await pool.query("SELECT stock_hold_state,payment_state FROM checkout_attempt WHERE id='attempt-fixture'")).rows)
      .toEqual([{ stock_hold_state: "mirrored", payment_state: "manual_review" }]);
  });

  it("keeps a definitive payment rejection blocked until SO compensation is verified", async () => {
    await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase);
    await recordCheckoutPaymentEvidence({ attemptId: "attempt-fixture", outcome: { kind: "definitive_rejection" } }, paymentDatabase);
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000023" }, paymentDatabase))
      .toMatchObject({ state: "compensating", retryAllowed: false, orderId: null });
    expect((await pool.query("SELECT stock_hold_state FROM checkout_attempt WHERE id='attempt-fixture'")).rows)
      .toEqual([{ stock_hold_state: "mirrored" }]);
  });

  it("persists a ready session without exposing it or creating an order before promotion", async () => {
    await claimCheckoutPayment({ attemptId: "attempt-fixture" }, paymentDatabase);
    const evidence = { attemptId: "attempt-fixture", outcome: { kind: "ready" as const, token: "fixture-secret-token", redirectUrl: "https://payment.example.test/session" } };
    await recordCheckoutPaymentEvidence(evidence, paymentDatabase);
    await recordCheckoutPaymentEvidence(evidence, paymentDatabase);
    const view = await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: "b1200000-0000-4000-8000-000000000023" }, paymentDatabase);
    expect(view).toMatchObject({ state: "processing", orderId: null, paymentAvailable: false, redirectUrl: null, retryAllowed: false });
    expect(JSON.stringify(view)).not.toContain("fixture-secret-token");
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 0 }]);
    await expect(recordCheckoutPaymentEvidence({ ...evidence, outcome: { ...evidence.outcome, token: "conflicting-token" } }, paymentDatabase))
      .rejects.toThrow("Checkout payment evidence conflict");
  });
});

describe.skipIf(!enabled)("checkout stock reservation and definitive rejection (PostgreSQL)", () => {
  const input = () => ({ attemptId: "attempt-fixture", clientId: "attempt-fixture-owner", branchId: "attempt-fixture-branch",
    requestKey: "b1200000-0000-4000-8000-000000000023", fingerprint: "a".repeat(64), reservedOrderId: "not-an-order-yet",
    paymentStartedAt: anchor, expiresAt: new Date("2040-01-01T00:15:00Z"), stockObservedAt: anchor, offerCandidate: null,
    snapshot: { ...snapshot, order: { ...snapshot.order, pickupDate: "2040-01-01T17:00:00.000Z", pickupTime: "14:00" } }, now: anchor });
  beforeEach(async () => {
    await pool.query("INSERT INTO client (id,name,email,email_verified) VALUES ('attempt-fixture-owner','Fixture','attempt-owner@example.test',true)");
    const hours = Object.fromEntries(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map((day) => [day,{open:"09:00",close:"21:00"}]));
    await pool.query("INSERT INTO branch (id,name,code,city,address,jubelio_location_id,operating_hours) VALUES ('attempt-fixture-branch','Fixture','ATTEMPT-FIXTURE','Fixture city','Fixture address',1,$1::jsonb)", [JSON.stringify(hours)]);
    await pool.query("INSERT INTO product (id,name,slug,base_price) VALUES ('attempt-product','Fixture shoes','attempt-product','100000')");
    await pool.query("INSERT INTO product_variant (id,product_id,sku,price,jubelio_item_id) VALUES ('fixture-variant','attempt-product','ATTEMPT-VARIANT','100000',1)");
    await pool.query("INSERT INTO branch_stock (branch_id,product_variant_id,stock,available_stock,provider_stock_synced_at) VALUES ('attempt-fixture-branch','fixture-variant',5,5,$1)", [anchor]);
    await pool.query("INSERT INTO cart (id,user_id) VALUES ('cart','attempt-fixture-owner')");
    await pool.query("INSERT INTO cart_item (id,cart_id,variant_id,branch_id,quantity,updated_at) VALUES ('cart-line','cart','fixture-variant','attempt-fixture-branch',1,$1)", [anchor]);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM jubelio_sales_operation WHERE checkout_attempt_id='attempt-fixture'");
    await pool.query("DELETE FROM checkout_request WHERE order_id='not-an-order-yet'");
    await pool.query("DELETE FROM order_item WHERE order_id='not-an-order-yet'");
    await pool.query("DELETE FROM checkout_attempt WHERE id='attempt-fixture'");
    await pool.query("DELETE FROM orders WHERE id='not-an-order-yet'");
    await pool.query("DELETE FROM cart WHERE id='cart'");
    await pool.query("DELETE FROM branch_stock WHERE branch_id='attempt-fixture-branch'");
    await pool.query("DELETE FROM product_variant WHERE id='fixture-variant'");
    await pool.query("DELETE FROM product WHERE id='attempt-product'");
    await pool.query("DELETE FROM branch WHERE id='attempt-fixture-branch'");
    await pool.query("DELETE FROM client WHERE id='attempt-fixture-owner'");
  });

  it("places a definitive SO rejection through the public workflow without making an order or payment", async () => {
    let payments = 0;
    const result = await placeCheckout(input(), { database: paymentDatabase,
      salesGateway: { createSalesOrder: async () => { throw new JubelioSalesGatewayError("Fixture rejection", { ambiguous: false, retryable: false, code: "FIXTURE_REJECTED" }); },
        cancelSalesOrder: async () => { throw new Error("cancel must not run"); } },
      initializePayment: async () => { payments++; return { kind: "unknown" }; },
    });
    expect(result).toMatchObject({ state: "rejected", retryAllowed: true, orderId: null, failureCode: "SALES_ORDER_REJECTED" });
    expect(payments).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 0 }]);
  });

  it("keeps a lost SO response unresolved instead of starting payment or making an order", async () => {
    let payments = 0;
    const result = await placeCheckout(input(), { database: paymentDatabase,
      salesGateway: { createSalesOrder: async () => { throw new Error("connection reset after dispatch"); },
        cancelSalesOrder: async () => { throw new Error("cancel must not run"); } },
      initializePayment: async () => { payments++; return { kind: "unknown" }; },
    });
    expect(result).toMatchObject({ state: "manual_review", retryAllowed: false, orderId: null });
    expect(payments).toBe(0);
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows).toEqual([{ pending_remote_stock: 1 }]);
  });

  it("replays a concurrent same-key placement into one order, one SO and one payment session", async () => {
    let soPosts = 0;
    let payments = 0;
    const gateway = { createSalesOrder: async () => { soPosts++; return { salesOrderId: 42, order: { channelStatus: "Belum Bayar" } }; },
      cancelSalesOrder: async () => { throw new Error("cancel must not run"); } } as never;
    const deps = { database: paymentDatabase, salesGateway: gateway,
      initializePayment: async () => { payments++; return { kind: "ready" as const, token: "fixture-token", redirectUrl: "https://payment.example.test/session" }; } };
    const results = await Promise.all([placeCheckout(input(), deps), placeCheckout(input(), deps)]);
    expect(results.map((result) => result.orderId)).toEqual(["not-an-order-yet", "not-an-order-yet"]);
    for (const result of results) expect(result.state).toBe("promoted");
    expect(soPosts).toBe(1);
    expect(payments).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 1 }]);
  });

  it("creates exactly one order only when SO and payment are both ready, with a persisted payment session", async () => {
    const gateway = { createSalesOrder: async () => ({ salesOrderId: 42, order: { channelStatus: "Belum Bayar" } }),
      cancelSalesOrder: async () => { throw new Error("cancel must not run on success"); } } as never;
    const first = await placeCheckout(input(), { database: paymentDatabase, salesGateway: gateway,
      initializePayment: async () => ({ kind: "ready", token: "fixture-token", redirectUrl: "https://payment.example.test/session" }) });
    expect(first).toMatchObject({ state: "promoted", orderId: "not-an-order-yet", paymentAvailable: true,
      redirectUrl: "https://payment.example.test/session", retryAllowed: false });
    const replay = await placeCheckout(input(), { database: paymentDatabase, salesGateway: gateway,
      initializePayment: async () => { throw new Error("payment must not be re-initialized"); } });
    expect(replay).toMatchObject({ state: "promoted", orderId: "not-an-order-yet" });
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 1 }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM cart_item WHERE id='cart-line'")).rows).toEqual([{ count: 0 }]);
    expect((await pool.query("SELECT pending_remote_stock, available_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ pending_remote_stock: 0, available_stock: 4 }]);
  });

  it("compensates a definitively rejected payment by cancelling the SO before allowing retry", async () => {
    let cancels = 0;
    const gateway = { createSalesOrder: async () => ({ salesOrderId: 42, order: { channelStatus: "Belum Bayar" } }),
      cancelSalesOrder: async () => { cancels++; return { salesOrderId: 42, alreadyCanceled: false, order: { isCanceled: true } }; } } as never;
    const result = await placeCheckout(input(), { database: paymentDatabase, salesGateway: gateway,
      initializePayment: async () => ({ kind: "definitive_rejection" }) });
    expect(result).toMatchObject({ state: "rejected", orderId: null, retryAllowed: true, failureCode: "PAYMENT_INITIALIZATION_REJECTED" });
    expect(cancels).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 0 }]);
    expect((await pool.query("SELECT available_stock, pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ available_stock: 5, pending_remote_stock: 0 }]);
  });

  it("does not release stock or retry while an SO cancel outcome is unknown", async () => {
    const gateway = { createSalesOrder: async () => ({ salesOrderId: 42, order: { channelStatus: "Belum Bayar" } }),
      cancelSalesOrder: async () => { throw new Error("cancel response lost"); } } as never;
    const result = await placeCheckout(input(), { database: paymentDatabase, salesGateway: gateway,
      initializePayment: async () => ({ kind: "definitive_rejection" }) });
    expect(result).toMatchObject({ state: "manual_review", orderId: null, retryAllowed: false });
    expect((await pool.query("SELECT available_stock, pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ available_stock: 4, pending_remote_stock: 0 }]);
  });

  it("holds a possibly-sent SO for review instead of re-dispatching it", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    // Aged claim: a fresh claim belongs to a concurrent caller, an aged one is held.
    await pool.query("UPDATE jubelio_sales_operation SET status='dispatched_unknown',dispatched_at='2039-12-31T00:00:00Z' WHERE checkout_attempt_id='attempt-fixture'");
    await pool.query("UPDATE checkout_attempt SET updated_at='2039-12-31T00:00:00Z' WHERE id='attempt-fixture'");
    const summary = await recoverCheckoutAttempts({ limit: 10, cutoff: new Date("2040-01-01T00:00:00Z"), now: new Date("2040-01-01T00:01:00Z") }, paymentDatabase);
    // Other suites may leave their own attempts in the shared disposable DB.
    expect(summary.promoted).toBe(0);
    expect(summary.held).toBeGreaterThanOrEqual(1);
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: input().requestKey }, paymentDatabase))
      .toMatchObject({ state: "manual_review", retryAllowed: false, orderId: null });
    expect((await pool.query("SELECT status FROM jubelio_sales_operation WHERE checkout_attempt_id='attempt-fixture'")).rows)
      .toEqual([{ status: "dispatched_unknown" }]);
  });

  it("completes a missed local promotion from a ready payment session without a new provider call", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE jubelio_sales_operation SET status='confirmed',sales_order_id=42,hold_accounted_at=$1 WHERE checkout_attempt_id='attempt-fixture'", [anchor]);
    await pool.query("UPDATE checkout_attempt SET stock_hold_state='mirrored',payment_state='ready',payment_token='fixture-token',payment_redirect_url='https://payment.example.test/session',payment_dispatched_at=$1,state='processing',updated_at='2039-12-31T00:00:00Z' WHERE id='attempt-fixture'", [anchor]);
    const summary = await recoverCheckoutAttempts({ limit: 10, cutoff: new Date("2040-01-01T00:00:00Z"), now: new Date("2040-01-01T00:01:00Z") }, paymentDatabase);
    expect(summary).toMatchObject({ scanned: 1, promoted: 1 });
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 1 }]);
  });

  it("releases an expired attempt whose SO intent was never sent", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE checkout_attempt SET payment_started_at='2039-12-30T00:00:00Z',expires_at='2039-12-31T00:00:00Z',updated_at='2039-12-31T00:00:00Z' WHERE id='attempt-fixture'");
    const summary = await recoverCheckoutAttempts({ limit: 10, cutoff: new Date("2040-01-01T00:00:00Z"), now: new Date("2040-01-01T00:01:00Z") }, paymentDatabase);
    expect(summary.rejected).toBeGreaterThanOrEqual(1);
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: input().requestKey }, paymentDatabase))
      .toMatchObject({ state: "rejected", failureCode: "CHECKOUT_EXPIRED", retryAllowed: true });
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ pending_remote_stock: 0 }]);
    expect((await pool.query("SELECT status FROM jubelio_sales_operation WHERE checkout_attempt_id='attempt-fixture'")).rows)
      .toEqual([{ status: "aborted" }]);
  });

  it("reserves once with a durable SO intent and zero orders, including replay", async () => {
    const first = await reserveCheckoutAttempt(input(), paymentDatabase);
    const replay = await reserveCheckoutAttempt({ ...input(), attemptId: "unused-replay-attempt" }, paymentDatabase);
    expect(first).toMatchObject({ attemptId: "attempt-fixture", created: true });
    expect(replay).toMatchObject({ attemptId: "attempt-fixture", created: false });
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ pending_remote_stock: 1 }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 0 }]);
    expect(await getJubelioSalesOperation(paymentDatabase, { owner: { kind: "attempt", attemptId: "attempt-fixture" }, type: "create" }))
      .toMatchObject({ status: "intent", orderId: null });
  });

  it("releases its own hold only once for a definitive SO rejection and keeps the cart", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE jubelio_sales_operation SET status='rejected' WHERE checkout_attempt_id='attempt-fixture'");
    await finalizeRejectedCheckoutAttempt({ attemptId: "attempt-fixture", reason: "SALES_ORDER_REJECTED" }, paymentDatabase);
    await finalizeRejectedCheckoutAttempt({ attemptId: "attempt-fixture", reason: "SALES_ORDER_REJECTED" }, paymentDatabase);
    expect(await readOwnedCheckoutAttempt({ clientId: "attempt-fixture-owner", requestKey: input().requestKey }, paymentDatabase))
      .toMatchObject({ state: "rejected", orderId: null, retryAllowed: true, failureCode: "SALES_ORDER_REJECTED" });
    expect((await pool.query("SELECT pending_remote_stock,available_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ pending_remote_stock: 0, available_stock: 5 }]);
    expect((await pool.query("SELECT quantity FROM cart_item WHERE id='cart-line'")).rows).toEqual([{ quantity: 1 }]);
  });

  it("promotes exactly one order only after the SO and payment are ready, consuming unchanged cart lines", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE jubelio_sales_operation SET status='confirmed',sales_order_id=42,hold_accounted_at=$1 WHERE checkout_attempt_id='attempt-fixture'", [anchor]);
    await pool.query("UPDATE checkout_attempt SET stock_hold_state='mirrored',payment_state='ready',payment_token='fixture-token',payment_redirect_url='https://payment.example.test/session',payment_dispatched_at=$1,state='processing' WHERE id='attempt-fixture'", [anchor]);
    await pool.query("UPDATE branch_stock SET pending_remote_stock=0,available_stock=4 WHERE branch_id='attempt-fixture-branch'");
    expect(await promoteCheckoutAttempt({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ orderId: "not-an-order-yet" });
    expect(await promoteCheckoutAttempt({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ orderId: "not-an-order-yet" });
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE id='not-an-order-yet'")).rows).toEqual([{ count: 1 }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM cart_item WHERE id='cart-line'")).rows).toEqual([{ count: 0 }]);
    expect(await getJubelioSalesOperation(paymentDatabase, { orderId: "not-an-order-yet", type: "create" })).toMatchObject({ salesOrderId: 42, checkoutAttemptId: "attempt-fixture" });
  });

  it("keeps a cart line the customer changed after review instead of deleting it", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE jubelio_sales_operation SET status='confirmed',sales_order_id=42,hold_accounted_at=$1 WHERE checkout_attempt_id='attempt-fixture'", [anchor]);
    await pool.query("UPDATE checkout_attempt SET stock_hold_state='mirrored',payment_state='ready',payment_token='fixture-token',payment_redirect_url='https://payment.example.test/session',payment_dispatched_at=$1,state='processing' WHERE id='attempt-fixture'", [anchor]);
    await pool.query("UPDATE branch_stock SET pending_remote_stock=0,available_stock=4 WHERE branch_id='attempt-fixture-branch'");
    await pool.query("UPDATE cart_item SET quantity=2,updated_at=now() WHERE id='cart-line'");
    expect(await promoteCheckoutAttempt({ attemptId: "attempt-fixture" }, paymentDatabase)).toMatchObject({ orderId: "not-an-order-yet" });
    expect((await pool.query("SELECT quantity FROM cart_item WHERE id='cart-line'")).rows).toEqual([{ quantity: 2 }]);
    expect((await pool.query("SELECT quantity FROM order_item WHERE order_id='not-an-order-yet'")).rows).toEqual([{ quantity: 1 }]);
  });

  it("cannot release an unknown SO create outcome", async () => {
    await reserveCheckoutAttempt(input(), paymentDatabase);
    await pool.query("UPDATE jubelio_sales_operation SET status='manual_review' WHERE checkout_attempt_id='attempt-fixture'");
    await expect(finalizeRejectedCheckoutAttempt({ attemptId: "attempt-fixture", reason: "SALES_ORDER_REJECTED" }, paymentDatabase))
      .rejects.toThrow("Checkout rejection lacks definitive provider evidence");
    expect((await pool.query("SELECT pending_remote_stock FROM branch_stock WHERE branch_id='attempt-fixture-branch'")).rows)
      .toEqual([{ pending_remote_stock: 1 }]);
  });

  it("rolls back the attempt, SO intent, and all holds if stock changed before reservation", async () => {
    await pool.query("UPDATE branch_stock SET available_stock=0 WHERE branch_id='attempt-fixture-branch'");
    await expect(reserveCheckoutAttempt(input(), paymentDatabase)).rejects.toMatchObject({ code: "CHECKOUT_REVIEW_REQUIRED" });
    expect((await pool.query("SELECT count(*)::int AS count FROM checkout_attempt WHERE id='attempt-fixture'")).rows).toEqual([{ count: 0 }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM jubelio_sales_operation WHERE checkout_attempt_id='attempt-fixture'")).rows).toEqual([{ count: 0 }]);
  });
});
