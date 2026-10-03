import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createShipmentFulfillment } from "./shipment-fulfillment";
import { createDeliveryFollowUp } from "./delivery-follow-up";

// =========================================================
// delivery-follow-up — the scoped follow-up ledger + the manual resolution
// actions (ticket 07, spec Ready + tiket 07).
//
// PUBLIC SEAM (proposed; implemented by main in ./delivery-follow-up):
//   createDeliveryFollowUp(db) — NO gateway, NO provider method exists here:
//     the release never creates a booking (a separate manual book must).
//     list(actorView, filterKind) — filterKind 'settlement' | 'packing' |
//       'booking' | 'shipment' | 'all'; every list/detail call is gated by
//       orders:view + Branch Scope (own_branch sees ONLY its Home Branch's
//       rows; cross-branch rows hide; all-branch sees everything).
//     failPacking(orderId, actor, reasonCode) — the EXACT spec codes only:
//       physical_stock_unavailable | damaged_goods |
//       paid_service_limits_exceeded (an invented code is rejected). Keeps
//       the order processing/paid; sets the delivery failure flag
//       (code/at/by) which BLOCKS all normal packing/booking/handoff and is
//       NOT erased by the settlement sweep (only the settlement block flag
//       clears); mandatory reason-coded + transactionally audited; exits the
//       normal queue except the packing follow-up filter.
//     releaseBooking(orderId, actor, proof) — ONLY for the settled
//       booking_unknown (never a live booking_dispatched): the proof is an
//       AUTHORIZED HUMAN's audited attestation that Jubelio confirmed the
//       first operation CLOSED and NO booking exists:
//       {source:'jubelio_confirmation', reference, reason, attemptNumber,
//        absenceConfirmed:true, operationClosed:true} — with the CURRENT
//       attempt number matched (stale proof denied); never inferred from a
//       timeout/404/elapsed time/not-found dashes. The release moves unknown
//       → packed with NO provider POST, the attempt count NOT reset
//       (monotonic), preserves the original dispatch actor/time/request in a
//       NEW delivery_booking_reviews row (per ledger+attempt unique), allows
//       exactly ONE future atomic book claim, the simultaneous releases
//       resolve with only ONE winner, and the stale/repeated proofs are
//       denied.
//     finishManually(orderId, actor, reason) — ONLY for a known booked
//       verified paid unblocked order whose tracking shows RETURNED/
//       SHIPMENT_ISSUE, OR an electronic-stuck booking_unknown WITH physical
//       evidence (the handoff stamp/provider PICKED_UP); the mandatory
//       non-blank reason; processing → completed + the delivery manual
//       reason/at/by + the audit; NO pickup code; denied for the unpaid/
//       blocked/packing-failed/plain-AWB-alone/ambiguous-without-evidence
//       orders (zero effects).
//
// RED mechanics: ./delivery-follow-up, the delivery_booking_reviews table and
// the orders' delivery failure/manual columns are main's stage (a missing
// module + missing columns = the expected red). REAL PostgreSQL; unreachable
// → skip (skip ≠ pass). The prefix "followup-dbtest-" owns all fixture rows;
// the CLEANUP ORDER: the tracking events → the shipment ledger → the booking
// reviews → the settlement ops → the orders (cascades) → the admin
// sessions/accounts → the users → the branches → the roles → the client. The
// seeded data is never reset.
// =========================================================

const schema = await import('@marketplace/db/src/schema');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
await pool.query('SELECT 1');
const dbReady = true;
const PREFIX = "followup-dbtest-";
const CONTACT_EMAIL = "followup-e2e@example.test";

const ROLE_EDIT_ID = `${PREFIX}role-edit`;
const ROLE_VIEW_ID = `${PREFIX}role-view`;
const ROLE_OWNER_ID = `${PREFIX}role-owner`;
const BRANCH_A_ID = `${PREFIX}branch-a`;
const BRANCH_B_ID = `${PREFIX}branch-b`;
const USER_HOME_ID = `${PREFIX}user-home`;
const USER_VIEW_B_ID = `${PREFIX}user-viewb`;
const USER_ALL_ID = `${PREFIX}user-all`;

const ACTOR_HOME = { id: USER_HOME_ID, homeBranchId: BRANCH_A_ID, canEditOrders: true };
const ACTOR_WRONG_BRANCH = { id: USER_ALL_ID, homeBranchId: BRANCH_B_ID, canEditOrders: true };
const ACTOR_NO_EDIT = { id: USER_VIEW_B_ID, homeBranchId: BRANCH_A_ID, canEditOrders: false };

const VIEW_HOME = { canViewOrders: true, viewScope: "own_branch", homeBranchId: BRANCH_A_ID } as const;
const VIEW_FOREIGN = { canViewOrders: true, viewScope: "own_branch", homeBranchId: BRANCH_B_ID } as const;
const VIEW_ALL = { canViewOrders: true, viewScope: "all", homeBranchId: BRANCH_B_ID } as const;
const VIEW_DENIED = { canViewOrders: false, viewScope: "own_branch", homeBranchId: BRANCH_A_ID } as const;

// The five-block canonical snapshot (the ticket-04 persisted payload shape).
const SNAPSHOT = {
  address: {
    recipientName: "Budi Penerima Order",
    phone: "081299999999",
    fullAddress: "Jl. Followup Asal No. 2",
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
    name: "E2E Origin Followup Branch",
    phone: "021999888777",
    address: "Jl. Origin E2E No. 2, Gudang E",
    zipcode: "10110",
    areaId: "01010101",
  },
  parcel: {
    weight: 290,
    items: [
      { item_name: "Followup Anchor", quantity: 1, value: 100000, weight: 250, length: 30, width: 20, height: 10 },
    ],
  },
  service: { courierId: 13, serviceId: 1327, name: "JNE REG Fixture", shippingCost: "20000.00" },
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

const FIXTURE_IDS = {
  blocked: `${PREFIX}order-blocked`,
  packingFailed: `${PREFIX}order-pfailed`,
  ambiguousBooking: `${PREFIX}order-ambig`,
  returned: `${PREFIX}order-returned`,
  issue: `${PREFIX}order-issue`,
  stuck: `${PREFIX}order-stuck`,
  completedLateIssue: `${PREFIX}order-lateissue`,
  plainBooked: `${PREFIX}order-plain`,
} as const;

interface OrderOverrides {
  status?: string;
  paymentStatus?: string;
  blockedReason?: string;
  failureCode?: string;
  manualReason?: string;
  shipmentState?: "booked" | "booking_unknown" | "booking_dispatched";
  latestStatus?: string;
  stuckEvidence?: boolean;
}

async function seedOrder(id: string, overrides: OrderOverrides = {}): Promise<void> {
  if (!pool) return;
  // FK-ordered per-order cleanup, then a fresh row + its ledger.
  await pool.query(
    "DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND s.order_id = $1",
    [id]
  );
  await pool.query("DELETE FROM delivery_booking_reviews WHERE order_id = $1", [id]);
  await pool.query("DELETE FROM delivery_shipment WHERE order_id = $1", [id]);
  await pool.query("DELETE FROM jubelio_sales_operation WHERE order_id = $1", [id]);
  await pool.query("DELETE FROM orders WHERE id = $1", [id]);

  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_status, total, subtotal,
        shipping_cost, discount, service_fee, ppn_rate, ppn_amount,
        contact_phone, contact_email, jubelio_sales_order_id,
        jubelio_invoice_id, jubelio_payment_id, fulfillment_method,
        delivery_snapshot, fulfillment_blocked_reason,
        delivery_failure_code, delivery_failure_at, delivery_failure_by,
        delivery_manual_reason, delivery_manual_at, delivery_manual_by,
        expires_at)
     VALUES ($1, $2, $3, 'processing', 'paid', '133200.00', '100000.00',
        '20000.00', '0', '0', '11', '13200.00', '081299999999', $4,
        7001, 7101, 7201, 'delivery', $5, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, now() + interval '3 hours')`,
    [id, `${PREFIX}client`, BRANCH_A_ID, CONTACT_EMAIL, JSON.stringify(SNAPSHOT)]
  );
  if (overrides.blockedReason !== undefined) {
    await pool.query("UPDATE orders SET fulfillment_blocked_reason = $2 WHERE id = $1", [id, overrides.blockedReason]);
  }
  if (overrides.failureCode !== undefined) {
    await pool.query("UPDATE orders SET delivery_failure_code = $2, delivery_failure_at = now(), delivery_failure_by = $3 WHERE id = $1", [id, overrides.failureCode, USER_HOME_ID]);
  }
  if (overrides.manualReason !== undefined) {
    await pool.query("UPDATE orders SET delivery_manual_reason = $2, delivery_manual_at = now(), delivery_manual_by = $3 WHERE id = $1", [id, overrides.manualReason, USER_HOME_ID]);
  }
  if (overrides.status) {
    await pool.query("UPDATE orders SET status = $2 WHERE id = $1", [id, overrides.status]);
  }
  if (overrides.paymentStatus) {
    await pool.query("UPDATE orders SET payment_status = $2 WHERE id = $1", [id, overrides.paymentStatus]);
  }
  await pool.query(
    `INSERT INTO jubelio_sales_operation (id, order_id, type, status, attempt_count, reference, payload, sales_order_id, invoice_id, payment_id)
     VALUES ($1, $2, 'invoice', 'confirmed', 1, $1, '{}'::jsonb, 7001, 7101, 7201),
            ($3, $2, 'payment', 'confirmed', 1, $3, '{}'::jsonb, 7001, 7101, 7201)`,
    [`${id}-invoice`, id, `${id}-payment`]
  );
  if (overrides.shipmentState) {
    await pool.query(
      `INSERT INTO delivery_shipment
         (id, order_id, state, stored_request, attempt_count, packed_by,
          dispatched_by, booked_by, dispatched_at, booked_at, shipment_id,
          awb, tracking_url, quote_rates, booked_price, billed_price)
       VALUES ($1, $2, $3, '{"ref_no":"ref"}'::jsonb, 1, $4, $4, $4,
          now() - interval '5 days', CASE WHEN $3 = 'booked' THEN now() - interval '4 days' ELSE NULL END,
          CASE WHEN $3 = 'booked' THEN $6::integer ELSE NULL END,
          CASE WHEN $3 = 'booked' THEN $5 ELSE NULL END,
          'http://127.0.0.1:3112/tracking/x', '20000.00', CASE WHEN $3 = 'booked' THEN '25000.00'::numeric ELSE NULL END, NULL)`,
      [
        `${PREFIX}ship-${id}`,
        id,
        overrides.shipmentState,
        USER_HOME_ID,
        `FUPAWB${7101 + Object.values(FIXTURE_IDS).findIndex(value => value === id)}`,
        7101 + Object.values(FIXTURE_IDS).findIndex(value => value === id),
      ]
    );
  }
  if (overrides.latestStatus) {
    await pool.query(
      "UPDATE delivery_shipment SET latest_status = $2, latest_event_at = now() - interval '1 day' WHERE order_id = $1",
      [id, overrides.latestStatus]
    );
  }
  if (overrides.stuckEvidence) {
    // The physical evidence for the electronic-stuck case: the handoff stamp.
    await pool.query(
      "UPDATE delivery_shipment SET handed_over_at = now() - interval '3 days', handed_over_by = $2 WHERE order_id = $1",
      [id, USER_HOME_ID]
    );
  }
}

/** A ledger row with a >1 attempt count would mean a re-POST happened. */
async function countProviderCreatePosts(): Promise<number> {
  const rows = (
    await pool!.query(
      "SELECT count(*)::int AS n FROM delivery_shipment WHERE attempt_count > 1"
    )
  ).rows[0];
  return Number(rows.n ?? 0);
}

describe("createDeliveryFollowUp — list (scope + filters)", () => {
  it.skipIf(!dbReady)(
    "list respects Branch Scope per kind; cross-branch rows stay invisible; the completed late-issue order is excluded from the queue",
    async () => {
      if (!pool || !db) return;
      const followup = createDeliveryFollowUp(db);
      await seedOrder(FIXTURE_IDS.blocked, { blockedReason: "Sales-Order invoice unverified" });
      await seedOrder(FIXTURE_IDS.packingFailed, { failureCode: "damaged_goods" });
      await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: "booking_unknown" });
      await seedOrder(FIXTURE_IDS.returned, { shipmentState: "booked", latestStatus: "RETURNED" });
      await seedOrder(FIXTURE_IDS.issue, { shipmentState: "booked", latestStatus: "SHIPMENT_ISSUE" });
      await seedOrder(FIXTURE_IDS.stuck, { shipmentState: "booked", stuckEvidence: true });
      await seedOrder(FIXTURE_IDS.completedLateIssue, {
        status: "completed",
        shipmentState: "booked",
        latestStatus: "DELIVERED",
        manualReason: "selesai manual sebelumnya",
      });

      const list = (view: Parameters<ReturnType<typeof createDeliveryFollowUp>['list']>[0], kind: Parameters<ReturnType<typeof createDeliveryFollowUp>['list']>[1]) =>
        followup.list(view, kind) as Promise<Array<{ orderId: string }>>;

      // Each kind lists its own cases (own-branch Home A sees its rows).
      expect((await list(VIEW_HOME, "settlement")).map((r) => r.orderId)).toEqual(
        expect.arrayContaining([FIXTURE_IDS.blocked])
      );
      expect((await list(VIEW_HOME, "packing")).map((r) => r.orderId)).toContain(
        FIXTURE_IDS.packingFailed
      );
      expect((await list(VIEW_HOME, "booking")).map((r) => r.orderId)).toContain(
        FIXTURE_IDS.ambiguousBooking
      );
      expect((await list(VIEW_HOME, "shipment")).map((r) => r.orderId)).toEqual(
        expect.arrayContaining([FIXTURE_IDS.returned, FIXTURE_IDS.issue])
      );

      const all = (await list(VIEW_HOME, "all")).map((r) => r.orderId);
      expect(all).toContain(FIXTURE_IDS.blocked);
      expect(all).toContain(FIXTURE_IDS.packingFailed);
      expect(all).toContain(FIXTURE_IDS.ambiguousBooking);
      expect(all).toContain(FIXTURE_IDS.returned);
      expect(all).toContain(FIXTURE_IDS.issue);
      expect(all).toContain(FIXTURE_IDS.stuck);
      // The completed order must never resurface as an open follow-up.
      expect(all).not.toContain(FIXTURE_IDS.completedLateIssue);

      // A foreign-branch viewer cannot see branch A's cases…
      expect((await list(VIEW_FOREIGN, "all")).map((r) => r.orderId)).not.toContain(
        FIXTURE_IDS.blocked
      );
      // …but an all-branch viewer can.
      expect((await list(VIEW_ALL, "all")).map((r) => String(r.orderId))).toContain(
        FIXTURE_IDS.blocked
      );
      // A view flag that is denied yields zero rows — never a leak.
      expect((await list(VIEW_DENIED, "all")).length).toBe(0);
    }
  );
});

describe("createDeliveryFollowUp — failPacking", () => {
  it.skipIf(!dbReady)(
    "the three spec reasons are the only codes; the flagged order keeps paid/processing, blocks packing+booking, and stays audited",
    async () => {
      if (!pool || !db) return;
      const followup = createDeliveryFollowUp(db);
      await seedOrder(FIXTURE_IDS.plainBooked, { shipmentState: 'booked' });
      for (const reason of [
        "physical_stock_unavailable",
        "damaged_goods",
        "paid_service_limits_exceeded",
      ]) {
        await seedOrder(FIXTURE_IDS.packingFailed);
        await followup.failPacking(FIXTURE_IDS.packingFailed, ACTOR_HOME, reason);
        const row = (
          await pool!.query(
            `SELECT status, payment_status, delivery_failure_code,
                    delivery_failure_by IS NOT NULL AS byset,
                    delivery_failure_at IS NOT NULL AS atset
             FROM orders WHERE id = $1`,
            [FIXTURE_IDS.packingFailed]
          )
        ).rows[0];
        expect(row.status, `${reason}: the order stays processing`).toBe("processing");
        expect(row.payment_status).toBe("paid");
        expect(row.delivery_failure_code).toBe(reason);
        expect(row.byset).toBe(true);
        expect(row.atset).toBe(true);

        // The NORMAL pipeline refuses this order: the packing-failed flag
        // blocks the 05 shipment-fulfillment pack AND book (no provider call).
        const gateway = {
          createShipment: async () => {
            throw new Error("must never be called");
          },
        };
        const fulfillment = createShipmentFulfillment(db, gateway);
        await expect(fulfillment.pack(FIXTURE_IDS.packingFailed, ACTOR_HOME)).rejects.toThrow();
        await expect(fulfillment.book(FIXTURE_IDS.packingFailed, ACTOR_HOME)).rejects.toThrow();

        // The action is audited with the mandatory reason.
        const audit = (
          await pool!.query(
            "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%PACKING%'",
            [FIXTURE_IDS.packingFailed]
          )
        ).rows[0];
        expect(audit.n).toBeGreaterThanOrEqual(1);
      }

      // An invented/unknown reason is rejected with zero effects.
      await expect(
        followup.failPacking(FIXTURE_IDS.plainBooked, ACTOR_HOME, "invented_reason_code")
      ).rejects.toThrow();
      // The wrong Home Branch (even an owner/all-branch editor) + a no-edit
      // actor: denied, zero effects.
      await expect(
        followup.failPacking(FIXTURE_IDS.plainBooked, ACTOR_WRONG_BRANCH, "damaged_goods")
      ).rejects.toThrow();
      await expect(
        followup.failPacking(FIXTURE_IDS.plainBooked, ACTOR_NO_EDIT, "damaged_goods")
      ).rejects.toThrow();
      expect(
        (await pool!.query("SELECT delivery_failure_code FROM orders WHERE id = $1", [FIXTURE_IDS.plainBooked]))
          .rows[0].delivery_failure_code ?? null
      ).toBe(null);
    }
  );
});

describe('createDeliveryFollowUp — fresh authorization and settlement evidence', () => {
  it('rejects stale Home Branch and mismatched invoice ledger with zero effects', async () => {
    await seedOrder(FIXTURE_IDS.packingFailed);
    const followup = createDeliveryFollowUp(db);
    await pool.query('UPDATE "user" SET branch_id=$2 WHERE id=$1', [USER_HOME_ID, BRANCH_B_ID]);
    try { await expect(followup.failPacking(FIXTURE_IDS.packingFailed, ACTOR_HOME, 'damaged_goods')).rejects.toThrow(); }
    finally { await pool.query('UPDATE "user" SET branch_id=$2 WHERE id=$1', [USER_HOME_ID, BRANCH_A_ID]); }
    expect((await pool.query('SELECT delivery_failure_code FROM orders WHERE id=$1', [FIXTURE_IDS.packingFailed])).rows[0].delivery_failure_code).toBeNull();
    await pool.query("UPDATE jubelio_sales_operation SET invoice_id=9999 WHERE order_id=$1 AND type='invoice'", [FIXTURE_IDS.packingFailed]);
    await expect(followup.failPacking(FIXTURE_IDS.packingFailed, ACTOR_HOME, 'damaged_goods')).rejects.toThrow();
    expect((await pool.query('SELECT delivery_failure_code FROM orders WHERE id=$1', [FIXTURE_IDS.packingFailed])).rows[0].delivery_failure_code).toBeNull();
  });
});

describe("createDeliveryFollowUp — releaseBooking", () => {
  it.skipIf(!dbReady)(
    "release demands the trusted human proof for the CURRENT attempt (stale/false/simultaneous denied), preserves the original dispatch, keeps the attempt monotonic and never creates a booking",
    async () => {
      if (!pool || !db) return;
      const followup = createDeliveryFollowUp(db);
      const PROOF = {
        source: "jubelio_confirmation",
        reference: `JUBELIO-CONF-${PREFIX}`,
        reason: "Konfirmasi Jubelio: operasi pertama ditutup tanpa booking.",
        attemptNumber: 1,
        absenceConfirmed: true,
        operationClosed: true,
      };

      // A missing/false/stale-attribute proof is denied with no state change.
      await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: "booking_unknown" });
      await expect(followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, null)).rejects.toThrow();
      await expect(
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
          ...PROOF,
          absenceConfirmed: false,
        })
      ).rejects.toThrow();
      await expect(
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
          ...PROOF,
          operationClosed: false,
        })
      ).rejects.toThrow();
      await expect(
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
          ...PROOF,
          attemptNumber: 2,
        })
      ).rejects.toThrow();
      let state = (
        await pool!.query("SELECT state, attempt_count FROM delivery_shipment WHERE order_id = $1", [
          FIXTURE_IDS.ambiguousBooking,
        ])
      ).rows[0];
      expect(state.state).toBe("booking_unknown");
      expect(state.attempt_count).toBe(1);

      // The valid proof releases the hold with NO provider POST; the original
      // dispatch actor/time/request stay preserved and the attempt count is
      // NOT reset (monotonic).
      const released = await followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, PROOF);
      expect(released).toMatchObject({ status: "packed" });

      // The review row keeps the proof + the original dispatch history (per
      // ledger+attempt unique).
      const review = (
        await pool!.query(
          "SELECT count(*)::int AS n FROM delivery_booking_reviews WHERE order_id = $1 AND attempt_number = 1",
          [FIXTURE_IDS.ambiguousBooking]
        )
      ).rows[0];
      expect(review.n).toBe(1);

      // The audit of the release.
      const audit = (
        await pool!.query(
          "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%RELEASE%'",
          [FIXTURE_IDS.ambiguousBooking]
        )
      ).rows[0];
      expect(audit.n).toBeGreaterThanOrEqual(1);

      // The repeated SAME proof is denied (a new attempt requires NEW proof).
      await expect(
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, PROOF)
      ).rejects.toThrow();

      // A SIMULTANEOUS release attempt wins exactly once.
      await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: "booking_unknown" });
      const loser = createDeliveryFollowUp(db);
      const [winner, loserResult] = await Promise.allSettled([
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, PROOF),
        loser.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
          ...PROOF,
          reference: `${PROOF.reference}-simultan`,
        }),
      ]);
      expect(
        winner.status === "fulfilled" || loserResult.status === "fulfilled"
      ).toBe(true);
      state = (
        await pool!.query("SELECT state, attempt_count FROM delivery_shipment WHERE order_id = $1", [
          FIXTURE_IDS.ambiguousBooking,
        ])
      ).rows[0];
      expect(state.state).toBe("packed");
      expect(state.attempt_count).toBe(1);
      expect(
        (
          await pool!.query(
            "SELECT count(*)::int AS n FROM delivery_booking_reviews WHERE order_id = $1",
            [FIXTURE_IDS.ambiguousBooking]
          )
        ).rows[0].n
      ).toBe(1);
      expect(await countProviderCreatePosts()).toBe(0);

      // The LIVE booking_dispatched state can NEVER be proof-released: only
      // the settled booking_unknown is. The uncertain dispatch stays held
      // until certainty or an escalation outside the app.
      await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: "booking_dispatched" });
      await expect(
        followup.releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
          ...PROOF,
          reference: `JUBELIO-CONF-3-${PREFIX}`,
        })
      ).rejects.toThrow();
      expect(
        (await pool!.query("SELECT state FROM delivery_shipment WHERE order_id = $1", [FIXTURE_IDS.ambiguousBooking]))
          .rows[0].state
      ).toBe("booking_dispatched");
      expect(await countProviderCreatePosts()).toBe(0);
    }
  );
});

describe('proof-approved booking reattempt', () => {
  it('keeps attempt 1 history and permits only one provider create for attempt 2 across service instances', async () => {
    await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: 'booking_unknown' });
    await createDeliveryFollowUp(db).releaseBooking(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, {
      source: 'jubelio_confirmation', reference: 'SUPPORT-CLOSED-001', reason: 'Provider confirms the original request is closed with no booking.', attemptNumber: 1, absenceConfirmed: true, operationClosed: true,
    });
    let calls = 0;
    const gateway = { createShipment: async () => { calls++; return { shipment_id: 990071, awb: 'FUPRETRY990071', price: 25000, price_bill: 30000 }; } };
    const a = createShipmentFulfillment(db, gateway), b = createShipmentFulfillment(db, gateway);
    const results = await Promise.allSettled([a.book(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME), b.book(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME)]);
    expect(calls, results.map(result => result.status === 'rejected' ? String(result.reason) : 'booked').join('; ')).toBe(1);
    const row = (await pool.query('SELECT state,attempt_count FROM delivery_shipment WHERE order_id=$1', [FIXTURE_IDS.ambiguousBooking])).rows[0];
    expect(row.state).toBe('booked'); expect(row.attempt_count).toBe(2);
    expect((await pool.query('SELECT attempt_number FROM delivery_booking_reviews WHERE order_id=$1', [FIXTURE_IDS.ambiguousBooking])).rows.map(row => row.attempt_number)).toEqual([1]);
  });
});

describe("createDeliveryFollowUp — finishManually", () => {
  it.skipIf(!dbReady)(
    "manual finish completes only the RETURNED/ISSUE booked or the evidenced-stuck orders with a mandatory reason + audit; everything else is denied",
    async () => {
      if (!pool || !db) return;
      const followup = createDeliveryFollowUp(db);

      // The shipment issue before completion → a completed order, no code.
      await seedOrder(FIXTURE_IDS.returned, { shipmentState: "booked", latestStatus: "RETURNED" });
      await followup.finishManually(FIXTURE_IDS.returned, ACTOR_HOME, "Barang kembali; customer sudah dikompensasi di luar app.");
      let row = (
        await pool!.query(
          `SELECT status, payment_status, pickup_code, delivery_manual_reason,
                  delivery_manual_at IS NOT NULL AS atset, delivery_manual_by
           FROM orders WHERE id = $1`,
          [FIXTURE_IDS.returned]
        )
      ).rows[0];
      expect(row.status).toBe("completed");
      expect(row.payment_status).toBe("paid");
      expect(row.pickup_code ?? null).toBe(null);
      expect(row.delivery_manual_reason).toContain("kompensasi");
      expect(row.atset).toBe(true);
      expect(row.delivery_manual_by).toBe(USER_HOME_ID);
      const audit1 = (
        await pool!.query(
          "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE '%FINISH%'",
          [FIXTURE_IDS.returned]
        )
      ).rows[0];
      expect(audit1.n).toBeGreaterThanOrEqual(1);

      // The electronic stuck WITH the handoff evidence → completed.
      await seedOrder(FIXTURE_IDS.stuck, { shipmentState: "booked", stuckEvidence: true });
      await followup.finishManually(FIXTURE_IDS.stuck, ACTOR_HOME, "Bukti elektronik macet setelah barang diserahkan; selesai manual.");
      row = (
        await pool!.query("SELECT status, pickup_code FROM orders WHERE id = $1", [FIXTURE_IDS.stuck])
      ).rows[0];
      expect(row.status).toBe("completed");
      expect(row.pickup_code ?? null).toBe(null);

      // Denials — zero effects: a PLAIN booked order (the AWB alone is not
      // evidence), the ambiguous without evidence, the packing-failed, the
      // wrong-Home-Branch + the no-edit actor, and a blank reason.
      await seedOrder(FIXTURE_IDS.plainBooked, { shipmentState: "booked" });
      await expect(
        followup.finishManually(FIXTURE_IDS.plainBooked, ACTOR_HOME, "Alasan apapun")
      ).rejects.toThrow();
      await seedOrder(FIXTURE_IDS.ambiguousBooking, { shipmentState: "booking_unknown" });
      await expect(
        followup.finishManually(FIXTURE_IDS.ambiguousBooking, ACTOR_HOME, "Alasan apapun")
      ).rejects.toThrow();
      await seedOrder(FIXTURE_IDS.packingFailed, { failureCode: "damaged_goods" });
      await expect(
        followup.finishManually(FIXTURE_IDS.packingFailed, ACTOR_HOME, "Alasan apapun")
      ).rejects.toThrow();
      await expect(
        followup.finishManually(FIXTURE_IDS.packingFailed, ACTOR_WRONG_BRANCH, "Alasan")
      ).rejects.toThrow();
      await expect(
        followup.finishManually(FIXTURE_IDS.packingFailed, ACTOR_NO_EDIT, "Alasan")
      ).rejects.toThrow();
      await expect(
        followup.finishManually(FIXTURE_IDS.plainBooked, ACTOR_HOME, "   ")
      ).rejects.toThrow();
      expect(
        (await pool!.query("SELECT status FROM orders WHERE id = $1", [FIXTURE_IDS.plainBooked])).rows[0].status
      ).toBe("processing");
      expect(
        (await pool!.query("SELECT status FROM orders WHERE id = $1", [FIXTURE_IDS.packingFailed])).rows[0].status
      ).toBe("processing");
    }
  );
});

beforeAll(async () => {
  if (!pool) return;
  // Parent rows first (cascades), then the identities: FK-ordered.
  await pool.query(
    `DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND s.order_id LIKE '${PREFIX}order-%'`
  );
  await pool.query(`DELETE FROM delivery_shipment WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM delivery_booking_reviews WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%'`);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'followup-%'");
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'followup-%'");
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}branch-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}role-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);

  await pool.query(
    `INSERT INTO branch (id, name, code, city, address, status, shipping_phone, shipping_address, shipping_postal_code, shipping_area_id, jubelio_location_id)
     VALUES ($1, 'Followup Origin A', 'FUPA', 'Jakarta Pusat', 'Jl. Followup A', 'aktif', '021999888777', 'Jl. Followup Origin A', '10110', '01010101', 900011),
            ($2, 'Followup Other B', 'FUPB', 'Surabaya', 'Jl. Followup B', 'aktif', '0315550001', 'Jl. Followup B 2', '60275', '02020101', 900012)`,
    [BRANCH_A_ID, BRANCH_B_ID]
  );
  await pool.query(`INSERT INTO admin_role (id, name) VALUES ($1, $2), ($3, $4), ($5, $6)`, [
    ROLE_EDIT_ID, "Followup Editor",
    ROLE_VIEW_ID, "Followup Viewer",
    ROLE_OWNER_ID, "Followup OwnerAll",
  ]);
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES ($1, $2, 'orders', 'view', 'own_branch'),
            ($3, $2, 'orders', 'edit', 'own_branch'),
            ($4, $5, 'orders', 'view', 'own_branch'),
            ($6, $7, 'orders', 'view', 'all_branches'),
            ($8, $9, 'orders', 'edit', 'all_branches')`,
    [
      "gr-fup-e-view", ROLE_EDIT_ID, "gr-fup-e-edit",
      "gr-fup-v-view", ROLE_VIEW_ID,
      "gr-fup-o-view", ROLE_OWNER_ID, "gr-fup-o-edit", ROLE_OWNER_ID,
    ]
  );
  await pool.query(
    `INSERT INTO client (id, name, email, email_verified, phone, onboarding_completed)
     VALUES ($1, 'Followup Client', 'followup-client@example.test', true, '+628123456789', true)
     ON CONFLICT (id) DO NOTHING`,
    [`${PREFIX}client`]
  );
  await pool.query(
    `INSERT INTO "user" (id, name, username, display_username, email, email_verified, role_id, branch_id, is_active)
     VALUES ($1, 'Actor Home', 'fuphome', 'fuphome', 'fuphome@example.test', true, $2, $3, true),
            ($4, 'Actor ViewB', 'fupviewb', 'fupviewb', 'fupviewb@example.test', true, $5, $3, true),
            ($6, 'Actor All', 'fupall', 'fupall', 'fupall@example.test', true, $7, $8, true)`,
    [USER_HOME_ID, ROLE_EDIT_ID, BRANCH_A_ID, USER_VIEW_B_ID, ROLE_VIEW_ID, USER_ALL_ID, ROLE_OWNER_ID, BRANCH_B_ID]
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(
    `DELETE FROM delivery_tracking_event te USING delivery_shipment s WHERE te.shipment_id = s.id AND s.order_id LIKE '${PREFIX}order-%'`
  );
  await pool.query(`DELETE FROM delivery_shipment WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM delivery_booking_reviews WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM jubelio_sales_operation WHERE order_id LIKE '${PREFIX}order-%'`);
  await pool.query(`DELETE FROM orders WHERE id LIKE '${PREFIX}order-%'`);
  await pool.query("DELETE FROM admin_session WHERE user_id LIKE 'followup-%'");
  await pool.query("DELETE FROM admin_account WHERE user_id LIKE 'followup-%'");
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}user-%'`);
  await pool.query("DELETE FROM branch WHERE id LIKE $1", [`${PREFIX}branch-%`]);
  await pool.query("DELETE FROM admin_role WHERE id LIKE $1", [`${PREFIX}role-%`]);
  await pool.query("DELETE FROM client WHERE id LIKE $1", [`${PREFIX}-%`]);
  await pool.end();
});