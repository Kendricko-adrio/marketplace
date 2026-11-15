import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@marketplace/db/src/schema";
import {
  claimDueOrderEmailJobs,
  finishOrderEmailAttempt,
  recordOrderCommunicationEvent,
  readOrderCommunicationState,
} from "@marketplace/db/src/order-communications/order-communication-repository";
import { materializeOrderCommunicationEffects } from "@marketplace/db/src/order-communications/order-communication-repository";
import type {
  OrderEmailContent,
  OrderEmailSendOutcome,
} from "@marketplace/db/src/order-communications/order-communication-contract";
import { sendDueOrderEmails } from "./send-order-emails-service";
import { projectOrderCommunications } from "./project-order-communications-service";

/**
 * Worker email order terhadap PostgreSQL sekali-pakai + sender palsu.
 *
 * Acceptance yang dibuktikan di sini: email baru dikirim setelah gate finansial,
 * tahap lama di-supersede oleh bukti terbaru, retry lima menit dengan maksimal
 * empat attempt, kegagalan definitif berhenti, kegagalan transport tidak
 * menyentuh status bisnis, dan order versi 0 tidak pernah mendapat efek.
 */
const url = process.env.DATABASE_URL;
const enabled =
  !!url &&
  /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(
    new URL(url).pathname.slice(1)
  );
if (url && !enabled) {
  throw new Error("Order communication tests refuse non-disposable databases");
}

const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool, { schema });
const anchor = new Date("2040-02-01T08:00:00Z");

afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cleanup(): Promise<void> {
  // Database ini disposable dan worker meng-claim job SECARA GLOBAL, jadi
  // seluruh isi antrean komunikasi dibersihkan sebelum setiap test; fixture
  // order/ledger memakai prefix 'ocw-'.
  await pool.query("DELETE FROM notification WHERE order_id LIKE 'ocw-%'");
  await pool.query("DELETE FROM order_email_job");
  await pool.query("DELETE FROM order_communication_event");
  await pool.query(
    "DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE 'ocw-%'"
  );
  await pool.query("DELETE FROM delivery_shipment WHERE order_id LIKE 'ocw-%'");
  await pool.query(
    "DELETE FROM jubelio_sales_operation WHERE order_id LIKE 'ocw-%'"
  );
  await pool.query("DELETE FROM orders WHERE id LIKE 'ocw-%'");
}

async function seedOrder(input: {
  id: string;
  version?: number;
  fulfillmentMethod?: "pickup" | "delivery";
  status?: string;
  paymentStatus?: string;
  blocked?: string | null;
  verifiedLedger?: boolean;
  pickupCode?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,pickup_code,fulfillment_blocked_reason,contact_phone,contact_email,subtotal,total,order_communication_version)
     VALUES ($1,'ocw-client','ocw-branch',$2,$3,$4,$5,$6,'0800000000','penerima@example.test','100000','111000',$7)`,
    [
      input.id,
      input.status ?? "processing",
      input.paymentStatus ?? "paid",
      input.fulfillmentMethod ?? "delivery",
      input.pickupCode ?? null,
      input.blocked ?? null,
      input.version ?? 1,
    ]
  );
  if (input.verifiedLedger ?? true) {
    await pool.query(
      `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
       VALUES (concat('ocw-create-',$1::text),$1,'create','confirmed',concat('ocw-create-ref-',$1::text),'{"type":"create"}'::jsonb,5001,null,null),
              (concat('ocw-invoice-',$1::text),$1,'invoice','confirmed',concat('ocw-invoice-ref-',$1::text),'{"type":"invoice"}'::jsonb,5001,6001,null),
              (concat('ocw-payment-',$1::text),$1,'payment','confirmed',concat('ocw-payment-ref-',$1::text),'{"type":"payment"}'::jsonb,5001,6001,7001)`,
      [input.id]
    );
  }
}

function fakeSender(outcome: OrderEmailSendOutcome = "accepted") {
  const calls: OrderEmailContent[] = [];
  const sender = async (content: OrderEmailContent) => {
    calls.push(content);
    return { outcome, code: outcome === "accepted" ? null : "SMTP_ETIMEDOUT" };
  };
  return { calls, sender };
}

describe.skipIf(!enabled)("sendDueOrderEmails (PostgreSQL + sender palsu)", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO client (id,name,email) VALUES ('ocw-client','Worker','ocw-client@example.test') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO branch (id,name,code,city,address) VALUES ('ocw-branch','Cabang Worker','OCW','Bandung','Jl. Asia Afrika 1') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO admin_role (id,name) VALUES ('ocw-role','Worker') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO "user" (id,name,username,display_username,email,email_verified,role_id,is_active)
       VALUES ('ocw-user','Worker','ocwuser','ocwuser','ocw-user@example.test',true,'ocw-role',true) ON CONFLICT (id) DO NOTHING`
    );
  });

  it("delivery ready hanya mengirim setelah gate finansial dan memakai URL storefront", async () => {
    await seedOrder({ id: "ocw-order-ready" });
    const projection = await projectOrderCommunications({
      limit: 5,
      orderId: "ocw-order-ready",
      now: anchor,
      database: db,
      mirror: false,
    });
    expect(projection.emailJobsCreated).toBe(1);
    expect(projection.notificationsCreated).toBe(1);

    const { calls, sender } = fakeSender("accepted");
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender,
      database: db,
    });
    expect(summary.claimed).toBe(1);
    expect(summary.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("penerima@example.test");
    expect(calls[0].subject).toContain("Pembayaran diterima — pesanan sedang disiapkan");
    expect(calls[0].html).toContain(
      "/account/orders/ocw-order-ready"
    );
    expect(calls[0].html).not.toContain("/admin/");
    const jobs = await pool.query(
      "SELECT status,attempt_count,sent_at FROM order_email_job WHERE order_id='ocw-order-ready'"
    );
    expect(jobs.rows[0].status).toBe("sent");
    expect(jobs.rows[0].attempt_count).toBe(1);
    expect(jobs.rows[0].sent_at).not.toBeNull();
  });

  it("tidak membuat email siap diproses saat financial gate belum terverifikasi", async () => {
    await seedOrder({ id: "ocw-order-unverified", verifiedLedger: false });
    const projection = await projectOrderCommunications({
      limit: 5,
      orderId: "ocw-order-unverified",
      now: anchor,
      database: db,
      mirror: false,
    });
    expect(projection.emailJobsCreated).toBe(0);
    const { calls, sender } = fakeSender();
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender,
      database: db,
    });
    expect(summary.claimed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("tahap yang sudah dilampaui di-supersede sebelum dispatch", async () => {
    await seedOrder({ id: "ocw-order-advance" });
    await pool.query(
      `INSERT INTO delivery_shipment (id,order_id,state,stored_request,packed_by,quote_rates,dispatched_by,dispatched_at,booked_by,booked_at,shipment_id,awb,booked_price,latest_status)
       VALUES ('ocw-shipment-advance','ocw-order-advance','booked','{"fixture":true}'::jsonb,'ocw-user','0','ocw-user','2040-02-01T07:00:00Z','ocw-user','2040-02-01T07:00:00Z',9201,'OCW-AWB-ADVANCE','20000','WAITING') ON CONFLICT (id) DO NOTHING`
    );
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-advance",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    // Bukti serah-terima datang sebelum worker sempat mengirim.
    await pool.query(
      `UPDATE delivery_shipment SET handed_over_by='ocw-user', handed_over_at='2040-02-01T08:00:00Z', latest_status='PICKED_UP' WHERE id='ocw-shipment-advance'`
    );
    const { calls, sender } = fakeSender();
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender,
      database: db,
    });
    expect(summary.superseded).toBe(1);
    expect(calls).toHaveLength(0);
    const jobs = await pool.query(
      "SELECT status FROM order_email_job WHERE order_id='ocw-order-advance'"
    );
    expect(jobs.rows[0].status).toBe("superseded");
  });

  it("kegagalan sementara menjadwalkan retry lima menit tanpa menyentuh status order", async () => {
    await seedOrder({ id: "ocw-order-retry" });
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-retry",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    const { sender } = fakeSender("temporary");
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender,
      database: db,
    });
    expect(summary.retry).toBe(1);
    const jobs = await pool.query(
      "SELECT status,attempt_count,next_attempt_at,error_code FROM order_email_job WHERE order_id='ocw-order-retry'"
    );
    expect(jobs.rows[0].status).toBe("retry");
    expect(jobs.rows[0].attempt_count).toBe(1);
    expect(jobs.rows[0].error_code).toBe("SMTP_ETIMEDOUT");
    expect(
      new Date(jobs.rows[0].next_attempt_at).getTime() - anchor.getTime()
    ).toBe(5 * 60_000);
    const order = await pool.query(
      "SELECT status,payment_status FROM orders WHERE id='ocw-order-retry'"
    );
    expect(order.rows[0]).toEqual({
      status: "processing",
      payment_status: "paid",
    });
    // Sebelum jeda lima menit, job tidak boleh diklaim lagi.
    const early = await claimDueOrderEmailJobs(db, {
      limit: 5,
      now: new Date(anchor.getTime() + 60_000),
    });
    expect(early).toHaveLength(0);
  });

  it("kegagalan definitif berhenti tanpa retry", async () => {
    await seedOrder({ id: "ocw-order-permanent" });
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-permanent",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    const { sender } = fakeSender("permanent");
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender,
      database: db,
    });
    expect(summary.failed).toBe(1);
    const claimed = await claimDueOrderEmailJobs(db, {
      limit: 5,
      now: new Date(anchor.getTime() + 60 * 60_000),
    });
    expect(claimed).toHaveLength(0);
  });

  it("sender yang melempar exception diperlakukan sebagai hasil tidak pasti dan tetap dibatasi", async () => {
    await seedOrder({ id: "ocw-order-throw" });
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-throw",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    const summary = await sendDueOrderEmails({
      limit: 5,
      now: anchor,
      sender: async () => {
        throw new Error("socket hang up");
      },
      database: db,
    });
    expect(summary.retry).toBe(1);
    const job = await pool.query(
      "SELECT status,error_code FROM order_email_job WHERE order_id='ocw-order-throw'"
    );
    expect(job.rows[0]).toEqual({
      status: "retry",
      error_code: "DISPATCH_EXCEPTION",
    });
  });

  it("order versi komunikasi 0 tidak pernah mendapat job atau email", async () => {
    await seedOrder({ id: "ocw-order-legacy", version: 0 });
    const projection = await projectOrderCommunications({
      limit: 5,
      orderId: "ocw-order-legacy",
      now: anchor,
      database: db,
      mirror: false,
      });
    expect(projection.emailJobsCreated).toBe(0);
    const state = await readOrderCommunicationState(db, "ocw-order-legacy");
    expect(state?.orderCommunicationVersion).toBe(0);
    const { calls, sender } = fakeSender();
    await sendDueOrderEmails({ limit: 5, now: anchor, sender, database: db });
    expect(calls).toHaveLength(0);
  });

  it("pickup tetap memakai isi email existing dan kode pengambilan tersimpan", async () => {
    await seedOrder({
      id: "ocw-order-pickup",
      fulfillmentMethod: "pickup",
      status: "ready_for_pickup",
      pickupCode: "ABC123",
    });
    const projection = await projectOrderCommunications({
      limit: 5,
      orderId: "ocw-order-pickup",
      now: anchor,
      database: db,
      mirror: false,
    });
    expect(projection.emailJobsCreated).toBe(1);
    const { calls, sender } = fakeSender();
    await sendDueOrderEmails({ limit: 5, now: anchor, sender, database: db });
    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toContain("Ready for Pickup");
    expect(calls[0].text).toContain("ABC123");
  });

  it("pembayaran gagal memakai email gagal existing", async () => {
    await seedOrder({
      id: "ocw-order-failed",
      fulfillmentMethod: "pickup",
      status: "failed_payment",
      paymentStatus: "failed",
      verifiedLedger: false,
    });
    await pool.query(
      `UPDATE orders SET payment_failure_reason='Payment expired' WHERE id='ocw-order-failed'`
    );
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-failed",
      kind: "payment_failed",
      source: "payment_failure",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });
    const { calls, sender } = fakeSender();
    await sendDueOrderEmails({ limit: 5, now: anchor, sender, database: db });
    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toContain("Pembayaran Gagal");
    expect(calls[0].text).toContain("Payment expired");
  });

  it("finish dengan claim token salah tidak menimpa claim baru", async () => {
    await seedOrder({ id: "ocw-order-token" });
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "ocw-order-token",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    const claimed = await claimDueOrderEmailJobs(db, { limit: 1, now: anchor });
    expect(
      await finishOrderEmailAttempt(db, {
        jobId: claimed[0].id,
        claimToken: "other-token",
        outcome: "accepted",
        now: anchor,
      })
    ).toBe(false);
  });
});
