import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import {
  claimDueOrderEmailJobs,
  finishOrderEmailAttempt,
  listProjectableOrderCommunications,
  materializeOrderCommunicationEffects,
  readOrderCommunicationState,
  recordOrderCommunicationEvent,
} from "./order-communication-repository";

/**
 * Repository `order-communications` terhadap PostgreSQL sekali-pakai.
 *
 * Constraint unik, transaksi, dan concurrency hanya bisa dibuktikan di DB.
 * DB disposable dijaga: nama database WAJIB berawalan
 * `marketplace_discounts_test_`.
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
afterAll(async () => {
  await pool.end();
});
const anchor = new Date("2040-01-01T00:00:00Z");

// CATATAN: fixture TIDAK memakai transaksi-luar + ROLLBACK karena repository
// memakai transaksi sendiri (claim atomik). Rollback luar akan di-commit oleh
// transaksi dalam, jadi baris justru tertinggal. Database ini disposable dan
// setiap test membersihkan prefix miliknya sendiri.
function database() {
  return drizzle(pool, { schema });
}

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM notification WHERE order_id LIKE 'oc-order-%'");
  await pool.query("DELETE FROM order_email_job WHERE order_id LIKE 'oc-order-%'");
  await pool.query(
    "DELETE FROM order_communication_event WHERE order_id LIKE 'oc-order-%'"
  );
  await pool.query("DELETE FROM delivery_tracking_event WHERE ref_no LIKE 'oc-order-%'");
  await pool.query("DELETE FROM delivery_shipment WHERE order_id LIKE 'oc-order-%'");
  await pool.query(
    "DELETE FROM jubelio_sales_operation WHERE order_id LIKE 'oc-order-%'"
  );
  await pool.query("DELETE FROM orders WHERE id LIKE 'oc-order-%'");
}

async function seedOrder(input: {
  id: string;
  version?: number;
  fulfillmentMethod?: "pickup" | "delivery";
  status?: string;
  paymentStatus?: string;
  pickupCode?: string | null;
  verifiedLedger?: boolean;
}) {
  const version = input.version ?? 1;
  await pool.query(
    `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,pickup_code,contact_phone,contact_email,subtotal,total,order_communication_version)
     VALUES ($1,'oc-fixture-client','oc-fixture-branch',$2,$3,$4,$5,'0800000000','oc@example.test','100000','111000',$6)`,
    [
      input.id,
      input.status ?? "processing",
      input.paymentStatus ?? "paid",
      input.fulfillmentMethod ?? "delivery",
      input.pickupCode ?? null,
      version,
    ]
  );
  if (input.verifiedLedger ?? true) {
    await pool.query(
      `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
       VALUES ($1,$2,'create','confirmed',concat('oc-create-',$2::text),$3::jsonb,5001,null,null),
              ($4,$2,'invoice','confirmed',concat('oc-invoice-',$2::text),$3::jsonb,5001,6001,null),
              ($5,$2,'payment','confirmed',concat('oc-payment-',$2::text),$3::jsonb,5001,6001,7001)`,
      [
        `oc-create-${input.id}`,
        input.id,
        JSON.stringify({ type: "create" }),
        `oc-invoice-${input.id}`,
        `oc-payment-${input.id}`,
      ]
    );
  }
}

describe.skipIf(!enabled)("order communication repository (PostgreSQL)", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO client (id,name,email) VALUES ('oc-fixture-client','Komunikasi','oc-client@example.test') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO branch (id,name,code,city,address) VALUES ('oc-fixture-branch','Komunikasi','OC-FIXTURE','Kota','Alamat') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO admin_role (id,name) VALUES ('oc-fixture-role','Komunikasi') ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO "user" (id,name,username,display_username,email,email_verified,role_id,is_active)
       VALUES ('oc-fixture-user','Komunikasi','ocuser','ocuser','oc-user@example.test',true,'oc-fixture-role',true)
       ON CONFLICT (id) DO NOTHING`
    );
  });
  afterAll(async () => {
    await cleanup();
  });

  it("records one fact per (order, kind) and never overwrites the checkpoint", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-dedupe" });
    const first = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-dedupe",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    expect(first.created).toBe(true);
    await materializeOrderCommunicationEffects(db, {
      eventId: first.eventId,
      now: anchor,
    });
    const replay = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-dedupe",
      kind: "delivery_ready",
      source: "sweep",
      occurredAt: null,
      receivedAt: new Date(anchor.getTime() + 60_000),
    });
    expect(replay.created).toBe(false);
    expect(replay.eventId).toBe(first.eventId);
    const rows = await pool.query(
      "SELECT source, email_job_created_at FROM order_communication_event WHERE order_id='oc-order-dedupe'"
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].source).toBe("settlement");
    expect(rows.rows[0].email_job_created_at).not.toBeNull();
  });

  it("materializes one email job + one notification for delivery_ready, and deleting the notification does not recreate it", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-ready" });
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-ready",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    const produced = await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });
    expect(produced).toEqual({
      emailJobCreated: true,
      notificationCreated: true,
    });
    const replay = await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: new Date(anchor.getTime() + 60_000),
    });
    expect(replay).toEqual({
      emailJobCreated: false,
      notificationCreated: false,
    });
    const notifications = await pool.query(
      "SELECT id,title,message FROM notification WHERE order_id='oc-order-ready'"
    );
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0].title).toBe("Order dibayar — siap diproses");
    expect(notifications.rows[0].message).toBe(
      "Order #OC-ORDER sudah dibayar dan siap disiapkan untuk pengiriman."
    );
    const jobs = await pool.query(
      "SELECT kind,status,attempt_count FROM order_email_job WHERE order_id='oc-order-ready'"
    );
    expect(jobs.rows).toEqual([
      { kind: "delivery_ready", status: "pending", attempt_count: 0 },
    ]);

    // Admin menghapus notifikasi: jejak produksi (checkpoint) tetap ada.
    await pool.query(
      "DELETE FROM notification WHERE order_id='oc-order-ready'"
    );
    const replayed = await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: new Date(anchor.getTime() + 120_000),
    });
    expect(replayed.notificationCreated).toBe(false);
    const after = await pool.query(
      "SELECT count(*)::int AS count FROM notification WHERE order_id='oc-order-ready'"
    );
    expect(after.rows[0].count).toBe(0);
  });

  it("does not produce effects for communication-version-0 orders", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-legacy", version: 0 });
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-legacy",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    const produced = await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });
    expect(produced.emailJobCreated).toBe(false);
    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM order_email_job WHERE order_id='oc-order-legacy'"
    );
    expect(rows.rows[0].count).toBe(0);
    const projectable = await listProjectableOrderCommunications(db, {
      limit: 10,
      now: anchor,
    });
    expect(projectable.map((state) => state.orderId)).not.toContain(
      "oc-order-legacy"
    );
  });

  it("claims with a lease, records the attempt before dispatch, and refuses a stale claim token", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-claim" });
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-claim",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });

    const claimed = await claimDueOrderEmailJobs(db, {
      limit: 5,
      now: anchor,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attemptCount).toBe(1);
    const second = await claimDueOrderEmailJobs(db, { limit: 5, now: anchor });
    expect(second).toHaveLength(0);

    const staleFinished = await finishOrderEmailAttempt(db, {
      jobId: claimed[0].id,
      claimToken: "not-the-claim",
      outcome: "accepted",
      now: anchor,
    });
    expect(staleFinished).toBe(false);

    const finished = await finishOrderEmailAttempt(db, {
      jobId: claimed[0].id,
      claimToken: claimed[0].claimToken,
      outcome: "accepted",
      now: anchor,
    });
    expect(finished).toBe(true);
    const row = await pool.query(
      "SELECT status,attempt_count,sent_at FROM order_email_job WHERE id=$1",
      [claimed[0].id]
    );
    expect(row.rows[0]).toMatchObject({ status: "sent", attempt_count: 1 });
    expect(row.rows[0].sent_at).not.toBeNull();
  });

  it("re-claims an expired lease in the remaining attempt budget, never resetting it", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-lease" });
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-lease",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });
    const first = await claimDueOrderEmailJobs(db, { limit: 5, now: anchor });
    expect(first[0].attemptCount).toBe(1);
    // Lease belum kedaluwarsa: tidak boleh di-claim lagi.
    expect(
      await claimDueOrderEmailJobs(db, {
        limit: 5,
        now: new Date(anchor.getTime() + 60_000),
      })
    ).toHaveLength(0);
    const reclaimed = await claimDueOrderEmailJobs(db, {
      limit: 5,
      now: new Date(anchor.getTime() + 6 * 60_000),
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attemptCount).toBe(2);
  });

  it("stops at four attempts and never schedules more retries", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-retry" });
    const event = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-retry",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: event.eventId,
      now: anchor,
    });
    let clock = anchor;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const claimed = await claimDueOrderEmailJobs(db, { limit: 5, now: clock });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].attemptCount).toBe(attempt);
      await finishOrderEmailAttempt(db, {
        jobId: claimed[0].id,
        claimToken: claimed[0].claimToken,
        outcome: "temporary",
        errorCode: "SMTP_ECONNECTION",
        now: clock,
      });
      const row = await pool.query(
        "SELECT status,next_attempt_at FROM order_email_job WHERE id=$1",
        [claimed[0].id]
      );
      expect(row.rows[0].status).toBe(attempt === 4 ? "failed" : "retry");
      if (attempt < 4) {
        // Retry tidak lebih awal dari lima menit setelah kegagalan.
        const nextAt = new Date(row.rows[0].next_attempt_at).getTime();
        expect(nextAt - clock.getTime()).toBe(5 * 60_000);
      }
      clock = new Date(clock.getTime() + 5 * 60_000);
    }
    const later = await claimDueOrderEmailJobs(db, {
      limit: 5,
      now: new Date(clock.getTime() + 60 * 60_000),
    });
    expect(later).toHaveLength(0);
  });

  it("supersedes a stale stage and never creates a second job for the same order", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-supersede" });
    await pool.query(
      `INSERT INTO delivery_shipment (id,order_id,state,stored_request,packed_by,quote_rates,dispatched_by,dispatched_at,booked_by,booked_at,shipment_id,awb,booked_price,handed_over_by,handed_over_at,latest_status)
       VALUES ('oc-shipment-supersede','oc-order-supersede','booked','{"fixture":true}'::jsonb,'oc-fixture-user','0','oc-fixture-user','2040-01-01T00:00:00Z','oc-fixture-user','2040-01-01T00:00:00Z',9001,'OC-AWB-FIXTURE','20000',null,null,'WAITING')`
    );
    const ready = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-supersede",
      kind: "delivery_ready",
      source: "settlement",
      occurredAt: null,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: ready.eventId,
      now: anchor,
    });
    // Bukti lebih baru sudah committed sebelum worker sempat mengirim.
    await pool.query(
      `UPDATE delivery_shipment SET handed_over_by='oc-fixture-user', handed_over_at='2040-01-01T00:00:00Z', latest_status='PICKED_UP' WHERE id='oc-shipment-supersede'`
    );
    const inTransit = await recordOrderCommunicationEvent(db, {
      orderId: "oc-order-supersede",
      kind: "delivery_in_transit",
      source: "carrier_handoff",
      occurredAt: anchor,
      receivedAt: anchor,
    });
    await materializeOrderCommunicationEffects(db, {
      eventId: inTransit.eventId,
      now: anchor,
    });
    const state = await readOrderCommunicationState(db, "oc-order-supersede");
    expect(state?.stage.inTransit).toBe(true);
    expect(state?.emailJobs.map((job) => job.kind).sort()).toEqual([
      "delivery_in_transit",
      "delivery_ready",
    ]);
    const jobs = await pool.query(
      "SELECT kind FROM order_email_job WHERE order_id='oc-order-supersede' ORDER BY kind"
    );
    expect(
      (jobs.rows as Array<{ kind: string }>)
        .map((row) => row.kind)
        .sort()
    ).toEqual(["delivery_in_transit", "delivery_ready"]);
    expect(jobs.rows).toHaveLength(2);
  });

  it("keeps the authoritative state honest about manual close vs delivered proof", async () => {
    const db = database();
    await seedOrder({ id: "oc-order-manual", status: "completed" });
    await pool.query(
      `UPDATE orders SET delivery_manual_reason='Barang tidak dapat dikirim', delivery_manual_at=now(), delivery_manual_by='oc-fixture-user' WHERE id='oc-order-manual'`
    );
    const state = await readOrderCommunicationState(db, "oc-order-manual");
    expect(state?.stage.closedManually).toBe(true);
    expect(state?.stage.delivered).toBe(false);
  });
});
