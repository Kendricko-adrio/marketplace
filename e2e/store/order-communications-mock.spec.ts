/**
 * Spec penyelarasan status/notifikasi/email — sisi store: cron komunikasi
 * memproyeksikan fakta committed lalu mengisi antrean email durable.
 *
 * Mock-only (isolated origins + disposable DB, provider loopback). SMTP sengaja
 * tidak dikonfigurasi pada run ini (`SMTP_USER` kosong), jadi yang dibuktikan
 * adalah KONTRAK ANTREAN dan batas keamanan endpoint — bukan pengiriman nyata:
 *   (1) endpoint menolak secret hilang/salah dan menerima secret yang benar,
 *   (2) delivery siap diproses menghasilkan tepat satu fakta, satu job email,
 *       satu notifikasi `Order dibayar — siap diproses`, dan replay tidak
 *       menduplikasi,
 *   (3) order versi komunikasi 0 tidak pernah mendapat efek,
 *   (4) bukti DELIVERED valid setelah penutupan manual menghasilkan tepat satu
 *       job "sudah sampai" tanpa membuka order atau menghapus alasan manual.
 */
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
// Fixture test-only; nilainya disuntikkan oleh playwright.mock.config.ts ke
// proses server store (bukan kredensial nyata).
const CRON_SECRET = "checkout02-cron-fixture-only";

const PREFIX = "e2ecomms";
const CLIENT_ID = `${PREFIX}-client`;
const BRANCH_ID = `${PREFIX}-branch`;
const READY_ORDER = `${PREFIX}-order-ready`;
const LEGACY_ORDER = `${PREFIX}-order-legacy`;
const LATE_PROOF_ORDER = `${PREFIX}-order-late`;

let pool: Pool;

const ORDER_URL = `${STORE_BASE_URL}/api/cron/process-order-communications`;

async function callCron(secret?: string) {
  return fetch(ORDER_URL, {
    method: "POST",
    headers: secret ? { "X-Cron-Secret": secret } : {},
  });
}

async function countRows(sql: string, params: unknown[] = []) {
  const result = await pool.query<{ count: number }>(sql, params);
  return result.rows[0]?.count ?? 0;
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DELETE FROM notification WHERE order_id LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM order_email_job WHERE order_id LIKE '${PREFIX}-%'`);
  await pool.query(
    `DELETE FROM order_communication_event WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM delivery_shipment WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}-%'`);
  await pool.query("DELETE FROM admin_role_grant WHERE role_id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);

  await pool.query(
    `INSERT INTO client (id,name,email,email_verified,phone,onboarding_completed)
     VALUES ($1,'Comms Mock Client','comms-mock@example.test',true,'+6281200000001',true)`,
    [CLIENT_ID]
  );
  await pool.query(
    `INSERT INTO branch (id,name,code,city,address,status,shipping_phone,shipping_address,shipping_postal_code,shipping_area_id,jubelio_location_id)
     VALUES ($1,'Cabang Comms','E2ECOMMS','Bandung','Jl. Comms 1','aktif','0221','Jl. Comms 1','40111','01010101',920001)`,
    [BRANCH_ID]
  );

  // (2) delivery siap diproses + ledger terverifikasi.
  await pool.query(
    `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,contact_phone,contact_email,subtotal,total,order_communication_version)
     VALUES ($1,$2,$3,'processing','paid','delivery','0800000000','comms-ready@example.test','100000','111000',1)`,
    [READY_ORDER, CLIENT_ID, BRANCH_ID]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
     VALUES ($1,$2,'create','confirmed',$1,'{"type":"create"}'::jsonb,8101,null,null),
            ($3,$2,'invoice','confirmed',$3,'{"type":"invoice"}'::jsonb,8101,8201,null),
            ($4,$2,'payment','confirmed',$4,'{"type":"payment"}'::jsonb,8101,8201,8301)`,
    [
      `${READY_ORDER}-create`,
      READY_ORDER,
      `${READY_ORDER}-invoice`,
      `${READY_ORDER}-payment`,
    ]
  );

  // (3) order lama (marker 0) dengan bentuk keadaan yang sama.
  await pool.query(
    `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,contact_phone,contact_email,subtotal,total,order_communication_version)
     VALUES ($1,$2,$3,'processing','paid','delivery','0800000000','comms-legacy@example.test','100000','111000',0)`,
    [LEGACY_ORDER, CLIENT_ID, BRANCH_ID]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
     VALUES ($1,$2,'create','confirmed',$1,'{"type":"create"}'::jsonb,8102,null,null),
            ($3,$2,'invoice','confirmed',$3,'{"type":"invoice"}'::jsonb,8102,8202,null),
            ($4,$2,'payment','confirmed',$4,'{"type":"payment"}'::jsonb,8102,8202,8302)`,
    [
      `${LEGACY_ORDER}-create`,
      LEGACY_ORDER,
      `${LEGACY_ORDER}-invoice`,
      `${LEGACY_ORDER}-payment`,
    ]
  );

  // (4) penutupan manual + bukti DELIVERED terlambat.
  await pool.query(
    `INSERT INTO admin_role (id,name) VALUES ($1,'E2E Comms Actor') ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}-role`]
  );
  await pool.query(
    `INSERT INTO "user" (id,name,username,display_username,email,email_verified,role_id,is_active)
     VALUES ($1,'Comms Admin','commsadmin','commsadmin','commsadmin@example.test',true,$2,true)
     ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}-user`, `${PREFIX}-role`]
  );
  await pool.query(
    `INSERT INTO orders (id,user_id,branch_id,status,payment_status,fulfillment_method,pickup_code,contact_phone,contact_email,subtotal,total,order_communication_version,delivery_manual_reason,delivery_manual_at,delivery_manual_by)
     VALUES ($1,$2,$3,'completed','paid','delivery',null,'0800000000','comms-late@example.test','100000','111000',1,'Kurir tidak dapat menjangkau alamat',now(),$4)`,
    [LATE_PROOF_ORDER, CLIENT_ID, BRANCH_ID, `${PREFIX}-user`]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id,order_id,type,status,reference,payload,sales_order_id,invoice_id,payment_id)
     VALUES ($1,$2,'create','confirmed',$1,'{"type":"create"}'::jsonb,8103,null,null),
            ($3,$2,'invoice','confirmed',$3,'{"type":"invoice"}'::jsonb,8103,8203,null),
            ($4,$2,'payment','confirmed',$4,'{"type":"payment"}'::jsonb,8103,8203,8303)`,
    [
      `${LATE_PROOF_ORDER}-create`,
      LATE_PROOF_ORDER,
      `${LATE_PROOF_ORDER}-invoice`,
      `${LATE_PROOF_ORDER}-payment`,
    ]
  );
  await pool.query(
    `INSERT INTO delivery_shipment (id,order_id,state,stored_request,packed_by,quote_rates,dispatched_by,dispatched_at,booked_by,booked_at,shipment_id,awb,booked_price,delivered_at,latest_status)
     VALUES ($1,$2,'booked','{"ref_no":"comms"}'::jsonb,$3,'20000',$3,now(),$3,now(),9301,'E2ECOMMSAWB','20000',now(),'DELIVERED')`,
    [`${LATE_PROOF_ORDER}-shipment`, LATE_PROOF_ORDER, `${PREFIX}-user`]
  );
});

test.afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM notification WHERE order_id LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM order_email_job WHERE order_id LIKE '${PREFIX}-%'`);
  await pool.query(
    `DELETE FROM order_communication_event WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_channel_status_intent WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM delivery_shipment WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(
    `DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}-%'`
  );
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}-%'`);
  await pool.query('DELETE FROM "user" WHERE id LIKE $1', [`${PREFIX}-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.end();
});

test.describe.configure({ mode: "serial" });

test("menolak secret hilang/salah dan menerima secret benar tanpa membocorkan data", async () => {
  expect((await callCron()).status).toBe(401);
  expect((await callCron("wrong-secret")).status).toBe(401);

  const ok = await callCron(CRON_SECRET);
  expect(ok.status).toBe(200);
  const body = await ok.json();
  expect(body.success).toBe(true);
  expect(body.limit).toBeLessThanOrEqual(50);
  for (const key of [
    "projected",
    "emailJobsCreated",
    "notificationsCreated",
    "claimed",
    "sent",
    "retry",
    "failed",
    "superseded",
  ]) {
    expect(typeof body[key]).toBe("number");
  }
  // Tidak ada PII/konten email di respons.
  expect(JSON.stringify(body)).not.toContain("@example.test");
});

test("delivery siap diproses menghasilkan satu fakta, satu job, satu notifikasi — replay tidak menduplikasi", async () => {
  const events = await countRows(
    "SELECT count(*)::int AS count FROM order_communication_event WHERE order_id=$1",
    [READY_ORDER]
  );
  expect(events).toBe(1);
  const jobs = await pool.query<{ kind: string; status: string }>(
    "SELECT kind,status FROM order_email_job WHERE order_id=$1",
    [READY_ORDER]
  );
  expect(jobs.rows).toHaveLength(1);
  expect(jobs.rows[0].kind).toBe("delivery_ready");
  // SMTP tidak dikonfigurasi pada run mock: attempt tercatat dan job tidak
  // pernah dianggap terkirim.
  expect(jobs.rows[0].status).not.toBe("sent");
  const notifications = await pool.query<{ title: string; message: string }>(
    "SELECT title,message FROM notification WHERE order_id=$1",
    [READY_ORDER]
  );
  expect(notifications.rows).toHaveLength(1);
  expect(notifications.rows[0].title).toBe("Order dibayar — siap diproses");
  expect(notifications.rows[0].message).toBe(
    "Order #E2ECOMMS sudah dibayar dan siap disiapkan untuk pengiriman."
  );

  // Replay cron: tidak ada fakta/job/notifikasi kedua.
  const replay = await callCron(CRON_SECRET);
  expect(replay.status).toBe(200);
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM order_communication_event WHERE order_id=$1",
      [READY_ORDER]
    )
  ).toBe(1);
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM order_email_job WHERE order_id=$1",
      [READY_ORDER]
    )
  ).toBe(1);
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM notification WHERE order_id=$1",
      [READY_ORDER]
    )
  ).toBe(1);
});

test("order versi komunikasi 0 tidak pernah mendapat fakta, job, atau notifikasi", async () => {
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM order_communication_event WHERE order_id=$1",
      [LEGACY_ORDER]
    )
  ).toBe(0);
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM order_email_job WHERE order_id=$1",
      [LEGACY_ORDER]
    )
  ).toBe(0);
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM notification WHERE order_id=$1",
      [LEGACY_ORDER]
    )
  ).toBe(0);
});

test("bukti DELIVERED setelah penutupan manual menghasilkan satu email sudah sampai tanpa membuka order", async () => {
  const jobs = await pool.query<{ kind: string }>(
    "SELECT kind FROM order_email_job WHERE order_id=$1 ORDER BY kind",
    [LATE_PROOF_ORDER]
  );
  expect(jobs.rows.map((row) => row.kind)).toEqual(["delivery_delivered"]);
  const state = await pool.query<{
    status: string;
    delivery_manual_reason: string | null;
  }>(
    "SELECT status,delivery_manual_reason FROM orders WHERE id=$1",
    [LATE_PROOF_ORDER]
  );
  expect(state.rows[0].status).toBe("completed");
  expect(state.rows[0].delivery_manual_reason).toBe(
    "Kurir tidak dapat menjangkau alamat"
  );
  // Email siap diproses/sedang diantar tidak pernah dibuat untuk order ini.
  expect(
    await countRows(
      "SELECT count(*)::int AS count FROM notification WHERE order_id=$1",
      [LATE_PROOF_ORDER]
    )
  ).toBe(0);
});
