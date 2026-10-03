import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import * as schema from "@marketplace/db/src/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createShipmentFulfillment } from "./shipment-fulfillment";

// =========================================================
// shipment-fulfillment — packing + booking Jubelio Shipment on the REAL
// PostgreSQL (ticket 05, spec Ready "Booking, otorisasi, ledger biaya").
//
// PUBLIC SEAM (proposed; implemented in ./shipment-fulfillment):
//   createShipmentFulfillment(db, gateway) with
//     pack(orderId, actor) — persists the packed intent + the STORED request
//       built from the ORDER delivery_snapshot;
//     book(orderId, actor) — atomically claims the dispatch once, POSTs the
//       stored request, persists the AWB + THREE costs and audits a mismatch.
//     actor {id, homeBranchId, canEditOrders} — orders:edit AND
//     Home Branch == the order branch for EVERY action, including an
//     all-branch owner (all-branch VISIBILITY is never a bypass).
//   gateway.createShipment(request) → {shipment_id, awb, tracking_url?,
//   price, price_bill?} — the ONE external boundary (mocked here, real PG
//   everywhere else).
//
// Contract under test (4 DB cases):
// 1. Eligibility fails BEFORE any provider POST for: unpaid, expired, pickup,
//    paid-but-blocked (unverified settlement), ledger-unverified, an unknown
//    id, no-edit actors, and wrong-Home-Branch actors. The snapshot's parcel
//    (item value/qty/grams/cm) fails closed.
// 2. pack then PARALLEL book claims across SEPARATE service instances POST
//    exactly once — an await-signal latch (no sleep polling) — and the
//    winner persists the AWB with THREE DISTINCT costs (quote rates 20000 /
//    booking 25000 / billed 30000), the mismatch audited but not blocking.
// 3. A thrown/timeout AFTER the dispatch lands a DURABLE booking_unknown; a
//    repeated book can never POST again.
// 4. The stored create request uses the ORIGINAL snapshot receiver/origin/
//    parcel/service — never the current address book/branch/master/config —
//    is_cod false, no insurance, NO invented package_detail/carton;
//    ref_no = orderId as a correlation (no idempotency assumption).
//
// RED mechanics: `./shipment-fulfillment` does not exist yet (load error) and
// the `delivery_shipment` table is main's migration stage — both are the
// expected red. Requires PostgreSQL (DATABASE_URL); unreachable → skip
// (skip ≠ pass). Fixture rows use the "shipfulf-dbtest-" prefix; seeded data
// is never reset.
// =========================================================

const PREFIX = "shipfulf-dbtest-";
const ORDER_HAPPY = `${PREFIX}order-happy`;
const ORDER_UNKNOWN = `${PREFIX}order-unknown`;
const BRANCH_A_ID = `${PREFIX}branch-a`;
const BRANCH_B_ID = `${PREFIX}branch-b`;
const ROLE_EDIT_ID = `${PREFIX}role-edit`;
const ROLE_VIEW_ID = `${PREFIX}role-view`;
const USER_HOME_ID = `${PREFIX}user-home`;
const USER_WRONG_ID = `${PREFIX}user-wrong`;
const USER_NOEDIT_ID = `${PREFIX}user-noedit`;
const MOCK_LOCATION_ID = 900_003;
const CONTACT_EMAIL = "shipfulf-e2e@example.test";

// Independent fixture: the ORDER's delivery snapshot (ticket-04 payload).
const ORDER_SNAPSHOT = {
  address: {
    recipientName: "Budi Penerima Order",
    phone: "081299999999",
    fullAddress: "Jl. Snapshot Asal No. 9",
    provinceId: "01",
    province: "Fixture Province",
    cityId: "0101",
    city: "Fixture City",
    districtId: "010101",
    district: "Fixture District",
    areaId: "01010101",
    area: "Fixture Area",
    postalCode: "01234",
  },
  origin: {
    branchId: BRANCH_A_ID,
    name: "E2E Origin Shipment Branch",
    phone: "021999888777",
    address: "Jl. Origin E2E No. 9, Gudang D",
    zipcode: "10110",
    areaId: "01010101",
  },
  parcel: {
    weight: 290, // 1 × 250 + 40 kemasan
    items: [
      {
        item_name: "Shipment Anchor",
        quantity: 1,
        value: 100000,
        weight: 250,
        length: 30,
        width: 20,
        height: 10,
      },
    ],
  },
  service: {
    courierId: 13,
    serviceId: 1327,
    name: "JNE REG Fixture",
    shippingCost: "20000.00",
  },
  pricing: {
    subtotal: "100000.00",
    discount: "0.00",
    taxableBase: "120000.00",
    shippingCost: "20000.00",
    serviceFee: "0.00",
    ppnRatePercent: "11",
    ppnAmount: "13200.00",
    total: "133200.00",
  },
} as const;

const ACTOR_HOME = { id: USER_HOME_ID, homeBranchId: BRANCH_A_ID, canEditOrders: true };
const ACTOR_WRONG_BRANCH = { id: USER_WRONG_ID, homeBranchId: BRANCH_B_ID, canEditOrders: true };
const ACTOR_NO_EDIT = { id: USER_NOEDIT_ID, homeBranchId: BRANCH_A_ID, canEditOrders: false };

// --- The ONLY mock: the external Shipment create boundary ------------------
type CreateShipmentResult = {
  shipment_id: number;
  awb: string;
  tracking_url?: string;
  price: number;
  price_bill?: number;
};

interface GatewayControl {
  started: Promise<void>;
  calls: unknown[];
  release: (result?: CreateShipmentResult) => void;
  fail: (error: Error) => void;
  gateway: { createShipment: (request: unknown) => Promise<CreateShipmentResult> };
}

function recordingGateway(): GatewayControl {
  const calls: unknown[] = [];
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let releaseWith!: (value: CreateShipmentResult) => void;
  let failWith!: (error: Error) => void;
  // Await-signal latch: the POST's promise stays pending until the test
  // releases (or fails) it — concurrency assertions without sleep polling.
  const latch = new Promise<CreateShipmentResult>((resolve, reject) => {
    releaseWith = resolve;
    failWith = reject;
  });
  const RESULT: CreateShipmentResult = {
    shipment_id: 6001,
    awb: "MOCKAWB6001",
    tracking_url: "https://tracking.example.test/MOCKAWB6001",
    price: 25000,
    price_bill: 30000,
  };
  return {
    started,
    calls,
    release: (result) => releaseWith(result ?? RESULT),
    fail: (error) => failWith(error),
    gateway: {
      async createShipment(request: unknown): Promise<CreateShipmentResult> {
        calls.push(request);
        entered();
        const outcome = await latch;
        return outcome ?? RESULT;
      },
    },
  };
}

const url = process.env.DATABASE_URL;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const probe = new Pool({ connectionString: url, max: 1 });
    await probe.query("select 1");
    await probe.end();
    return true;
  } catch (error) {
    console.warn(
      `[shipment-fulfillment.db] NOT run — PostgreSQL unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

const reachable = await dbReachable();
const pool = url ? new Pool({ connectionString: url, max: 8 }) : null;
const db = pool ? drizzle(pool, { schema }) : null;
const dbReady = reachable && !!pool && !!db;

interface SnapshotPatch {
  parcelWeight?: number;
  parcelQuantity?: number;
  parcelValue?: number | string;
}

async function seedVerifiedDeliveryOrder(orderId: string, patch: SnapshotPatch = {}): Promise<void> {
  if (!pool) return;
  await pool.query(
    "DELETE FROM jubelio_sales_operation WHERE order_id = $1",
    [orderId]
  );
  await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
  const parcel = {
    weight: 290, // 1 × 250 + 40 kemasan
    items: [
      {
        item_name: "Shipment Anchor",
        quantity: patch.parcelQuantity ?? 1,
        value: patch.parcelValue ?? 100000,
        weight: patch.parcelWeight ?? 250,
        length: 30,
        width: 20,
        height: 10,
      },
    ],
  };
  const clientId = `${PREFIX}client`;
  await pool.query("INSERT INTO client (id,name,email,email_verified,phone,onboarding_completed) VALUES ($1,'Shipment Fixture Client','shipment-db-client@example.test',true,'+628123456789',true) ON CONFLICT (id) DO NOTHING", [clientId]);
  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, total, subtotal,
        shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
        contact_phone, contact_email, jubelio_sales_order_id,
        jubelio_invoice_id, jubelio_payment_id, fulfillment_method,
        delivery_snapshot, expires_at)
     VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
        '20000.00', '0', '0', '11', '13200.00',
        '081299999999', $4, 6000, 6100, 6200, 'delivery', $5,
        now() + interval '2 hours')`,
    [orderId, clientId, BRANCH_A_ID, CONTACT_EMAIL, JSON.stringify({ ...ORDER_SNAPSHOT, parcel })]
  );
  // The confirmed invoice + payment ledger (the settlement verification a
  // strict service may require).
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
     VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb,6000,6100,NULL), ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb,6000,6100,6200)`,
    [`${orderId}-op-invoice`, orderId, `${orderId}-op-payment`]
  );
}

describe("shipment fulfillment (PostgreSQL-backed)", () => {
  it.skipIf(!dbReady)(
    "eligibility failures reject pack AND book before ANY provider POST",
    async () => {
      if (!pool || !db) return;
      const control = recordingGateway();
      const fulfillment = createShipmentFulfillment(db, control.gateway);

      // Per-case drift rows, all FK-valid; nothing reaches the gateway.
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query("UPDATE orders SET payment_status = 'pending' WHERE id = $1", [ORDER_HAPPY]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query("UPDATE orders SET expires_at = now() - interval '1 minute', status='failed_payment', payment_status='failed' WHERE id = $1", [ORDER_HAPPY]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query("UPDATE orders SET fulfillment_method = 'pickup' WHERE id = $1", [ORDER_HAPPY]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query(
        "UPDATE orders SET fulfillment_blocked_reason = 'Sales-Order invoice unverified' WHERE id = $1",
        [ORDER_HAPPY]
      );
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query(
        "UPDATE orders SET jubelio_payment_id = NULL WHERE id = $1",
        [ORDER_HAPPY]
      );
      await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id = $1 AND type = 'payment'", [
        ORDER_HAPPY,
      ]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query("UPDATE jubelio_sales_operation SET invoice_id=999999 WHERE order_id=$1 AND type='payment'", [ORDER_HAPPY]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelWeight: 0 });
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();

      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await pool.query("UPDATE orders SET delivery_snapshot=jsonb_set(delivery_snapshot,'{origin,phone}','\"---\"') WHERE id=$1", [ORDER_HAPPY]);
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await expect(fulfillment.pack(ORDER_UNKNOWN, ACTOR_HOME)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_UNKNOWN, ACTOR_HOME)).rejects.toThrow();

      // Actor guards on a fully eligible order: no edit grant → reject; the
      // wrong Home Branch (even an all-branch editor) → reject.
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_NO_EDIT)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_NO_EDIT)).rejects.toThrow();
      await expect(fulfillment.pack(ORDER_HAPPY, ACTOR_WRONG_BRANCH)).rejects.toThrow();
      await expect(fulfillment.book(ORDER_HAPPY, ACTOR_WRONG_BRANCH)).rejects.toThrow();

      expect(control.calls).toHaveLength(0);
    }
  );

  it.skipIf(!dbReady)(
    "pack then parallel book claims across service instances POST exactly once; the winner persists AWB + three distinct audited costs",
    async () => {
      if (!pool || !db) return;
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      const controlA = recordingGateway();
      const controlB = recordingGateway();
      const fulfillmentA = createShipmentFulfillment(db, controlA.gateway);
      const fulfillmentB = createShipmentFulfillment(db, controlB.gateway);

      // Payment reservation TTL does not expire an already verified-paid order.
      await pool.query("UPDATE orders SET expires_at=now()-interval '1 day' WHERE id=$1", [ORDER_HAPPY]);
      await fulfillmentA.pack(ORDER_HAPPY, ACTOR_HOME);

      // Two parallel books on SEPARATE service instances: A claims the
      // dispatch and awaits the latch; B claims second — it can never obtain
      // a claim while A's is outstanding (or after), so it must refuse
      // WITHOUT posting. No sleep polling: pure awaits.
      const bookedA = fulfillmentA.book(ORDER_HAPPY, ACTOR_HOME);
      await controlA.started;
      const bookedB = fulfillmentB.book(ORDER_HAPPY, ACTOR_HOME).then(
        (value) => ({ settled: "fulfilled", value }),
        (error) => ({ settled: "rejected", message: String((error as Error).message) })
      );

      const resultB = await bookedB;
      // While A's POST is in flight, B must not have posted.
      expect(controlA.calls).toHaveLength(1);
      expect(controlB.calls).toHaveLength(0);

      controlA.release();
      const resultA = await bookedA;

      expect(resultA).toMatchObject({
        status: "booked",
        awb: "MOCKAWB6001",
        shipmentId: 6001,
        quoteRates: 20000,
        bookingPrice: 25000,
        billedPrice: 30000,
      });
      // The loser never booked (it has no AWB claim of its own), regardless
      // of whether it resolved as a skip or an error.
      expect(resultB.settled).toBe("rejected");

      // The cost mismatch (20.000 vs 25.000 vs 30.000) is AUDITED without
      // blocking the booking.
      const audit = await pool!.query<{ changes: unknown }>(
        "SELECT changes FROM audit_log WHERE entity_id=$1 AND action='SHIPMENT_BOOKED' ORDER BY created_at DESC LIMIT 1", [ORDER_HAPPY]
      );
      expect(audit.rows[0]?.changes).toMatchObject({
        quoteRates: { to: 20000 }, bookedPrice: { to: 25000 }, billedPrice: { to: 30000 },
        bookingDelta: { to: 5000 }, billedDelta: { to: 10000 },
      });
    }
  );

  it.skipIf(!dbReady)(
    "a thrown/timeout AFTER dispatch lands a durable booking_unknown and a repeated book cannot POST again",
    async () => {
      if (!pool || !db) return;
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      const control = recordingGateway();
      const fulfillment = createShipmentFulfillment(db, control.gateway);

      await fulfillment.pack(ORDER_HAPPY, ACTOR_HOME);

      const firstBook = fulfillment.book(ORDER_HAPPY, ACTOR_HOME);
      await control.started;
      control.fail(new Error("shipment timeout after dispatch"));
      expect(control.calls).toHaveLength(1);
      await expect(firstBook).rejects.toThrow();

      // The ambiguous state is durable: a repeated book refuses WITHOUT a
      // second POST (uncertainty about the first booking must never resolve
      // silently).
      const second = await fulfillment
        .book(ORDER_HAPPY, ACTOR_HOME)
        .then(
          () => null,
          (error: unknown) => String((error as Error).message)
        );
      expect(second, "the repeated book must reject while uncertain").toBeTruthy();
      expect(control.calls).toHaveLength(1);
    }
  );

  it.skipIf(!dbReady)(
    "the stored create request comes from the ORIGINAL snapshot receiver/origin/parcel/service — never the current branch/config/world — strict and without invented carton fields",
    async () => {
      if (!pool || !db) return;
      await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
      const control = recordingGateway();
      const fulfillment = createShipmentFulfillment(db, control.gateway);

      await fulfillment.pack(ORDER_HAPPY, ACTOR_HOME);

      // Drift the LIVE world after packing: the address book row, the branch
      // origin fields and the packaging config.
      await pool.query(
        "UPDATE address SET full_address = 'Jl. DIUBAHH', area_id = '9999', postal_code = '99999' WHERE first_name = 'Budi Penerima Order' AND full_address = 'Jl. Snapshot Asal No. 9'",
        []
      );
      await pool.query(
        "UPDATE branch SET shipping_phone = '000', shipping_address = 'Jl. NEW', shipping_postal_code = '99999' WHERE id = $1",
        [BRANCH_A_ID]
      );
      await pool.query(
        "UPDATE system_config SET value = '999' WHERE key = 'shipment.packagingWeightGrams'"
      );

      control.release();
      const result = await fulfillment.book(ORDER_HAPPY, ACTOR_HOME);
      expect(result.status).toBe("booked");

      expect(control.calls).toHaveLength(1);
      const request = control.calls[0] as Record<string, unknown>;
      expect(request).toMatchObject({
        // ref_no correlates the booking with the order; no idempotency claim.
        ref_no: ORDER_HAPPY,
        courier_id: 13,
        courier_service_id: 1327,
        is_cod: false,
        origin: {
          name: "E2E Origin Shipment Branch",
          phone: "021999888777",
          address: "Jl. Origin E2E No. 9, Gudang D",
          zipcode: "10110",
          area_id: "01010101",
        },
        destination: {
          name: "Budi Penerima Order",
          phone: "081299999999",
          address: "Jl. Snapshot Asal No. 9",
          zipcode: "01234",
          area_id: "01010101",
        },
        items: [
          {
            item_name: "Shipment Anchor",
            quantity: 1,
            value: 100000,
            weight: 250,
            length: 30,
            width: 20,
            height: 10,
          },
        ],
      });
      // No invented package_detail/carton; insurance must stay off.
      expect(request.package_detail).toBeUndefined();
      const insurance = request.shipping_insurance;
      expect(insurance === undefined || insurance === 0 || insurance === false).toBe(true);
    }
  );
  it.skipIf(!dbReady)("obtains a missing billed cost by GET of the known AWB without repeating creation", async () => {
    if (!pool || !db) return;
    await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
    const control = recordingGateway(); const lookups: string[] = [];
    const gateway = { ...control.gateway, getAwb: async (awb: string) => { lookups.push(awb); return { shipment_id: 6001, awb, ref_no: ORDER_HAPPY, price_bill: 30000 }; } };
    const service = createShipmentFulfillment(db, gateway); await service.pack(ORDER_HAPPY, ACTOR_HOME);
    control.release({ shipment_id: 6001, awb: 'MOCKAWB6001', price: 25000 });
    expect((await service.book(ORDER_HAPPY, ACTOR_HOME)).billedPrice).toBe(30000);
    expect(lookups).toEqual(['MOCKAWB6001']); expect(control.calls).toHaveLength(1);
  });
  it.skipIf(!dbReady)("rejects a stale Home Branch policy after reassignment", async () => {
    if (!pool || !db) return;
    await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
    await pool.query('UPDATE "user" SET branch_id=$2 WHERE id=$1', [USER_HOME_ID, BRANCH_B_ID]);
    try {
      const control = recordingGateway();
      await expect(createShipmentFulfillment(db, control.gateway).pack(ORDER_HAPPY, ACTOR_HOME)).rejects.toThrow();
      expect(control.calls).toHaveLength(0);
    } finally { await pool.query('UPDATE "user" SET branch_id=$2 WHERE id=$1', [USER_HOME_ID, BRANCH_A_ID]); }
  });
  it.skipIf(!dbReady)("honors an explicitly approved zero rate (not a missing-rate fallback)", async () => {
    if (!pool || !db) return;
    await seedVerifiedDeliveryOrder(ORDER_HAPPY, { parcelQuantity: 1 });
    const snapshot = { ...ORDER_SNAPSHOT, service: { ...ORDER_SNAPSHOT.service, shippingCost: "0" }, pricing: { ...ORDER_SNAPSHOT.pricing, taxableBase: "100000", shippingCost: "0", ppnAmount: "11000", total: "111000" } };
    await pool.query("UPDATE orders SET shipping_cost='0',ppn_amount='11000',total='111000',delivery_snapshot=$2 WHERE id=$1", [ORDER_HAPPY, JSON.stringify(snapshot)]);
    const control = recordingGateway();
    await expect(createShipmentFulfillment(db, control.gateway).pack(ORDER_HAPPY, ACTOR_HOME)).resolves.toEqual({ status: "packed" });
    expect(control.calls).toHaveLength(0);
  });
});

beforeAll(async () => {
  if (!pool) return;
  // FK-valid shared fixtures: two branches (A = origin-ready, B = other),
  // two roles (edit grants + view-only), three admin users.
  await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}branch-%'`);
  await pool.query(`DELETE FROM admin_role WHERE id LIKE '${PREFIX}role-%'`);

  await pool.query(
    `INSERT INTO branch
       (id, name, code, city, address, status, shipping_phone, shipping_address,
        shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'Shipment Origin A', $2, 'Jakarta Pusat', 'Jl. Fix A', 'aktif',
             '021999888777', 'Jl. Origin E2E No. 9, Gudang D', '10110', '01010101', $3),
            ($4, 'Shipment Other B', $5, 'Surabaya', 'Jl. Fix B', 'aktif',
             '0315550001', 'Jl. Fix B 2', '60275', '02020101', 900004)`,
    [
      BRANCH_A_ID,
      `${PREFIX}code-a`,
      MOCK_LOCATION_ID,
      BRANCH_B_ID,
      `${PREFIX}code-b`,
    ]
  );

  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, $2), ($3, $4)`, [
    ROLE_EDIT_ID,
    "Shipment Fulfillment Edit",
    ROLE_VIEW_ID,
    "Shipment Fulfillment Viewer",
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'),
            ($3, $2, 'orders', 'edit', 'own_branch'),
            ($4, $5, 'orders', 'view', 'own_branch')`,
    [
      `${PREFIX}g-view`, ROLE_EDIT_ID,
      `${PREFIX}g-edit`,
      `${PREFIX}g-view2`, ROLE_VIEW_ID,
    ]
  );

  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Actor Home', $2, $2, $3, true, $4, $5, true),
            ($6, 'Actor Wrong', $7, $7, $8, true, $4, $9, true),
            ($10, 'Actor NoEdit', $11, $11, $12, true, $13, $5, true)`,
    [
      USER_HOME_ID, `${PREFIX}home`, `${PREFIX}home@example.test`, ROLE_EDIT_ID, BRANCH_A_ID,
      USER_WRONG_ID, `${PREFIX}wrong`, `${PREFIX}wrong@example.test`, BRANCH_B_ID,
      USER_NOEDIT_ID, `${PREFIX}noedit`, `${PREFIX}noedit@example.test`, ROLE_VIEW_ID,
    ]
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}branch-%'`);
  await pool.query(`DELETE FROM admin_role WHERE id LIKE '${PREFIX}role-%'`);
  await pool.query('DELETE FROM client WHERE id=$1', [`${PREFIX}client`]);
  await pool.end();
});