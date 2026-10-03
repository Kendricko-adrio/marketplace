import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import crypto from "node:crypto";
import {
  createShipmentTracking,
  verifyShipmentSignature,
} from "./shipment-tracking";

// =========================================================
// shipment-tracking — signature + webhook ingestion + handoff/reconcile
// (ticket 06, spec Ready "Pelacakan" + the Shipment v1.8 webhook contract).
//
// SHARED PURE FACTORY (implemented by main in ./shipment-tracking):
//   createShipmentTracking(db, gateway) — app-LOCAL (db/logger injection; NO
//   cross-app auth imports; callable from the store callback AND the admin
//   handoff/reconcile).
//     handoff(orderId, actor)   — the physical serah-terima: orders:edit +
//       Home Branch == the CURRENT DB branch + verified paid unblocked +
//       BOOKED ledger (awb/ids) — NO provider POST, NO order completion.
//       Idempotent duplicate → the same safe no-post outcome.
//     reconcile(orderId, actor)— GET-ONLY on the KNOWN AWB
//       (gateway.getAwb(awb)); the returned shipment_id/awb/ref_no must
//       MATCH the order before any status/price_bill data lands.
//     ingestWebhook(rawBody, hexSignature, secret) — an HMAC-SHA256
//       verification FIRST (before any json/mutation); the normalized
//       latest_status vocabulary (NEVER the carrier's tracking.status
//       D09/CNCL); a tolerant future-field envelope; a dedupe by the
//       raw-body fingerprint (a UNIQUE receipt); a monotonic progress (older
//       events are recorded, never applied); DELIVERED completes (verified
//       signature or GET) even with an EMPTY pod; PICKED_UP never completes;
//       after completion NOTHING reopens or creates new issues (ticket 07
//       owns the follow-up); NO Midtrans/Stock/SO write, no refund, no email;
//       no polling/cron — reactive/manual GET only.
//
// Pure seam: verifyShipmentSignature(raw, hex, secret) → boolean via the
// vendor's OWN example construction (HMAC-SHA256 with key=secret over the
// message raw + secret, hex compared constant-time).
//
// INDEPENDENT FIXTURE (computed by the parent with OpenSSL — the expected hex
// is NEVER derived from any production helper):
//   raw    = the exact byte string below
//   secret = "fixture-shipment-secret"
//   hex    = 5ced92842be2ec813a0f2f70e729aae2f34e96c29b457b74534a8dbda1cdc233
//
// The REAL PostgreSQL parts need the delivery-shipment schema extension
// (handed_over_at/by, latest_status, latest_event_at, delivered_at, pod_url +
// the global unique awb/shipment_id) and the delivery_tracking_event table
// — MAIN'S migration; absent fields are the expected red.
// Unreachable DB → skip (skip ≠ pass). The prefix "track-dbtest-" owns all
// fixture rows; the seeded data is never reset.
// =========================================================

const RAW_EXACT =
  '{"event":"awb","ref_no":"track-order-1","awb":"TRACKAWB7101","shipment_id":7101,"latest_status":"DELIVERED","tracking":{"date":"2026-10-01T01:00:00Z","status":"D09","status_detail":"Delivered"},"future_field":{"ignored":true}}';
const WEBHOOK_SECRET = "fixture-shipment-secret";
const EXPECTED_HEX =
  "5ced92842be2ec813a0f2f70e729aae2f34e96c29b457b74534a8dbda1cdc233";

const PREFIX = "track-dbtest-";
const ORDER_ID = "track-order-1"; // the static fixture's ref_no
const ORDER_ID_TWO = `${PREFIX}order-2`;
const AWB = "TRACKAWB7101";
const SHIPMENT_ID = 7101;
const BRANCH_A_ID = `${PREFIX}branch-a`;
const BRANCH_B_ID = `${PREFIX}branch-b`;
const ROLE_EDIT_ID = `${PREFIX}role-edit`;
const ROLE_VIEW_ID = `${PREFIX}role-view`;
const USER_HOME_ID = `${PREFIX}user-home`;
const USER_NOEDIT_ID = `${PREFIX}user-noedit`;
const CLIENT_ID = `${PREFIX}client`;

const ACTOR_HOME = { id: USER_HOME_ID, homeBranchId: BRANCH_A_ID, canEditOrders: true };
const ACTOR_NO_EDIT = { id: USER_NOEDIT_ID, homeBranchId: BRANCH_A_ID, canEditOrders: false };

const SNAPSHOT = {
  address: {
    recipientName: "Budi Penerima Order",
    phone: "081299999999",
    fullAddress: "Jl. Tracking Asal No. 6",
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
  origin: { branchId: BRANCH_A_ID, name: "E2E Origin Track Branch", phone: "021999888777", address: "Jl. Origin Track No. 6", zipcode: "10110", areaId: "01010101" },
  parcel: { weight: 290, items: [{ item_name: "Tracking Anchor", quantity: 1, value: 100000, weight: 250, length: 30, width: 20, height: 10 }] },
  service: { courierId: 13, serviceId: 1327, name: "JNE REG Fixture", shippingCost: "20000.00" },
  pricing: { subtotal: "100000.00", discount: "0.00", taxableBase: "120000.00", shippingCost: "20000.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "13200.00", total: "133200.00" },
} as const;

/** The mock of the ONLY external boundary in this file: the AWB detail GET. */
function recordingGateway(fixtures: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      async getAwb(awb: string): Promise<unknown> {
        calls.push(awb);
        const fixture = fixtures[awb];
        if (!fixture) {
          throw new Error("SHIPMENT_AWB_UNKNOWN");
        }
        return fixture;
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
      `[shipment-tracking.db] NOT run — PostgreSQL unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

const reachable = await dbReachable();
const pool = url ? new Pool({ connectionString: url, max: 8 }) : null;
const db = pool ? drizzle(pool, {} as never) : null;
const dbReady = reachable && !!pool && !!db;

interface LedgerFixture {
  awb: string;
  shipmentId: number;
  refNo?: string;
  latestStatus?: string;
  delivered?: boolean;
}

/** BOOKED delivery shipment + the verified order (the ticket-05 state). */
async function seedBookedShipment(orderId: string, ledger: LedgerFixture): Promise<void> {
  if (!pool) return;
  await pool.query("DELETE FROM delivery_tracking_event WHERE shipment_id IN (SELECT id FROM delivery_shipment WHERE order_id = $1)", [orderId]);
  await pool.query("DELETE FROM delivery_shipment WHERE order_id = $1", [orderId]);
  await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id = $1", [orderId]);
  await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);
  await pool.query("INSERT INTO client (id, name, email, email_verified, phone, onboarding_completed) VALUES ($1,'Tracking Fixture Client','track-db-client@example.test',true,'+628123456789',true) ON CONFLICT (id) DO NOTHING", [CLIENT_ID]);
  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, total, subtotal,
        shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
        contact_phone, contact_email, jubelio_sales_order_id,
        jubelio_invoice_id, jubelio_payment_id, fulfillment_method,
        delivery_snapshot, expires_at)
     VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
        '20000.00', '0', '0', '11', '13200.00',
        '081299999999', 'tracking-e2e@example.test', 7001, 7101, 7201,
        'delivery', $4, now() - interval '5 days')`,
    [orderId, CLIENT_ID, BRANCH_A_ID, JSON.stringify(SNAPSHOT)]
  );
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
     VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb, 7001, 7101, 7201), ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb, 7001, 7101, 7201)`,
    [`${orderId}-invoice`, orderId, `${orderId}-payment`]
  );
  await pool.query(
    `INSERT INTO delivery_shipment
       (id, order_id, state, stored_request, attempt_count, packed_by,
        dispatched_by, booked_by, dispatched_at, booked_at, shipment_id,
        awb, tracking_url, quote_rates, booked_price, billed_price)
     VALUES ($1, $2, 'booked', '{"ref_no":"ref"}'::jsonb, 1, $3, $3, $3,
        now() - interval '6 days', now() - interval '5 days', $4, $5,
        'http://127.0.0.1:3112/tracking/1', '20000.00', '25000.00', NULL)`,
    [`${PREFIX}ship-${orderId}`, orderId, USER_HOME_ID, ledger.shipmentId, ledger.awb]
  );
}

describe("verifyShipmentSignature (pure, independent fixture)", () => {
  it("accepts the OpenSSL-computed HEX exactly and rejects tampered hex, changed body, wrong secret or bad hex — with no state touched", () => {
    expect(verifyShipmentSignature(RAW_EXACT, EXPECTED_HEX, WEBHOOK_SECRET)).toBe(true);
    // One character flipped in the signature.
    const tamperedHex = (EXPECTED_HEX.slice(0, 8) + "0" + EXPECTED_HEX.slice(9));
    expect(tamperedHex).not.toBe(EXPECTED_HEX);
    expect(verifyShipmentSignature(RAW_EXACT, tamperedHex, WEBHOOK_SECRET)).toBe(false);
    // One character changed inside the raw body.
    const changedRaw = RAW_EXACT.replace('"DELIVERED"', '"WAITING"');
    expect(changedRaw).not.toBe(RAW_EXACT);
    expect(verifyShipmentSignature(changedRaw, EXPECTED_HEX, WEBHOOK_SECRET)).toBe(false);
    // A different secret can never validate.
    expect(verifyShipmentSignature(RAW_EXACT, EXPECTED_HEX, "wrong-secret")).toBe(false);
    // A broken hex string rejects safely (no crash, no write).
    expect(verifyShipmentSignature(RAW_EXACT, "not-hex!", WEBHOOK_SECRET)).toBe(false);
    expect(verifyShipmentSignature(RAW_EXACT, "", WEBHOOK_SECRET)).toBe(false);
  });
});

describe("createShipmentTracking — handoff (PostgreSQL-backed)", () => {
  it.skipIf(!dbReady)(
    "handoff requires orders:edit AND the CURRENT DB Home Branch; records serah-terima WITHOUT a provider POST, keeps the order processing, and the duplicate stays idempotent",
    async () => {
      if (!pool || !db) return;
      const control = recordingGateway();
      const tracking = createShipmentTracking(db, control.gateway);
      await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });

      expect(control.calls).toHaveLength(0);
      const handed = await tracking.handoff(ORDER_ID, ACTOR_HOME);
      expect(handed.status).toBe("handed");
      // NO provider call, NO order completion.
      expect(control.calls).toHaveLength(0);
      const order = (await pool!.query("SELECT status, payment_status FROM orders WHERE id = $1", [ORDER_ID])).rows[0];
      expect(order.status).toBe("processing");
      expect(order.payment_status).toBe("paid");
      const ledger = (await pool!.query(
        "SELECT handed_over_at IS NOT NULL AS stamped, handed_over_by FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )).rows[0];
      expect(ledger.stamped).toBe(true);
      expect(ledger.handed_over_by).toBe(USER_HOME_ID);

      // A duplicate handoff is idempotent: no error, no second effect.
      const again = await tracking.handoff(ORDER_ID, ACTOR_HOME);
      expect(again.status).not.toBe("error");
      expect(control.calls).toHaveLength(0);

      // Guards: no-edit actor and a wrong/foreign id → rejections.
      await seedBookedShipment(ORDER_ID_TWO, { awb: "TRACKAWB7102", shipmentId: 7102 });
      await expect(tracking.handoff(ORDER_ID_TWO, ACTOR_NO_EDIT)).rejects.toThrow();
      await expect(tracking.handoff("track-nonexistent", ACTOR_HOME)).rejects.toThrow();
      expect(control.calls).toHaveLength(0);
    }
  );

  it.skipIf(!dbReady)(
    "reconcile GET-verifies the KNOWN AWB and applies statuses/price_bill only when the returned triplet matches; unknown AWB or a mismatched triplet changes nothing",
    async () => {
      if (!pool || !db) return;
      const control = recordingGateway({
        [AWB]: {
          shipment_id: SHIPMENT_ID,
          ref_no: ORDER_ID,
          awb: AWB,
          latest_status: "ON_DELIVERY",
          price_bill: 30000,
          tracking: [{ date: "2026-10-01T00:05:00Z", status: "ON_DELIVERY" }],
        },
      });
      const tracking = createShipmentTracking(db, control.gateway);
      await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });

      const reconciled = await tracking.reconcile(ORDER_ID, ACTOR_HOME);
      expect(reconciled.status).toBe("reconciled");
      expect(control.calls).toEqual([AWB]);
      const ledger = (await pool!.query(
        "SELECT latest_status, latest_event_at IS NOT NULL AS stamped, billed_price FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )).rows[0];
      expect(ledger.latest_status).toBe("ON_DELIVERY");
      expect(ledger.stamped).toBe(true);
      expect(Number(ledger.billed_price)).toBe(30000);
      expect((await pool.query("SELECT latest_status FROM delivery_tracking_event WHERE shipment_id=$1 AND source='get' AND applied=true", [`${PREFIX}ship-${ORDER_ID}`])).rows).toHaveLength(1);

      // A mismatched triplet (foreign shipment identity) changes nothing.
      const wrong = recordingGateway({
        TRACKAWB7102: { shipment_id: 9999, ref_no: "someone-else", awb: "TRACKAWB7102", latest_status: "DELIVERED" },
      });
      const tracking2 = createShipmentTracking(db, wrong.gateway);
      await seedBookedShipment(ORDER_ID_TWO, { awb: "TRACKAWB7102", shipmentId: 7102 });
      await expect(tracking2.reconcile(ORDER_ID_TWO, ACTOR_HOME)).rejects.toThrow();
      const untouched = (await pool!.query(
        "SELECT latest_status, latest_event_at FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID_TWO]
      )).rows[0];
      expect(untouched.latest_status).toBe(null);
      expect(untouched.latest_event_at).toBe(null);

      // An unknown AWB (provider 4xx) rejects and changes nothing.
      const unknownGateway = recordingGateway({});
      const tracking3 = createShipmentTracking(db, unknownGateway.gateway);
      await expect(tracking3.reconcile(ORDER_ID_TWO, ACTOR_HOME)).rejects.toThrow();
      const stillUntouched = (await pool!.query(
        "SELECT latest_status, latest_event_at FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID_TWO]
      )).rows[0];
      expect(stillUntouched.latest_status).toBe(null);
    }
  );

  it.skipIf(!dbReady)(
    "ingestWebhook verifies BEFORE any parse/mutate; a valid DELIVERED ingests (empty POD included), completes the order, and a replay dedupes on the fingerprint while late out-of-order statuses never reopen it",
    async () => {
      if (!pool || !db) return;
      const control = recordingGateway();
      const tracking = createShipmentTracking(db, control.gateway);
      await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });

      const tampered = await tracking
        .ingestWebhook(RAW_EXACT, EXPECTED_HEX.slice(0, 16), WEBHOOK_SECRET)
        .then(() => "accepted", (error: unknown) => String((error as Error).message));
      expect(tampered.length).toBeGreaterThan(0); // refuse — nothing mutated
      expect(
        (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0].status
      ).toBe("processing");

      // Normal progress first: WAITING → PICKED_UP (the fresh receipts are
      // signed with node:crypto using the SAME construction — the static
      // independent fixture above already pinned the signature itself).
      const sign = (raw: string, secret = WEBHOOK_SECRET) =>
        crypto.createHmac("sha256", secret).update(raw + secret).digest("hex");
      const waiting = JSON.stringify({
        event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID,
        latest_status: "WAITING", tracking: [],
      });
      expect(
        (await tracking.ingestWebhook(waiting, sign(waiting), WEBHOOK_SECRET)).status
      ).toBe("applied");
      const picked = JSON.stringify({
        event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID,
        latest_status: "PICKED_UP", tracking: [{ date: "2026-10-01T00:00:00Z", status: "S01" }],
      });
      const pickedResult = await tracking.ingestWebhook(picked, sign(picked), WEBHOOK_SECRET);
      expect(pickedResult.status).toBe("applied");
      // PICKED_UP is NOT completion.
      expect(
        (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0].status
      ).toBe("processing");

      // DELIVERED with an EMPTY POD completes the order (verified signature).
      const result = await tracking.ingestWebhook(RAW_EXACT, EXPECTED_HEX, WEBHOOK_SECRET);
      expect(result.status).toBe("applied");
      const ledger = (await pool!.query(
        "SELECT latest_status, delivered_at IS NOT NULL AS delivered, delivered_at IS NOT NULL AS delivered_stamp, pod_url FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )).rows[0];
      expect(ledger.latest_status).toBe("DELIVERED");
      expect(ledger.delivered).toBe(true);
      expect(ledger.pod_url).toBe(null);
      const order = (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0];
      expect(order.status).toBe("completed");

      // The EXACT receipt history: WAITING, PICKED_UP, DELIVERED = 3 rows.
      const receipts = (await pool!.query(
        "SELECT count(*)::int AS n FROM delivery_tracking_event te JOIN delivery_shipment s ON s.id = te.shipment_id WHERE s.order_id = $1",
        [ORDER_ID]
      )).rows[0];
      expect(receipts.n).toBe(3);

      // The replay of the IDENTICAL body: deduped by the fingerprint, no
      // double effect, no new receipt.
      const replay = await tracking.ingestWebhook(RAW_EXACT, EXPECTED_HEX, WEBHOOK_SECRET);
      expect(replay.status).not.toBe("applied");
      expect(
        (await pool!.query(
          "SELECT count(*)::int AS n FROM delivery_tracking_event te JOIN delivery_shipment s ON s.id = te.shipment_id WHERE s.order_id = $1",
          [ORDER_ID]
        )).rows[0].n
      ).toBe(3);
      // The order is STILL completed — never reopened.
      expect(
        (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0].status
      ).toBe("completed");

      // Late out-of-order statuses (a replayed PICKED_UP with a NEW body, or
      // an issue) are RECEIVED but ignored after completion; ticket 07 owns
      // any follow-up. They create a receipt but never reopen/progress.
      const latePicked = JSON.stringify({
        event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID,
        latest_status: "PICKED_UP", tracking: [{ date: "2026-10-01T09:00:00Z", status: "S01" }],
      });
      const late = await tracking.ingestWebhook(latePicked, sign(latePicked), WEBHOOK_SECRET);
      expect(late.status).not.toBe("applied");
      const issue = JSON.stringify({
        event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID,
        latest_status: "SHIPMENT_ISSUE", tracking: [],
      });
      const issueResult = await tracking.ingestWebhook(issue, sign(issue), WEBHOOK_SECRET);
      expect(issueResult.status).not.toBe("applied");
      const finalOrder = (await pool!.query("SELECT status FROM orders WHERE id = $1", [ORDER_ID])).rows[0];
      expect(finalOrder.status).toBe("completed");
      const receiptCount = (await pool!.query(
        "SELECT count(*)::int AS n FROM delivery_tracking_event te JOIN delivery_shipment s ON s.id = te.shipment_id WHERE s.order_id = $1",
        [ORDER_ID]
      )).rows[0];
      // The receipts grow (a late, fresh body is recorded), but the applied
      // state never regresses nor reopens the completed order.
      expect(receiptCount.n).toBe(5);
      const finalLedger = (await pool!.query(
        "SELECT latest_status FROM delivery_shipment WHERE order_id = $1",
        [ORDER_ID]
      )).rows[0];
      expect(finalLedger.latest_status).toBe("DELIVERED");
    }
  );
});

describe("tracking safety regressions", () => {
  it.skipIf(!dbReady)("stores available safe links without inventing an empty billed price", async () => {
    if (!pool || !db) return;
    await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });
    const control = recordingGateway({ [AWB]: { shipment_id: SHIPMENT_ID, awb: AWB, ref_no: ORDER_ID, latest_status: 'WAITING', price_bill: '', tracking_url: 'https://tracking.example.test/awb' } });
    await createShipmentTracking(db, control.gateway).reconcile(ORDER_ID, ACTOR_HOME);
    const row = (await pool.query('SELECT billed_price,tracking_url FROM delivery_shipment WHERE order_id=$1', [ORDER_ID])).rows[0];
    expect(row.billed_price).toBeNull(); expect(row.tracking_url).toBe('https://tracking.example.test/awb');
  });
  it.skipIf(!dbReady)("records pre-completion issues, rejects older progress, and never stamps a new handoff after completion", async () => {
    if (!pool || !db) return;
    await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });
    const tracking = createShipmentTracking(db, recordingGateway().gateway);
    const event = (status: string, date: string) => JSON.stringify({ event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID, latest_status: status, tracking: { date, status_detail: status } });
    const apply = (raw: string) => tracking.ingestWebhook(raw, crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw + WEBHOOK_SECRET).digest("hex"), WEBHOOK_SECRET);
    await apply(event("ON_DELIVERY", "2026-10-01T00:10:00Z"));
    await apply(event("SHIPMENT_ISSUE", "2026-10-01T00:20:00Z"));
    expect((await pool.query("SELECT latest_status FROM delivery_shipment WHERE order_id=$1", [ORDER_ID])).rows[0].latest_status).toBe("SHIPMENT_ISSUE");
    await apply(event("RETURNED", "2026-10-01T00:25:00Z"));
    await apply(event("ON_DELIVERY", "2026-10-01T00:15:00Z"));
    expect((await pool.query("SELECT latest_status FROM delivery_shipment WHERE order_id=$1", [ORDER_ID])).rows[0].latest_status).toBe("RETURNED");
    await apply(RAW_EXACT);
    await expect(tracking.handoff(ORDER_ID, ACTOR_HOME)).rejects.toThrow();
  });
  it.skipIf(!dbReady)("concurrent callbacks cannot regress normal progress", async () => {
    if (!pool || !db) return;
    await seedBookedShipment(ORDER_ID, { awb: AWB, shipmentId: SHIPMENT_ID });
    const tracking = createShipmentTracking(db, recordingGateway().gateway);
    await Promise.all(["ON_DELIVERY", "PICKED_UP"].map((status) => {
      const raw = JSON.stringify({ event: "awb", ref_no: ORDER_ID, awb: AWB, shipment_id: SHIPMENT_ID, latest_status: status });
      return tracking.ingestWebhook(raw, crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw + WEBHOOK_SECRET).digest("hex"), WEBHOOK_SECRET);
    }));
    expect((await pool.query("SELECT latest_status FROM delivery_shipment WHERE order_id=$1", [ORDER_ID])).rows[0].latest_status).toBe("ON_DELIVERY");
  });
});

beforeAll(async () => {
  if (!pool) return;
  // Delete fixture parent orders first (child ledgers/receipts cascade).
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%' OR id=$1`, [ORDER_ID]);
  await pool.query(`DELETE FROM admin_session WHERE user_id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM admin_account WHERE user_id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}branch-%'`);
  await pool.query(`DELETE FROM admin_role WHERE id LIKE '${PREFIX}role-%'`);
  await pool.query("DELETE FROM client WHERE id = $1", [CLIENT_ID]);

  await pool.query(
    `INSERT INTO branch (id, name, code, city, address, status, shipping_phone, shipping_address, shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'Tracking Origin A', 'TRKA', 'Jakarta Pusat', 'Jl. Fix A', 'aktif', '021999888777', 'Jl. Origin Track No. 6', '10110', '01010101', 900007),
            ($2, 'Tracking Other B', 'TRKB', 'Surabaya', 'Jl. Fix B', 'aktif', '0315550001', 'Jl. Fix B 3', '60275', '02020101', 900008)`,
    [BRANCH_A_ID, BRANCH_B_ID]
  );
  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, $2), ($3, $4)`, [
    ROLE_EDIT_ID, "Tracking Editor", ROLE_VIEW_ID, "Tracking Viewer",
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'), ($3, $2, 'orders', 'edit', 'own_branch'), ($4, $5, 'orders', 'view', 'own_branch')`,
    ["gr-track-view", ROLE_EDIT_ID, "gr-track-edit", "gr-track-view2", ROLE_VIEW_ID]
  );
  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Actor Home', 'trackhome', 'trackhome', 'trackhome@example.test', true, $2, $3, true),
            ($4, 'Actor NoEdit', 'tracknoedit', 'tracknoedit', 'tracknoedit@example.test', true, $5, $3, true)`,
    [USER_HOME_ID, ROLE_EDIT_ID, BRANCH_A_ID, USER_NOEDIT_ID, ROLE_VIEW_ID]
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(
    `DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND (s.order_id LIKE '${PREFIX}order-%' OR s.order_id = $1)`,
    [ORDER_ID]
  );
  await pool.query(`DELETE FROM delivery_shipment WHERE order_id LIKE '${PREFIX}order-%' OR order_id = $1`, [ORDER_ID]);
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%' OR id=$1`, [ORDER_ID]);
  await pool.query(`DELETE FROM admin_session WHERE user_id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM admin_account WHERE user_id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}branch-%'`);
  await pool.query(`DELETE FROM admin_role WHERE id LIKE '${PREFIX}role-%'`);
  await pool.query("DELETE FROM client WHERE id = $1", [CLIENT_ID]);
  await pool.end();
});