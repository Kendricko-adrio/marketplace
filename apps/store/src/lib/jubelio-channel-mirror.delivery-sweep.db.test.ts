import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@marketplace/db/src/schema";
import {
  reconcileChannelStatusMirrorForSweep,
  reconcileJubelioChannelStatusForOrder,
} from "./jubelio-channel-mirror";

/**
 * AC04 (spec penyelarasan status/notifikasi/email): sweep harus MENEMUKAN
 * delivery baru yang kehilangan fast trigger dan menerapkan target yang sama
 * (`Siap Proses`), dengan SQL window yang selaras dengan derivasi per-order.
 *
 * Real PostgreSQL (disposable) + gateway palsu: tidak ada provider call nyata.
 * Urutan yang dibuktikan: sweep memindai delivery processing/paid unblocked
 * dengan ledger terverifikasi, membuat intent `Siap Proses` (satu-satunya
 * dispatch), lalu menolak edit karena kontrak uang tersimpan tidak lengkap —
 * nol provider read/write, bukan kegagalan bisnis.
 */
const url = process.env.DATABASE_URL;
const enabled =
  !!url &&
  /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(
    new URL(url).pathname.slice(1)
  );
if (url && !enabled) {
  console.warn(
    "[jubelio-channel-mirror.delivery-sweep.db] SKIP — DATABASE_URL bukan database disposable marketplace_discounts_test_*; verifikasi wajib dijalankan dengan database disposable"
  );
}

const PREFIX = "ocmirror";
const ORDER_ID = `${PREFIX}-order-delivery`;
const POOL_ORDER_ID = `${PREFIX}-order-pickup`;
const pool = new Pool({ connectionString: url, max: 3 });
const db = drizzle(pool, { schema });

beforeAll(async () => {
  await pool.query("SELECT 1");
});

async function cleanup(): Promise<void> {
  await pool.query(
    "DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE 'ocmirror-%'"
  );
  await pool.query(
    "DELETE FROM jubelio_sales_operation WHERE order_id LIKE 'ocmirror-%'"
  );
  await pool.query("DELETE FROM orders WHERE id LIKE 'ocmirror-%'");
}

beforeEach(async () => {
  await cleanup();
  await pool.query(
    `INSERT INTO client (id,name,email) VALUES ($1,'Mirror','mirror@example.test') ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}-client`]
  );
  await pool.query(
    `INSERT INTO branch (id,name,code,city,address) VALUES ($1,'Cabang Mirror','OCM','Bandung','Jl. M 1') ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}-branch`]
  );
  const fixtures: Array<[string, "pickup" | "delivery", string]> = [
    [ORDER_ID, "delivery", "processing"],
    [POOL_ORDER_ID, "delivery", "ready_for_pickup"],
  ];
  for (const [orderId, method, status] of fixtures) {
    await pool.query(
      `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,pickup_code,contact_phone,contact_email,subtotal,total,order_communication_version)
       VALUES ($1,$2,$3,$4,'paid',$5,$6,'0800000000','mirror@example.test','100000','111000',1)`,
      [
        orderId,
        `${PREFIX}-client`,
        `${PREFIX}-branch`,
        status,
        method,
        method === "pickup" ? "MIR999" : null,
      ]
    );
    await pool.query(
      `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
       VALUES (concat($1::text,'-create'),$1,'create','confirmed',concat($1::text,'-cr'),'{"type":"create"}'::jsonb,5901,null,null),
              (concat($1::text,'-invoice'),$1,'invoice','confirmed',concat($1::text,'-iv'),'{"type":"invoice"}'::jsonb,5901,5902,null),
              (concat($1::text,'-payment'),$1,'payment','confirmed',concat($1::text,'-pm'),'{"type":"payment"}'::jsonb,5901,5902,5903)`,
      [orderId]
    );
  }
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe.skipIf(!enabled)("delivery Siap Proses sweep window (PostgreSQL)", () => {
  it("sweep menemukan delivery processing/paid yang belum punya intent dan menargetkan Siap Proses", async () => {
    const summary = await reconcileChannelStatusMirrorForSweep(db, { limit: 50 });
    expect(summary.missedOrdersScanned).toBeGreaterThanOrEqual(1);

    const intents = await pool.query<{
      order_id: string;
      target_status: string;
      status: string;
    }>(
      "SELECT order_id, target_status, status FROM jubelio_channel_status_intent WHERE order_id LIKE 'ocmirror-%' ORDER BY order_id"
    );
    expect(intents.rows).toEqual([
      {
        order_id: ORDER_ID,
        target_status: "Siap Proses",
        // Kontrak uang tersimpan tidak lengkap pada fixture → fail-closed
        // menjadi investigation, nol provider read/write.
        status: "needs_investigation",
      },
      {
        order_id: POOL_ORDER_ID,
        target_status: "Siap Proses",
        status: "needs_investigation",
      },
    ]);
  });

  it("delivery yang blocked tidak pernah masuk window Siap Proses", async () => {
    await pool.query(
      `UPDATE orders SET fulfillment_blocked_reason='Sales-Order payment is unverified' WHERE id=$1`,
      [ORDER_ID]
    );
    await reconcileChannelStatusMirrorForSweep(db, { limit: 50 });
    const intent = await pool.query<{ target_status: string }>(
      "SELECT target_status FROM jubelio_channel_status_intent WHERE order_id=$1",
      [ORDER_ID]
    );
    // Blocked = `Menunggu Verifikasi`, bukan Siap Proses.
    expect(intent.rows.map((row) => row.target_status)).toEqual([
      "Menunggu Verifikasi",
    ]);
  });

  it("per-order seam memakai derivasi yang sama dengan sweep (Siap Proses, bukan ready_for_pickup)", async () => {
    const outcome = await reconcileJubelioChannelStatusForOrder(db, {
      orderId: ORDER_ID,
    });
    expect(outcome.status).toBe("needs_investigation");
    const order = await pool.query<{ status: string; pickup_code: string | null }>(
      "SELECT status,pickup_code FROM orders WHERE id=$1",
      [ORDER_ID]
    );
    // Delivery tidak pernah dipaksa menjadi ready_for_pickup dan tidak
    // mendapat pickup code.
    expect(order.rows[0]).toEqual({ status: "processing", pickup_code: null });
  });
});
