import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import { failOrderWithEvidence } from "./fail-order-service";
import type { FailureEvidence } from "@/features/payments/payment-evidence";

// =========================================================
// TX-05 public seam on real PostgreSQL: the failure transition and its cancel
// obligation are ONE commit. A crash after that commit (dispatch throws) must
// leave a durable `intent` the recovery can finish; a replay must not create a
// second obligation or a second communication fact.
//
// Disposable database only (marketplace_discounts_test_*). A skip is NOT a pass.
// =========================================================

const url = process.env.DATABASE_URL;
const enabled =
  !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
const pool = new Pool({ connectionString: url, max: 2 });
afterAll(async () => {
  await pool.end();
});
const PREFIX = "tx01-fail-dbtest-";
const TEST_SO_ID = 987_123;
let connection: PoolClient;
let database: ReturnType<typeof drizzle<typeof schema>>;

const anchor = new Date("2040-01-01T00:00:00Z");

async function insertClient(orderId: string) {
  await connection.query(
    `insert into client (id, name, email, email_verified) values ($1,$2,$3,true)
     on conflict (id) do nothing`,
    [`${PREFIX}client-${orderId}`, "Failure DB Test", `${PREFIX}${orderId}@example.test`]
  );
}

async function insertOrder(
  orderId: string,
  overrides: {
    status?: string;
    paymentStatus?: string;
    salesOrderId?: number | null;
    orderCommunicationVersion?: number;
    total?: string;
  } = {}
) {
  await insertClient(orderId);
  await connection.query(
    `insert into orders (id, user_id, status, payment_status, contact_phone, contact_email,
                         subtotal, total, jubelio_sales_order_id, order_communication_version, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      orderId,
      `${PREFIX}client-${orderId}`,
      overrides.status ?? "pending_payment",
      overrides.paymentStatus ?? "pending",
      "0000000000",
      `${PREFIX}${orderId}@example.test`,
      overrides.total ?? "111000",
      overrides.total ?? "111000",
      overrides.salesOrderId ?? null,
      overrides.orderCommunicationVersion ?? 0,
      new Date("2040-01-01T00:15:00Z"),
    ]
  );
}

async function insertConfirmedCreate(orderId: string) {
  await connection.query(
    `insert into jubelio_sales_operation (id, order_id, type, status, reference, payload, sales_order_id, dispatched_at, confirmed_at)
     values ($1,$2,'create','confirmed',$3,$4::jsonb,$5, now(), now())`,
    [
      `${PREFIX}create-${orderId}`,
      orderId,
      `SO_CREATE:${orderId}`,
      JSON.stringify({
        type: "create",
        create: {
          contactId: -1,
          customerName: "Failure DB Test",
          locationId: 61,
          note: "fixture",
          items: [{ itemId: 1, quantity: 1, price: 111000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }],
        },
      }),
      TEST_SO_ID,
    ]
  );
}

async function insertActiveOperation(orderId: string, type: "invoice" | "payment") {
  await connection.query(
    `insert into jubelio_sales_operation (id, order_id, type, status, reference, payload, sales_order_id, invoice_id, dispatched_at)
     values ($1,$2,$3,'dispatched_unknown',$4,$5::jsonb,$6,$7, now())`,
    [
      `${PREFIX}${type}-${orderId}`,
      orderId,
      type,
      `SO_${type.toUpperCase()}:${orderId}`,
      JSON.stringify(
        type === "invoice"
          ? { type: "invoice", invoice: { salesOrderId: TEST_SO_ID } }
          : { type: "payment", payment: { invoiceId: 555, amount: 111000 } }
      ),
      TEST_SO_ID,
      type === "payment" ? 555 : null,
    ]
  );
}

function expiredEvidence(orderId: string, amount = "111000"): FailureEvidence {
  return { kind: "provider_expired", reference: orderId, amount, verifiedAt: anchor };
}

async function readOrder(orderId: string) {
  const result = await connection.query(
    `select status, payment_status, payment_failure_reason, midtrans_failure_status, fulfillment_blocked_reason
     from orders where id = $1`,
    [orderId]
  );
  return result.rows[0] as {
    status: string;
    payment_status: string;
    payment_failure_reason: string | null;
    midtrans_failure_status: string | null;
    fulfillment_blocked_reason: string | null;
  };
}

async function cancelOperations(orderId: string) {
  const result = await connection.query(
    `select status, reference, sales_order_id from jubelio_sales_operation where order_id = $1 and type = 'cancel'`,
    [orderId]
  );
  return result.rows as Array<{ status: string; reference: string; sales_order_id: number }>;
}

async function communicationFacts(orderId: string) {
  const result = await connection.query(
    `select kind from order_communication_event where order_id = $1 and kind = 'payment_failed'`,
    [orderId]
  );
  return result.rows as Array<{ kind: string }>;
}

describe.skipIf(!enabled)("fail order with durable cancel obligation (PostgreSQL)", () => {
  beforeAll(async () => {
    database = drizzle(pool, { schema });
    connection = await pool.connect();
  });

  afterAll(async () => {
    connection.release();
  });

  afterEach(async () => {
    await connection.query(`delete from order_communication_event where order_id like $1`, [
      `${PREFIX}%`,
    ]);
    await connection.query(`delete from jubelio_sales_operation where order_id like $1`, [
      `${PREFIX}%`,
    ]);
    await connection.query(`delete from orders where id like $1`, [`${PREFIX}%`]);
    await connection.query(`delete from client where id like $1`, [`${PREFIX}%`]);
  });

  it("commits failure status and the cancel obligation together, then finishes the cancel once", async () => {
    const orderId = `${PREFIX}order-a`;
    await insertOrder(orderId, { salesOrderId: TEST_SO_ID });
    await insertConfirmedCreate(orderId);

    const dispatched: string[] = [];
    const outcome = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      {
        database,
        now: new Date("2040-01-01T00:20:00Z"),
        dispatchCancel: async (input: { orderId: string; reason: string }) => {
          dispatched.push(input.orderId);
          return { status: "confirmed", salesOrderId: TEST_SO_ID };
        },
      }
    );

    expect(outcome).toMatchObject({ kind: "failed", cancelStatus: "confirmed" });
    expect(dispatched).toEqual([orderId]);
    const order = await readOrder(orderId);
    expect(order.status).toBe("failed_payment");
    expect(order.payment_status).toBe("failed");
    expect(order.payment_failure_reason).toBe(
      "Payment expired — order timed out (verified provider status)"
    );
    expect(order.midtrans_failure_status).toBe("expire");
    const cancels = await cancelOperations(orderId);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toMatchObject({ sales_order_id: TEST_SO_ID, reference: `SO_CANCEL:${orderId}` });
  });

  it("keeps the obligation durable when the cancel dispatch crashes after the commit", async () => {
    const orderId = `${PREFIX}order-crash`;
    await insertOrder(orderId, { salesOrderId: TEST_SO_ID });
    await insertConfirmedCreate(orderId);

    const outcome = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      {
        database,
        dispatchCancel: async () => {
          throw new Error("provider down");
        },
      }
    );

    expect(outcome).toMatchObject({ kind: "failed", cancelStatus: "in_flight" });
    expect((await readOrder(orderId)).status).toBe("failed_payment");
    // The never-claimed intent survives the crash: recovery owns the next POST.
    expect((await cancelOperations(orderId)).map((row) => row.status)).toEqual(["intent"]);
  });

  it("refuses expiry evidence for a different amount or another order", async () => {
    const orderId = `${PREFIX}order-amount`;
    await insertOrder(orderId, { salesOrderId: TEST_SO_ID });
    await insertConfirmedCreate(orderId);

    const wrongAmount = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId, "111001") },
      { database }
    );
    const wrongOrder = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(`${PREFIX}other`) },
      { database }
    );

    expect(wrongAmount).toEqual({ kind: "evidence_mismatch" });
    expect(wrongOrder).toEqual({ kind: "evidence_mismatch" });
    expect((await readOrder(orderId)).status).toBe("pending_payment");
    expect(await cancelOperations(orderId)).toHaveLength(0);
  });

  it("refuses to fail an order whose settlement operation is already active", async () => {
    const orderId = `${PREFIX}order-active`;
    await insertOrder(orderId, { salesOrderId: TEST_SO_ID });
    await insertConfirmedCreate(orderId);
    await insertActiveOperation(orderId, "invoice");

    const outcome = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      { database }
    );

    expect(outcome).toEqual({ kind: "payment_active" });
    expect((await readOrder(orderId)).status).toBe("pending_payment");
    expect(await cancelOperations(orderId)).toHaveLength(0);
  });

  it("replays without a second cancel obligation or a second failure communication fact", async () => {
    const orderId = `${PREFIX}order-replay`;
    await insertOrder(orderId, { salesOrderId: TEST_SO_ID, orderCommunicationVersion: 1 });
    await insertConfirmedCreate(orderId);

    const first = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      {
        database,
        dispatchCancel: async () => ({ status: "confirmed", salesOrderId: TEST_SO_ID }),
      }
    );
    const second = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      { database }
    );

    expect(first.kind).toBe("failed");
    expect(second).toEqual({ kind: "not_eligible", status: "failed_payment" });
    expect(await cancelOperations(orderId)).toHaveLength(1);
    expect(await communicationFacts(orderId)).toHaveLength(1);
  });

  it("never fails an order that already holds an authoritative paid claim", async () => {
    const orderId = `${PREFIX}order-paid`;
    await insertOrder(orderId, { status: "processing", paymentStatus: "paid", salesOrderId: TEST_SO_ID });

    const outcome = await failOrderWithEvidence(
      { orderId, evidence: expiredEvidence(orderId) },
      { database }
    );

    expect(outcome).toEqual({ kind: "already_paid" });
    expect((await readOrder(orderId)).status).toBe("processing");
  });
});
