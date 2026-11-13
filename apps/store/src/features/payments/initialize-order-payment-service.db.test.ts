import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import dotenvless from "dotenv";
import { initializeOrderPayment } from "./initialize-order-payment-service";
import { claimOrderPaymentInitialization } from "./order-payment-repository";

// =========================================================
// TX-02 public seam on real PostgreSQL: ONE payment session per order, shared
// by initial legacy payment and repayment. A durable claim is the only
// dispatch permission, so a concurrent loser can never create a second Snap
// session, and an UNKNOWN outcome never compensates or cancels the SO.
//
// Disposable database only (marketplace_discounts_test_*). A skip is NOT a pass.
// =========================================================
void dotenvless;

const url = process.env.DATABASE_URL;
const enabled =
  !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
const pool = new Pool({ connectionString: url, max: 4 });
afterAll(async () => {
  await pool.end();
});

const PREFIX = "tx02-pay-dbtest-";
const TEST_SO_ID = 987_321;
let connection: PoolClient;
let database: ReturnType<typeof drizzle<typeof schema>>;

async function insertOrder(
  orderId: string,
  overrides: {
    status?: string;
    paymentStatus?: string;
    redirectUrl?: string | null;
    expiresAt?: Date;
    salesOrderConfirmed?: boolean;
  } = {}
) {
  await connection.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true)
     on conflict (id) do nothing`,
    [`${PREFIX}client-${orderId}`, "Payment DB Test", `${PREFIX}${orderId}@example.test`]
  );
  await connection.query(
    `insert into orders (id, user_id, status, payment_status, contact_phone, contact_email,
                         subtotal, total, expires_at, snap_redirect_url, jubelio_sales_order_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      orderId,
      `${PREFIX}client-${orderId}`,
      overrides.status ?? "pending_payment",
      overrides.paymentStatus ?? "pending",
      "0000000000",
      `${PREFIX}${orderId}@example.test`,
      "111000",
      "111000",
      overrides.expiresAt ?? new Date("2040-01-01T00:15:00Z"),
      overrides.redirectUrl ?? null,
      overrides.salesOrderConfirmed === false ? null : TEST_SO_ID,
    ]
  );
  if (overrides.salesOrderConfirmed !== false) {
    await connection.query(
      `insert into jubelio_sales_operation (id, order_id, type, status, reference, payload, sales_order_id, dispatched_at, confirmed_at)
       values ($1,$2,'create','confirmed',$3,$4::jsonb,$5, now(), now())
       on conflict do nothing`,
      [
        `${PREFIX}create-${orderId}`,
        orderId,
        `SO_CREATE:${orderId}`,
        JSON.stringify({
          type: "create",
          create: {
            contactId: -1,
            customerName: "Payment DB Test",
            locationId: 61,
            note: "fixture",
            items: [
              { itemId: 1, quantity: 1, price: 111000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 },
            ],
          },
        }),
        TEST_SO_ID,
      ]
    );
  }
}

async function recordIntent(orderId: string) {
  await database.transaction(async (tx) => {
    const { recordOrderPaymentIntent } = await import("./order-payment-repository");
    await recordOrderPaymentIntent(tx, {
      orderId,
      providerReference: orderId,
      expectedAmount: "111000",
      paymentStartedAt: new Date("2040-01-01T00:00:00Z"),
      expiresAt: new Date("2040-01-01T00:15:00Z"),
      cartSnapshot: [
        {
          cartId: `${PREFIX}cart`,
          itemId: `${PREFIX}item`,
          variantId: `${PREFIX}variant`,
          branchId: `${PREFIX}branch`,
          quantity: 1,
          updatedAt: "2040-01-01T00:00:00.000Z",
        },
      ],
      now: new Date("2040-01-01T00:00:00Z"),
    });
  });
}

async function readSession(orderId: string) {
  const result = await connection.query(
    `select state, provenance, dispatch_claim_id, redirect_url, token, expected_amount, expires_at
     from order_payment_session where order_id = $1`,
    [orderId]
  );
  return result.rows[0] as
    | {
        state: string;
        provenance: string;
        dispatch_claim_id: string | null;
        redirect_url: string | null;
        token: string | null;
        expected_amount: string;
        expires_at: Date | null;
      }
    | undefined;
}

async function readOrder(orderId: string) {
  const result = await connection.query(
    `select status, payment_status, snap_redirect_url from orders where id = $1`,
    [orderId]
  );
  return result.rows[0] as { status: string; payment_status: string; snap_redirect_url: string | null };
}

describe.skipIf(!enabled)("initialize order payment (PostgreSQL)", () => {
  beforeAll(async () => {
    database = drizzle(pool, { schema });
    connection = await pool.connect();
  });

  afterAll(async () => {
    connection.release();
  });

  afterEach(async () => {
    await connection.query(`delete from order_payment_session where order_id like $1`, [`${PREFIX}%`]);
    await connection.query(`delete from jubelio_sales_operation where order_id like $1`, [`${PREFIX}%`]);
    await connection.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
    await connection.query(`delete from client where id like $1`, [`${PREFIX}%`]);
  });

  it("allows exactly one Snap creation when initial payment and repayment race", async () => {
    const orderId = `${PREFIX}race`;
    await insertOrder(orderId);
    await recordIntent(orderId);

    let snapCreates = 0;
    const createSession = async () => {
      snapCreates++;
      return {
        kind: "ready" as const,
        token: `token-${orderId}`,
        redirectUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture",
      };
    };

    const [first, second] = await Promise.all([
      initializeOrderPayment(
        { orderId, clientId: `${PREFIX}client-${orderId}`, source: "legacy_place" },
        { database, createSession }
      ),
      initializeOrderPayment(
        { orderId, clientId: `${PREFIX}client-${orderId}`, source: "repayment" },
        { database, createSession }
      ),
    ]);

    expect(snapCreates).toBe(1);
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toContain("ready");
    expect(kinds.every((kind) => kind === "ready" || kind === "processing")).toBe(true);
    const session = await readSession(orderId);
    expect(session).toMatchObject({ state: "ready", provenance: "runtime" });
    expect((await readOrder(orderId)).snap_redirect_url).toBe(
      "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture"
    );
  });

  it("keeps an applied-but-lost provider response unknown without failing or cancelling the Sales Order", async () => {
    const orderId = `${PREFIX}lost`;
    await insertOrder(orderId);
    await recordIntent(orderId);

    const result = await initializeOrderPayment(
      { orderId, clientId: `${PREFIX}client-${orderId}`, source: "legacy_place" },
      {
        database,
        createSession: async () => {
          throw new Error("socket hang up after the provider applied the request");
        },
      }
    );

    expect(result).toEqual({ kind: "processing", reason: "initialization_unknown" });
    const session = await readSession(orderId);
    // The claim is durable: a possibly-sent session can never return to intent.
    expect(session?.state).toBe("dispatched_unknown");
    expect(session?.dispatch_claim_id).toBeTruthy();
    const order = await readOrder(orderId);
    expect(order.status).toBe("pending_payment");
    expect(order.payment_status).toBe("pending");
    const cancels = await connection.query(
      `select count(*)::int as count from jubelio_sales_operation where order_id = $1 and type = 'cancel'`,
      [orderId]
    );
    expect(cancels.rows[0]).toEqual({ count: 0 });
  });

  it("turns an allowlisted definitive rejection into a durable cancel obligation", async () => {
    const orderId = `${PREFIX}rejected`;
    await insertOrder(orderId);
    await recordIntent(orderId);

    const result = await initializeOrderPayment(
      { orderId, clientId: `${PREFIX}client-${orderId}`, source: "legacy_place" },
      {
        database,
        createSession: async () => ({ kind: "definitive_rejection", code: "provider_rejected" }),
      }
    );

    expect(result).toMatchObject({ kind: "rejected" });
    expect((await readSession(orderId))?.state).toBe("rejected");
    const order = await readOrder(orderId);
    expect(order.status).toBe("failed_payment");
    const cancel = await connection.query(
      `select status from jubelio_sales_operation where order_id = $1 and type = 'cancel'`,
      [orderId]
    );
    expect(cancel.rows).toHaveLength(1);
  });

  it("reuses a ready session without extending the deadline or re-pricing", async () => {
    const orderId = `${PREFIX}ready`;
    await insertOrder(orderId);
    await recordIntent(orderId);
    const readyUrl = "https://app.sandbox.midtrans.com/snap/v4/redirection/fixture-ready";
    await initializeOrderPayment(
      { orderId, clientId: `${PREFIX}client-${orderId}`, source: "legacy_place" },
      {
        database,
        createSession: async () => ({ kind: "ready", token: "token-ready", redirectUrl: readyUrl }),
      }
    );
    const before = await readSession(orderId);

    let providerCalls = 0;
    const replay = await initializeOrderPayment(
      { orderId, clientId: `${PREFIX}client-${orderId}`, source: "repayment" },
      {
        database,
        createSession: async () => {
          providerCalls++;
          return { kind: "unknown", code: "should_not_run" };
        },
      }
    );

    expect(replay).toEqual({ kind: "ready", redirectUrl: readyUrl, token: null, replayed: true });
    expect(providerCalls).toBe(0);
    const after = await readSession(orderId);
    expect(after?.expires_at).toEqual(before?.expires_at);
    expect(after?.expected_amount).toBe(before?.expected_amount);
  });

  it("adopts a historical redirect instead of creating a new session", async () => {
    const orderId = `${PREFIX}adopted`;
    const historical = "https://app.sandbox.midtrans.com/snap/v4/redirection/historical";
    await insertOrder(orderId, { redirectUrl: historical });

    let providerCalls = 0;
    const result = await initializeOrderPayment(
      { orderId, clientId: `${PREFIX}client-${orderId}`, source: "repayment" },
      {
        database,
        createSession: async () => {
          providerCalls++;
          return { kind: "ready", token: "should-not-happen", redirectUrl: "https://x.invalid" };
        },
      }
    );

    expect(result).toEqual({ kind: "ready", redirectUrl: historical, token: null, replayed: true });
    expect(providerCalls).toBe(0);
    expect(await readSession(orderId)).toMatchObject({
      state: "ready",
      provenance: "adopted_redirect",
    });
  });

  it("never invents never-sent proof for a historical order without a redirect", async () => {
    const orderId = `${PREFIX}legacy`;
    await insertOrder(orderId);

    const claim = await claimOrderPaymentInitialization(
      { orderId, clientId: `${PREFIX}client-${orderId}`, now: new Date("2040-01-01T00:20:00Z"), adoptHistoricalRedirect: true },
      database
    );

    expect(claim).toEqual({ claimed: false, reason: "legacy_unknown" });
    expect(await readSession(orderId)).toMatchObject({ state: "manual_review", provenance: "legacy_unknown" });
  });

  it("refuses another client's order and never claims past the deadline", async () => {
    const orderId = `${PREFIX}owner`;
    await insertOrder(orderId, { expiresAt: new Date("2040-01-01T00:15:00Z") });
    await recordIntent(orderId);

    const foreign = await claimOrderPaymentInitialization(
      { orderId, clientId: "someone-else", now: new Date("2040-01-01T00:01:00Z") },
      database
    );
    const expired = await claimOrderPaymentInitialization(
      { orderId, clientId: `${PREFIX}client-${orderId}`, now: new Date("2040-01-01T00:16:00Z") },
      database
    );

    expect(foreign).toEqual({ claimed: false, reason: "not_found" });
    expect(expired).toEqual({ claimed: false, reason: "deadline_passed" });
    expect((await readSession(orderId))?.state).toBe("intent");
  });
});
