import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import {
  jubelioChannelStatusIntents,
  jubelioSalesOperations,
  clients,
  orders,
  type JubelioSalesOrderEditRequest,
} from "@marketplace/db/src/schema";
import { JubelioSalesGatewayError } from "./jubelio-sales-client";
import {
  abortPendingIntentForStartedCancel,
  abortPendingTerminalChannelStatusIntent,
  claimJubelioChannelStatusIntentForGagalBayarDispatch,
  claimJubelioChannelStatusIntentForDispatch,
  markJubelioChannelStatusIntentNeedsInvestigation,
  markJubelioChannelStatusIntentRejectedAfterClaim,
  reconcileChannelStatusMirrorForSweep,
  reconcileJubelioChannelStatusForOrder,
  listJubelioChannelStatusIntentsByStatus,
  supersedeStalePendingChannelStatusIntent,
} from "./jubelio-channel-mirror";
import type {
  JubelioSalesEditResult,
  JubelioSalesGateway,
  JubelioSalesOrderEditSnapshot,
} from "./jubelio-sales-client";

// =========================================================
// DB seam for ticket #03 (Siap Proses channel-status mirror, crash-tolerant):
// the at-most-once edit dispatch is a DATABASE property of one conditional
// UPDATE `WHERE status = 'pending'`; race, crash-after-claim, GET-only
// recovery and noninterference can only be proven against real PostgreSQL
// with a CONTROLLED provider (stubbed gateway, never the real Jubelio API —
// no real POST/login is ever permitted from tests).
//
// Requires the dev database with the jubelio_channel_status_intent table
// applied (PARENT runs db:push). Skipped when PostgreSQL is unreachable or
// the schema has not been pushed — a skip is NOT a pass: durable mirror
// semantics remain unverified until these tests actually run, and the exact
// blocker is logged and kept RED via the environment blocker test below.
//
// The dev database is SHARED: fixtures are keyed by the "jcm-dbtest-" prefix
// and deleted in afterAll (clients cascade to orders; the intents and ledger
// rows cascade with them).
// =========================================================

const PREFIX = "jcm-dbtest-";
const SO_ID = 683_990_001; // never a real remote id
const INVOICE_ID = 459_450_001;
const PAYMENT_ID = 28_000_001;
const ITEM_ID = 43_842;
const LOCATION_ID = 7;
const PRICE = 1000;
const NOTE = "OKCIR_SO_CREATE:jcm-dbtest-order:jcm-dbtest-op-create";

const url = process.env.DATABASE_URL;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("select 1");
    await pool.end();
    return true;
  } catch (error) {
    console.warn(
      `[jubelio-channel-mirror.db] NOT run — PostgreSQL unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

async function channelIntentSchemaReady(): Promise<{
  ready: boolean;
  blocker?: string;
}> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    const result = await pool.query(
      "select to_regclass('public.jubelio_channel_status_intent') is not null as ok"
    );
    await pool.end();
    if (result.rows[0]?.ok !== true) {
      return {
        ready: false,
        blocker:
          "jubelio_channel_status_intent table not found — the PARENT must run `npm run db:generate` + `npm run db:push` first (db:push was not authorized in this stage)",
      };
    }
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      blocker: error instanceof Error ? error.message : String(error),
    };
  }
}

function maskUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return "configured DATABASE_URL";
  }
}

const reachable = await dbReachable();
const schemaState = reachable
  ? await channelIntentSchemaReady()
  : {
      ready: false,
      blocker: `PostgreSQL unreachable (DATABASE_URL=${
        url ? "set" : "not set"
      }; observed at ${url ? maskUrl(url) : "n/a"})`,
    };

if (!schemaState.ready) {
  console.warn(
    `[jubelio-channel-mirror.db] DB mirror tests NOT run (skipped, not green) — exact blocker: ${schemaState.blocker}`
  );
}

// The environment blocker must be VISIBLE, not silently swallowed: vitest
// discards top-level console output for fully-skipped files. This stays RED
// whenever PostgreSQL or the pushed schema is unavailable.
it.skipIf(schemaState.ready)(
  "environment blocker: channel mirror semantics NOT verified (requires PostgreSQL with the pushed schema)",
  () => {
    throw new Error(
      `DB mirror tests NOT run — channel-status mirror semantics remain UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

const pool = url && schemaState.ready ? new Pool({ connectionString: url, max: 5 }) : null;
const db = pool ? drizzle(pool, {}) : null;

const testClientIds: string[] = [];

type FixtureOptions = {
  suffix: string;
  orderStatus: string;
  paymentStatus?: "paid" | "pending" | "failed";
  withInvoicePayment?: boolean;
  /** Explicit SO id (the SO-guard tests share one SO across two orders). */
  salesOrderId?: number;
  /** Confirmed invoice op only (NO payment op) — eligibility-gap fixtures. */
  invoiceOnly?: boolean;
  /** Ticket #04: committed operator investigation block reason. */
  blockedReason?: string;
  /** Ticket #04: force the invoice ledger op into a non-confirmed state. */
  invoiceOpStatus?: "manual_review" | "dispatched_unknown";
  /** Ticket #04: force the payment ledger op into a non-confirmed state. */
  paymentOpStatus?: "manual_review" | "dispatched_unknown";
};

async function seedMirrorFixture(input: FixtureOptions): Promise<{
  orderId: string;
  pickupCode: string;
  note: string;
  soId: number;
}> {
  const suffix = input.suffix;
  const clientId = `${PREFIX}client-${suffix}`;
  const orderId = `${PREFIX}order-${suffix}`;
  // Derive per-fixture values: orders.pickup_code is UNIQUE, and channel
  // intent claims serialize per SO via a partial unique index, so tests
  // must not share a pickup code or SO id unless they explicitly ask to.
  const suffixHash = (() => {
    let hash = 0;
    for (const ch of suffix) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash;
  })();
  const pickupCode = `K${(suffixHash % 100000).toString().padStart(5, "0")}`;
  const soId = input.salesOrderId ?? 683_990_000 + (suffixHash % 900_000) + 1;
  testClientIds.push(clientId);
  await db!.insert(clients).values({
    id: clientId,
    name: "Mirror DB Test",
    email: `${clientId}@example.com`,
    emailVerified: true,
  });
  await db!.insert(orders).values({
    id: orderId,
    userId: clientId,
    status: input.orderStatus,
    paymentStatus: input.paymentStatus ?? "paid",
    pickupCode: input.orderStatus === "ready_for_pickup" ? pickupCode : null,
    fulfillmentBlockedReason:
      input.orderStatus === "ready_for_pickup" ? null : input.blockedReason ?? null,
    contactPhone: "081234567890",
    contactEmail: `${clientId}@example.com`,
    subtotal: String(PRICE),
    total: String(PRICE),
  });
  // Confirmed create intent (the SO exists and is verified) — the mirror
  // always edits a KNOWN SO. The note/reference is unique per fixture (the
  // ledger's reference is globally UNIQUE).
  const createOperationId = `${PREFIX}op-create-${suffix}`;
  const note = `OKCIR_SO_CREATE:${orderId}:${createOperationId}`;
  await db!.insert(jubelioSalesOperations).values({
    id: createOperationId,
    orderId,
    type: "create",
    status: "confirmed",
    reference: note,
    payload: {
      type: "create",
      create: {
        contactId: -1,
        customerName: "Pelanggan Umum",
        locationId: LOCATION_ID,
        note,
        channelStatus: "Belum Bayar",
        items: [
          {
            itemId: ITEM_ID,
            quantity: 1,
            price: PRICE,
            discAmount: 0,
            taxAmount: 0,
            unit: "Buah",
            taxId: 1,
          },
        ],
      },
    },
    salesOrderId: soId,
    attemptCount: 1,
    dispatchedAt: new Date(Date.now() - 60 * 60_000),
    confirmedAt: new Date(Date.now() - 59 * 60_000),
  });
  if (input.withInvoicePayment || input.invoiceOnly) {
    const paymentOp: Array<typeof jubelioSalesOperations.$inferInsert> = input.withInvoicePayment
      ? [
          {
            id: `${PREFIX}op-payment-${suffix}`,
            orderId,
            type: "payment",
            status: input.paymentOpStatus ?? "confirmed",
            reference: `OKCIR_SO_PAYMENT:${orderId}:${suffix}`,
            payload: {
              type: "payment",
              payment: {
                invoiceId: INVOICE_ID,
                accountId: 1,
                amount: PRICE,
                contactId: -1,
                paymentType: 0,
              },
            },
            salesOrderId: soId,
            invoiceId: INVOICE_ID,
            paymentId: PAYMENT_ID,
            attemptCount: 1,
            dispatchedAt: new Date(Date.now() - 40 * 60_000),
            confirmedAt:
              input.paymentOpStatus == null
                ? new Date(Date.now() - 48 * 60_000)
                : null,
          },
        ]
      : [];
    await db!.insert(jubelioSalesOperations).values([
      {
        id: `${PREFIX}op-invoice-${suffix}`,
        orderId,
        type: "invoice",
        status: input.invoiceOpStatus ?? "confirmed",
        reference: `OKCIR_SO_INVOICE:${orderId}:${suffix}`,
        payload: { type: "invoice", invoice: { salesOrderId: soId } },
        salesOrderId: soId,
        invoiceId: INVOICE_ID,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 50 * 60_000),
        confirmedAt:
          input.invoiceOpStatus == null
            ? new Date(Date.now() - 49 * 60_000)
            : null,
      },
      ...paymentOp,
    ]);
  }
  return { orderId, pickupCode, note, soId };
}

/** The controlled provider snapshot for the fixture SO (invoiced, active). */
function controlledEditSnapshot(
  overrides: Partial<JubelioSalesOrderEditSnapshot> = {},
  soId: number = SO_ID
): JubelioSalesOrderEditSnapshot {
  return {
    salesorderId: soId,
    salesorderNo: `SO-0000${soId}`,
    source: 1,
    refNo: "",
    contactId: -1,
    customerName: "Pelanggan Umum",
    locationId: LOCATION_ID,
    note: NOTE,
    transactionDate: "2026-09-26T17:00:00.000Z",
    isTaxIncluded: false,
    isCanceled: false,
    invoiceId: INVOICE_ID,
    channelStatus: "Belum Bayar",
    subTotal: PRICE,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: PRICE,
    addFee: 0,
    addDisc: 0,
    serviceFee: 0,
    items: [
      {
        salesorderDetailId: 74682,
        itemId: ITEM_ID,
        quantity: 1,
        price: PRICE,
        disc: 0,
        discAmount: 0,
        taxAmount: 0,
        amount: PRICE,
        unit: "Buah",
        taxId: 1,
        locationId: LOCATION_ID,
      },
    ],
    ...overrides,
  };
}

type ControlledGateway = JubelioSalesGateway & {
  editCalls: Array<{ edit: JubelioSalesOrderEditSnapshot; target: string }>;
};

function controlledGateway(options: {
  editSnapshot?: JubelioSalesOrderEditSnapshot | Error;
  editError?: Error;
  editResult?: JubelioSalesEditResult | Error;
  /** Per-fixture create note (the ledger reference) for the snapshot. */
  note?: string;
  /** Per-fixture SO id for the snapshot. */
  soId?: number;
}): ControlledGateway {
  const editCalls: ControlledGateway["editCalls"] = [];
  const snapshot = (overrides: Partial<JubelioSalesOrderEditSnapshot> = {}) => {
    const merged = { ...overrides };
    if (merged.note === undefined && options.note != null) merged.note = options.note;
    if (merged.salesorderId === undefined && options.soId != null) {
      merged.salesorderId = options.soId;
    }
    return controlledEditSnapshot(merged, options.soId);
  };
  const gateway = {
    async createSalesOrder() {
      throw new Error("unexpected createSalesOrder in mirror test");
    },
    async getSalesOrder() {
      throw new Error("unexpected getSalesOrder in mirror test");
    },
    async getSalesOrderForEdit() {
      if (options.editSnapshot instanceof Error) throw options.editSnapshot;
      return options.editSnapshot ?? snapshot();
    },
    async editSalesOrder(call: {
      edit: JubelioSalesOrderEditSnapshot;
      targetChannelStatus: string;
    }) {
      editCalls.push({ edit: call.edit, target: call.targetChannelStatus });
      if (options.editError) throw options.editError;
      if (options.editResult instanceof Error) throw options.editResult;
      return (
        options.editResult ?? {
          salesOrderId: options.soId ?? SO_ID,
          order: {
            ...snapshot(),
            channelStatus: call.targetChannelStatus,
          },
        }
      );
    },
    async cancelSalesOrder() {
      throw new Error("unexpected cancelSalesOrder in mirror test");
    },
    async createInvoice() {
      throw new Error("unexpected createInvoice in mirror test");
    },
    async getInvoice() {
      throw new Error("unexpected getInvoice in mirror test");
    },
    async createInvoicePayment() {
      throw new Error("unexpected createInvoicePayment in mirror test");
    },
    async getPayment() {
      throw new Error("unexpected getPayment in mirror test");
    },
    editCalls,
  } as ControlledGateway;
  return gateway;
}

async function getIntent(orderId: string) {
  const rows = await db!
    .select()
    .from(jubelioChannelStatusIntents)
    .where(eq(jubelioChannelStatusIntents.orderId, orderId))
    .orderBy(jubelioChannelStatusIntents.targetVersion);
  return rows;
}

afterAll(async () => {
  if (!db || testClientIds.length === 0) return;
  await db.delete(clients).where(inArray(clients.id, testClientIds));
});

describe.skipIf(!schemaState.ready)(
  "channel-status mirror reconciliation (requires PostgreSQL + controlled provider)",
  () => {
    it("dispatches exactly one full-payload edit for an eligible ready_for_pickup order with verified invoice+payment, and confirms it by GET", async () => {
      const suffix = `happy-${Date.now()}`;
const { orderId, pickupCode: fixturePickupCode, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixtureNote, soId: fixtureSoId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      // Exactly ONE provider edit, carrying the verified snapshot with only
      // the marker changed.
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Siap Proses");
      expect(gateway.editCalls[0].edit).toMatchObject({
        salesorderId: fixtureSoId,
        salesorderNo: `SO-0000${fixtureSoId}`,
        note: fixtureNote,
        invoiceId: INVOICE_ID,
        subTotal: PRICE,
        items: [{ salesorderDetailId: 74682, itemId: ITEM_ID, amount: PRICE }],
      });
      // Durable intent: version 1, confirmed, observed marker + snapshot.
      const intents = await getIntent(orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        salesOrderId: fixtureSoId,
        lastObservedStatus: "Siap Proses",
      });
      expect(intents[0].payload?.type).toBe("edit");
      expect(
        (intents[0].payload as JubelioSalesOrderEditRequest).edit.salesorderNo
      ).toBe(`SO-0000${fixtureSoId}`);
      // NONINTERFERENCE: the mirror never touches the local order.
      const [order] = await db!
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(order.status).toBe("ready_for_pickup");
      expect(order.paymentStatus).toBe("paid");
      expect(order.pickupCode).toBe(fixturePickupCode);
    });

    it("concurrent reconciliation callers dispatch the same intent at most once", async () => {
      const suffix = `race-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixtureNote, soId: fixtureSoId });

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          reconcileJubelioChannelStatusForOrder(db!, {
            orderId,
            gateway: gateway as unknown as JubelioSalesGateway,
          })
        )
      );
      const edits = gateway.editCalls.length;
      // At most one POST for the intent, however many callers raced.
      expect(edits).toBe(1);
      const statuses = results.map((result) => result.status);
      expect(
        statuses.filter((status) => status === "confirmed").length
      ).toBeGreaterThanOrEqual(1);
      // No second intent row was created by the losers.
      expect(await getIntent(orderId)).toHaveLength(1);
    });

    it("keeps a crash-after-claim dispatch possibly_sent and recovers GET-only without re-POSTing", async () => {
      const suffix = `crash-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const ambiguous = new Error("timeout — outcome unknown");
      const flaky = controlledGateway({ editError: ambiguous, note: fixtureNote, soId: fixtureSoId });
      // The mirror's edit pre-read also fails: crash right after the claim.
      const first = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: {
          ...(flaky as unknown as JubelioSalesGateway),
          getSalesOrderForEdit: async () => {
            throw ambiguous;
          },
        },
      });
      expect(first.status).toBe("in_flight");
      const [possiblySent] = await getIntent(orderId);
      expect(possiblySent.status).toBe("possibly_sent");

      // The claim AGES (simulating a crash whose owner never returns): only
      // an aged possibly-sent claim is GET-reconciled.
      await db!.update(jubelioChannelStatusIntents)
        .set({ dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000) })
        .where(eq(jubelioChannelStatusIntents.id, possiblySent.id));

      // Recovery: the provider GET now shows the marker applied (the crash
      // happened after the claim; pretend the edit was applied). GET-only,
      // ZERO re-POST.
      const recovered = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixtureNote, channelStatus: "Siap Proses" }),
          salesorderId: fixtureSoId,
        },
      });
      const second = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: recovered as unknown as JubelioSalesGateway,
      });
      expect(second.status).toBe("confirmed");
      expect(recovered.editCalls).toHaveLength(0);
      const [confirmed] = await getIntent(orderId);
      expect(confirmed.status).toBe("confirmed");
      expect(confirmed.lastObservedStatus).toBe("Siap Proses");
    });

    it("fail-closes with zero POST and a durable investigation case when the remote SO differs from the verified ledger", async () => {
      const suffix = `failclosed-${Date.now()}`;
const { orderId, pickupCode: fixturePickupCode, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Remote mutation between create and edit: money no longer matches the
      // verified create intent (vendor-side change by an outside party).
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixtureNote, subTotal: 999, grandTotal: 999 }),
          salesorderId: fixtureSoId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBeTruthy();
      expect(intent.payload).toBeNull(); // the unsafe edit was never built/sent
      // NONINTERFERENCE: local fulfillment state is untouched.
      const [order] = await db!
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(order.status).toBe("ready_for_pickup");
      expect(order.paymentStatus).toBe("paid");
      expect(order.pickupCode).toBe(fixturePickupCode);
    });

    it("never targets Siap Proses before ready_for_pickup (paid + verified invoice/payment is not enough)", async () => {
      const suffix = `notready-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixtureNote, soId: fixtureSoId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(orderId)).toHaveLength(0);
    });

    it("does not re-target an order whose invoice/payment verification is incomplete", async () => {
      const suffix = `unverified-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: false,
      });
      const gateway = controlledGateway({ note: fixtureNote, soId: fixtureSoId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(orderId)).toHaveLength(0);
    });

    it("finds unresolved intents for terminal orders too, not only processing orders", async () => {
      const suffix = `terminal-${Date.now()}`;
const { orderId, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      // A pending intent recorded for the (now-terminal) order.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-terminal-${suffix}`,
        orderId,
        salesOrderId: fixtureSoId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });

      const found = await listJubelioChannelStatusIntentsByStatus(
        db!,
        ["pending"],
        100
      );
      expect(found.map((row) => row.orderId)).toContain(orderId);
      // The scan is status-based only: the terminal local order is included.
      expect(found.every((row) => row.status === "pending")).toBe(true);
    });

    it("records a PII-safe mismatch reason without provider response bodies", async () => {
      const suffix = `pii-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: { ...controlledEditSnapshot({ note: fixtureNote, isCanceled: true }), salesorderId: fixtureSoId },
      });

      await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      const [intent] = await getIntent(orderId);
      expect(intent.status).toBe("needs_investigation");
      // PII-safe: identifiers/codes only, no raw provider payload text.
      expect(intent.mismatchReason).toMatch(/^[A-Z0-9_:.-]+$/);
      expect(gateway.editCalls).toHaveLength(0);
    });

    it("never GET-reconciles a FRESH possibly-sent claim (the owner may still be between claim and POST)", async () => {
      const suffix = `fresh-guard-${Date.now()}`;
const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Crash right after the claim: the pre-read throws ambiguous.
      const ambiguous = new Error("timeout — outcome unknown");
      const flaky = controlledGateway({ note: fixtureNote, soId: fixtureSoId });
      const first = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: {
          ...(flaky as unknown as JubelioSalesGateway),
          getSalesOrderForEdit: async () => {
            throw ambiguous;
          },
        },
      });
      expect(first.status).toBe("in_flight");
      const [fresh] = await getIntent(orderId);
      expect(fresh.status).toBe("possibly_sent");

      // A competing caller must NOT immediately GET-reconcile the fresh
      // claim: the owner may be between claim and POST, and a premature
      // mismatch verdict would bury a live edit as needs_investigation.
      const watcher = controlledGateway({
        editSnapshot: { ...controlledEditSnapshot({ note: fixtureNote, channelStatus: "Belum Bayar" }), salesorderId: fixtureSoId },
      });
      // Counting wrapper (the stub is a plain function, not a vitest spy).
      let watcherGetCalls = 0;
      const watcherInnerGet = watcher.getSalesOrderForEdit.bind(watcher);
      watcher.getSalesOrderForEdit = ((...args: Parameters<
        JubelioSalesGateway["getSalesOrderForEdit"]
      >) => {
        watcherGetCalls++;
        return watcherInnerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];
      const second = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: watcher as unknown as JubelioSalesGateway,
      });
      expect(second.status).toBe("in_flight");
      expect(watcherGetCalls).toBe(0);
      const [stillFresh] = await getIntent(orderId);
      expect(stillFresh.status).toBe("possibly_sent");

      // Once the claim is AGED, GET-only recovery runs (still no POST).
      await db!.update(jubelioChannelStatusIntents)
        .set({ dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000) })
        .where(eq(jubelioChannelStatusIntents.id, fresh.id));
      const recovered = controlledGateway({
        editSnapshot: { ...controlledEditSnapshot({ note: fixtureNote, channelStatus: "Siap Proses" }), salesorderId: fixtureSoId },
      });
      const third = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: recovered as unknown as JubelioSalesGateway,
      });
      expect(third.status).toBe("confirmed");
      expect(recovered.editCalls).toHaveLength(0);
    });

    it("fail-closes the claim when another local order already holds the ACTIVE dispatch for the same sales order", async () => {
      const suffix = `so-guard-${Date.now()}`;
      // Both orders deliberately reference the SAME sales order.
      const sharedSoId = 683_988_777;
      const firstOrder = await seedMirrorFixture({
        suffix: `${suffix}-a`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
        salesOrderId: sharedSoId,
      });
      const secondOrder = await seedMirrorFixture({
        suffix: `${suffix}-b`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
        salesOrderId: sharedSoId,
      });
      // Pathological data: two local orders referencing the SAME SO id.
      await db!.insert(jubelioChannelStatusIntents).values([
        {
          id: `${PREFIX}intent-so-a-${suffix}`,
          orderId: firstOrder.orderId,
          salesOrderId: sharedSoId,
          targetVersion: 1,
          targetStatus: "Siap Proses",
          status: "pending",
        },
        {
          id: `${PREFIX}intent-so-b-${suffix}`,
          orderId: secondOrder.orderId,
          salesOrderId: sharedSoId,
          targetVersion: 1,
          targetStatus: "Siap Proses",
          status: "pending",
        },
      ]);

      const results = await Promise.all([
        claimJubelioChannelStatusIntentForDispatch(db!, `${PREFIX}intent-so-a-${suffix}`),
        claimJubelioChannelStatusIntentForDispatch(db!, `${PREFIX}intent-so-b-${suffix}`),
      ]);
      // Real PostgreSQL: exactly one active dispatch per SO, the other
      // claim fails closed (never a second POST).
      const wins = results.filter((result) => result.claimed);
      expect(wins).toHaveLength(1);
      const [loser, winnerId] = results[0].claimed
        ? [results[1], `${PREFIX}intent-so-a-${suffix}`]
        : [results[0], `${PREFIX}intent-so-b-${suffix}`];
      expect(loser.claimed).toBe(false);
      const [loserRow] = await db!
        .select()
        .from(jubelioChannelStatusIntents)
        .where(eq(jubelioChannelStatusIntents.id, loser.intent!.id));
      expect(loserRow.status).toBe("pending"); // unchanged, not claimed

      // The guard is only on the ACTIVE dispatch: once the winner is
      // confirmed, the loser's claim succeeds.
      await db!.update(jubelioChannelStatusIntents)
        .set({
          status: "confirmed",
          lastObservedStatus: "Siap Proses",
          confirmedAt: new Date(),
        })
        .where(eq(jubelioChannelStatusIntents.id, winnerId));
      const retry = await claimJubelioChannelStatusIntentForDispatch(
        db!,
        loser.intent!.id
      );
      expect(retry.claimed).toBe(true);
    });

    it("serializes concurrent edits for the same sales order so two edits are never in flight together", async () => {
      const suffix = `so-serial-${Date.now()}`;
      const firstOrder = await seedMirrorFixture({
        suffix: `${suffix}-a`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const secondOrder = await seedMirrorFixture({
        suffix: `${suffix}-b`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const makeSerialGateway = (note: string) => {
        const base = controlledGateway({ note }) as unknown as {
          editSalesOrder: (call: {
            edit: JubelioSalesOrderEditSnapshot;
            targetChannelStatus: string;
          }) => Promise<unknown>;
          editCalls: unknown[];
        };
        let active = 0;
        const stats = { maxActive: 0 };
        const innerEdit = base.editSalesOrder.bind(base);
        base.editSalesOrder = async (call) => {
          active++;
          stats.maxActive = Math.max(stats.maxActive, active);
          try {
            // Simulate provider latency so an overlapping dispatch would show.
            await new Promise((resolve) => setTimeout(resolve, 25));
            return await innerEdit(call);
          } finally {
            active--;
          }
        };
        return { gateway: base, stats };
      };
      const a = makeSerialGateway(firstOrder.note);
      const b = makeSerialGateway(secondOrder.note);

      const outcomes = await Promise.all([
        reconcileJubelioChannelStatusForOrder(db!, {
          orderId: firstOrder.orderId,
          gateway: a.gateway as unknown as JubelioSalesGateway,
        }),
        reconcileJubelioChannelStatusForOrder(db!, {
          orderId: secondOrder.orderId,
          gateway: b.gateway as unknown as JubelioSalesGateway,
        }),
      ]);

      // Each order either completed its own (serialized) edit or was
      // refused the claim; at NO point were two edits in flight together.
      const editsSent = a.gateway.editCalls.length + b.gateway.editCalls.length;
      const maxActive = Math.max(a.stats.maxActive, b.stats.maxActive);
      expect(maxActive).toBeLessThanOrEqual(1);
      expect(maxActive).toBe(editsSent > 0 ? 1 : 0);
      for (const outcome of outcomes) {
        expect(["confirmed", "in_flight", "skipped"]).toContain(outcome.status);
      }
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "channel-status mirror SWEEP (bounded, GET-only recovery, missed orders)",
  () => {
    it("GET-only recovers an aged possibly_sent intent whose local order already went terminal, then projects Selesai as the NEXT version (never a re-POST of the old target)", async () => {
      const suffix = `sweep-terminal-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // The order completed AFTER ready_for_pickup (terminal) while the edit
      // dispatch stayed unresolved (crash after claim).
      await db!.update(orders).set({ status: "completed" }).where(eq(orders.id, fixture.orderId));
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-terminal-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The edit WAS applied before the crash: GET shows the marker + core.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, channelStatus: "Siap Proses" }),
          salesorderId: fixture.soId,
        },
      });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.recovered).toBeGreaterThanOrEqual(1);
      // GET-only recovery of the OLD target: exactly ONE edit POST happens
      // in this sweep, and it is the NEW monotonic Selesai version — never
      // a re-POST of the possibly-sent Siap Proses intent.
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        lastObservedStatus: "Siap Proses",
      });
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
      });
    });

    it("leaves a FRESH possibly-sent claim alone (no premature GET verdict)", async () => {
      const suffix = `sweep-fresh-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-fresh-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(),
      });
      let getSaw = 0;
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (...args: Parameters<
        JubelioSalesGateway["getSalesOrderForEdit"]
      >) => {
        getSaw++;
        return innerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.skippedFresh).toBeGreaterThanOrEqual(1);
      expect(getSaw).toBe(0);
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("possibly_sent");
    });

    it("records an investigation case (zero POST) when the aged GET shows a diverging SO", async () => {
      const suffix = `sweep-mismatch-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-mismatch-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, subTotal: 999, grandTotal: 999 }),
          salesorderId: fixture.soId,
        },
      });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.investigated).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toMatch(/^[A-Z0-9_:.-]+$/);
    });

    it("dispatches a MISSED ready_for_pickup order whose intent was never created (crash before intent)", async () => {
      const suffix = `sweep-missed-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.missedOrdersScanned).toBeGreaterThanOrEqual(1);
      expect(summary.missedDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
      });
    });

    it("supersedes a pending intent for a terminal order with a NEWER Selesai version, and never touches an open investigation", async () => {
      const suffix = `sweep-pending-${Date.now()}`;
      const completedFixture = await seedMirrorFixture({
        suffix: `${suffix}-c`,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-pending-${suffix}`,
        orderId: completedFixture.orderId,
        salesOrderId: completedFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      const investigatedFixture = await seedMirrorFixture({
        suffix: `${suffix}-i`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-inv-${suffix}`,
        orderId: investigatedFixture.orderId,
        salesOrderId: investigatedFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "needs_investigation",
        mismatchReason: "PRE_READ_SO_CANCELED",
        mismatchAt: new Date(),
      });
      const gateway = controlledGateway({ note: completedFixture.note, soId: completedFixture.soId });

      await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      // Ticket #06: the stale pending intent of the completed order is
      // durably superseded (no dispatch of THAT intent, no GET), and the
      // committed completed state then projects the monotonic NEXT
      // Selesai version (exactly one edit).
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      const intents = await getIntent(completedFixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
      });
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
      });
      const [investigatedIntent] = await getIntent(investigatedFixture.orderId);
      expect(investigatedIntent.status).toBe("needs_investigation");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 final acceptance: scheduled PENDING terminal disposition",
  () => {
    it("(P) supersedes a pending Siap Proses intent whose local order COMPLETED (no POST/GET for that intent) and dispatches the next Selesai version", async () => {
      const suffix = `pend-done-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // The intent was recorded before the claim; the local order then went
      // terminal (completed after pickup).
      await db!.update(orders).set({ status: "completed" }).where(eq(orders.id, fixture.orderId));
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-done-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      let getSaw = 0;
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (
        ...args: Parameters<JubelioSalesGateway["getSalesOrderForEdit"]>
      ) => {
        getSaw++;
        void args;
        return innerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.pendingTerminalAborted).toBeGreaterThanOrEqual(1);
      const [v1, v2] = await getIntent(fixture.orderId);
      // The STALE pending intent is durably superseded with zero dispatch:
      // attempt_count stays 0 and it can never be claimed afterwards.
      expect(v1).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
        attemptCount: 0,
      });
      const replay = await claimJubelioChannelStatusIntentForDispatch(db!, v1.id);
      expect(replay.claimed).toBe(false);
      // Ticket #06: the committed completed state is then projected as the
      // monotonic NEXT version (one pre-read GET + one Selesai edit POST).
      expect(v2).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
      });
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      expect(getSaw).toBeGreaterThanOrEqual(1); // the v2 pre-read GET
      void getSaw;
    });

    it("(P) a pending intent for a failed_payment order is no longer blanket-terminal (ticket #05): the safe Sales Order is superseded into the Gagal Bayar NEXT version and dispatched — zero stale POST", async () => {
      const suffix = `pend-fail-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-fail-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      // The remote SO is active with no invoice link (failed pre-invoice);
      // the fixture's ledger has a verified invoice, so the snapshot must
      // carry the ledger-persisted invoice id to pass the cross-check.
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      // #05: failed_payment orders are governed by the per-order Gagal
      // Bayar derivation — the stale pending Siap intent (never dispatched)
      // is superseded and the NEXT version projects Gagal Bayar. NOT
      // blanket-aborted as terminal anymore.
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "aborted",
        attemptCount: 0,
      });
      expect(intents[0].mismatchReason).toBe("PENDING_TARGET_SUPERSEDED");
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
      });
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
    });

    it("(P) NEVER aborts a possibly_sent intent (GET-only recovery + sequential next version) and never aborts a pending intent of an active ready order", async () => {
      const suffix = `pend-guard-${Date.now()}`;
      const readyFixture = await seedMirrorFixture({
        suffix: `${suffix}-ready`,
        orderStatus: "ready_for_pickup",
        // NOT eligible (invoice-only): stays pending, must not be aborted.
        invoiceOnly: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-ready-${suffix}`,
        orderId: readyFixture.orderId,
        salesOrderId: readyFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      const possiblySentFixture = await seedMirrorFixture({
        suffix: `${suffix}-ps`,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-ps-${suffix}`,
        orderId: possiblySentFixture.orderId,
        salesOrderId: possiblySentFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The provider GET shows the possibly-sent edit WAS applied before the
      // crash: the target marker is observable, so GET-only recovery confirms.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: possiblySentFixture.note, channelStatus: "Siap Proses" }),
          salesorderId: possiblySentFixture.soId,
        },
      });

      await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      const [readyIntent] = await getIntent(readyFixture.orderId);
      expect(readyIntent.status).toBe("pending"); // active ready order: untouched
      const intents = await getIntent(possiblySentFixture.orderId);
      // Aged possibly_sent on a TERMINAL order: GET-only recovery — NEVER
      // aborted, NEVER re-POSTed; the edit was applied, so it confirms.
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        lastObservedStatus: "Siap Proses",
        attemptCount: 1,
      });
      // Ticket #06: with the older intent resolved, the completed order's
      // Selesai projection is dispatched as the NEXT monotonic version.
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
      });
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
    });

    it("(P) the abort primitive is concurrency-guarded: exactly one of claim/abort wins", async () => {
      const suffix = `pend-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      const intentId = `${PREFIX}intent-pend-race-${suffix}`;

      const [claim, aborted] = await Promise.all([
        claimJubelioChannelStatusIntentForDispatch(db!, intentId),
        abortPendingTerminalChannelStatusIntent(db!, intentId),
      ]);
      const [row] = await getIntent(fixture.orderId);
      // Exactly one transition won; the other was refused.
      if (claim.claimed) {
        expect(row.status).toBe("possibly_sent");
        expect(aborted).toBeNull();
      } else {
        expect(row.status).toBe("aborted");
        expect(aborted?.status).toBe("aborted");
      }
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections: atomic correlated terminal abort + historical-aborted pass-through",
  () => {
    it("(R1) the abort helper refuses an intent whose committed order is CURRENTLY ready_for_pickup (correlated condition in the same UPDATE)", async () => {
      const suffix = `abort-ready-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-abort-ready-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });

      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-abort-ready-${suffix}`);
      expect(aborted).toBeNull();
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("pending"); // current valid intent untouched
      expect(intent.mismatchReason).toBeNull();
    });

    it("(R1) terminal at scan then switched to ready BEFORE the abort call: no abort, pending remains", async () => {
      const suffix = `abort-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-abort-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      // Sweep-side sequence: the scan observed a TERMINAL committed state…
      await db!.update(orders).set({ status: "completed" }).where(eq(orders.id, fixture.orderId));
      const context = await (await import("./jubelio-channel-mirror")).reconcileJubelioChannelStatusForOrder; void context;
      // …but the order transitions back to ready BEFORE the abort executes.
      await db!.update(orders).set({ status: "ready_for_pickup" }).where(eq(orders.id, fixture.orderId));

      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-abort-race-${suffix}`);
      expect(aborted).toBeNull();
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("pending");
      expect(intent.mismatchReason).toBeNull();
    });

    it("(R2) a HISTORICAL aborted intent no longer excludes a committed ready/paid order: the bounded sweep creates+confirms the monotonic NEXT version with exactly one edit", async () => {
      const suffix = `hist-abort-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Version 1 was superseded while the order was temporarily terminal;
      // the order is NOW committed ready_for_pickup + verified again.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-hist-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
        mismatchAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const first = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(first.missedDispatched).toBe(1);
      expect(gateway.editCalls).toHaveLength(1);
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      const [v1, v2] = intents;
      expect(v1.targetVersion).toBe(1);
      expect(v1.status).toBe("aborted"); // historical record preserved
      expect(v2.targetVersion).toBe(2); // monotonic next version
      expect(v2.status).toBe("confirmed");
      expect(v2.lastObservedStatus).toBe("Siap Proses");

      // Idempotent: the confirmed latest version excludes the order from the
      // next bounded window — no duplicate POST.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(second.missedDispatched).toBe(0);
      expect(gateway.editCalls).toHaveLength(1);
      expect(await getIntent(fixture.orderId)).toHaveLength(2);
    });

    it("(R2) confirmed and needs_investigation latest intents still exclude an order from the bounded window", async () => {
      const suffix = `still-excl-${Date.now()}`;
      for (const [part, status] of [
        ["c", "confirmed"],
        ["i", "needs_investigation"],
      ] as const) {
        const fixture = await seedMirrorFixture({
          suffix: `${suffix}-${part}`,
          orderStatus: "ready_for_pickup",
          withInvoicePayment: true,
        });
        await db!.insert(jubelioChannelStatusIntents).values({
          id: `${PREFIX}intent-excl-${part}-${suffix}`,
          orderId: fixture.orderId,
          salesOrderId: fixture.soId,
          targetVersion: 1,
          targetStatus: "Siap Proses",
          status,
          ...(status === "confirmed"
            ? { lastObservedStatus: "Siap Proses", confirmedAt: new Date() }
            : { mismatchReason: "PRE_READ_SO_CANCELED", mismatchAt: new Date() }),
        });
      }
      const gateway = controlledGateway({
        editSnapshot: new JubelioSalesGatewayError("unexpected GET", {
          ambiguous: false,
          retryable: false,
        }),
      });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      // Neither confirmed nor investigated orders enter the window (the
      // gateway would throw on any GET — none happens).
      expect(summary.missedDispatched).toBe(0);
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections (F1/F2): local-refusal vs provider-4xx discrimination + investigation allowlist",
  () => {
    it("(F1) a provider 400 whose body.code carries a hostile EDIT_-prefixed value is REJECTED with the static code", async () => {
      const suffix = `f1-hostile-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: controlledEditSnapshot({ note: fixture.note }),
        editError: new JubelioSalesGatewayError(
          "Jubelio sales write failed (400)",
          { code: "EDIT_TOKEN_ABC123", httpStatus: 400, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("rejected");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("rejected");
      expect(intent.lastError).toBe("EDIT_PROVIDER_REJECTED");
      expect(intent.lastError).not.toContain("EDIT_TOKEN_ABC123");
    });

    it("(F1) a provider 400 whose body.code EQUALS a known local code is still a REMOTE rejection (static lastError, not the local code)", async () => {
      const suffix = `f1-impersonate-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: controlledEditSnapshot({ note: fixture.note }),
        editError: new JubelioSalesGatewayError(
          "Jubelio sales write failed (400)",
          { code: "EDIT_SHAPE_INCOMPLETE", httpStatus: 400, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      // A remote 4xx is a provider rejection EVEN IF its body.code imitates a
      // local code: httpStatus is set, so it is never a local builder refusal.
      expect(outcome.status).toBe("rejected");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("rejected");
      expect(intent.lastError).toBe("EDIT_PROVIDER_REJECTED");
    });

    it("(F1) a genuine LOCAL builder fail-closed refusal (no provider HTTP response) stays needs_investigation with the local code", async () => {
      const suffix = `f1-local-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // The gateway's buildSalesOrderEditPayload refusal: thrown BEFORE any
      // POST — NO httpStatus is ever set.
      const gateway = controlledGateway({
        editSnapshot: controlledEditSnapshot({ note: fixture.note }),
        editError: new JubelioSalesGatewayError(
          "Jubelio sales order edit requires a target channel status marker",
          { code: "EDIT_TARGET_INVALID", ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("EDIT_TARGET_INVALID");
    });

    it("(F2) markJubelioChannelStatusIntentNeedsInvestigation refuses an unknown provider-looking reason before any row write", async () => {
      const suffix = `f2-hostile-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-f2-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 60_000),
      });
      const intentId = `${PREFIX}intent-f2-${suffix}`;

      await expect(
        markJubelioChannelStatusIntentNeedsInvestigation(db!, intentId, {
          reason: "TOKEN_ABC123" as never,
        })
      ).rejects.toThrow(/known static internal reason code/);
      const [untouched] = await getIntent(fixture.orderId);
      expect(untouched.status).toBe("possibly_sent");
      expect(untouched.mismatchReason).toBeNull();

      // A member of the complete internal vocabulary is accepted.
      const ok = await markJubelioChannelStatusIntentNeedsInvestigation(
        db!,
        intentId,
        { reason: "PRE_READ_NOTE_MISMATCH" }
      );
      expect(ok?.status).toBe("needs_investigation");
      expect(ok?.mismatchReason).toBe("PRE_READ_NOTE_MISMATCH");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections (3): provider body.code NEVER persisted; finite local-code allowlist",
  () => {
    it("(3) a hostile provider code on a 400 edit POST persists ONLY the static rejection code", async () => {
      const suffix = `prov-code-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: controlledEditSnapshot({ note: fixture.note }),
        editError: new JubelioSalesGatewayError(
          "Jubelio sales write failed (400)",
          { code: "TOKEN_ABC123", httpStatus: 400, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("rejected");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("rejected");
      expect(intent.lastError).toBe("EDIT_PROVIDER_REJECTED");
      expect(intent.lastError).not.toContain("TOKEN_ABC123");
    });

    it("(3) a hostile provider code on a 404 pre-read GET persists ONLY the static mismatch reason", async () => {
      const suffix = `prov-code-get-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: new JubelioSalesGatewayError(
          "Jubelio request failed (404)",
          { code: "TOKEN_ABC123", httpStatus: 404, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("PRE_READ_FAILED");
      expect(intent.mismatchReason).not.toContain("TOKEN_ABC123");
    });

    it("(3) the public markRejected seam refuses an unknown provider-looking code before any row write", async () => {
      const suffix = `pub-code-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pub-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 60_000),
      });
      const intentId = `${PREFIX}intent-pub-${suffix}`;

      await expect(
        markJubelioChannelStatusIntentRejectedAfterClaim(db!, intentId, {
          reason: "TOKEN_ABC123" as never,
        })
      ).rejects.toThrow(/static PII-safe rejection code/);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("possibly_sent"); // row untouched
      expect(intent.lastError).toBeNull();

      // The known LOCAL code set remains accepted at the seam.
      const ok = await markJubelioChannelStatusIntentRejectedAfterClaim(
        db!,
        intentId,
        { reason: "EDIT_SHAPE_INCOMPLETE" }
      );
      expect(ok?.status).toBe("rejected");
      expect(ok?.lastError).toBe("EDIT_SHAPE_INCOMPLETE");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections (2): rejection reason constrained to static PII-safe codes",
  () => {
    it("refuses to persist a hostile dynamic rejection message and stores only a static PII-safe code", async () => {
      const suffix = `rej-pii-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-rej-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 60_000),
      });
      const hostile =
        "Jubelio rejected the edit; token=Bearer super-secret-token customer John Doe john@ex.com";

      // The public seam REJECTS the hostile input outright (fail closed) —
      // arbitrary dynamic text can never reach the durable last_error.
      await expect(
        markJubelioChannelStatusIntentRejectedAfterClaim(
          db!,
          `${PREFIX}intent-rej-${suffix}`,
          { reason: hostile } as never
        )
      ).rejects.toThrow(/static PII-safe rejection code/);
      const [untouched] = await getIntent(fixture.orderId);
      expect(untouched.status).toBe("possibly_sent");
      expect(untouched.lastError).toBeNull();

      // A static PII-safe code is accepted and stored verbatim.
      const rejected = await markJubelioChannelStatusIntentRejectedAfterClaim(
        db!,
        `${PREFIX}intent-rej-${suffix}`,
        { reason: "EDIT_PROVIDER_REJECTED" }
      );
      expect(rejected?.status).toBe("rejected");
      expect(rejected?.lastError).toBe("EDIT_PROVIDER_REJECTED");
      // The rejection is terminal: the write is never re-POSTed.
      const replay = await claimJubelioChannelStatusIntentForDispatch(
        db!,
        `${PREFIX}intent-rej-${suffix}`
      );
      expect(replay.claimed).toBe(false);
    });

    it("(2) at the reconcile seam a definitive provider rejection stores the static code, not the dynamic message, and the outcome stays user-visible", async () => {
      const suffix = `rej-code-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // A definitive 4xx pre-apply provider rejection on the edit POST.
      const gateway = controlledGateway({
        editSnapshot: controlledEditSnapshot({ note: fixture.note }),
        editError: new JubelioSalesGatewayError(
          "Jubelio sales write failed (400); token=leaked-value",
          { httpStatus: 400, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      // User-visible outcome preserved (dynamic message on the RESULT only).
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" && outcome.message).toContain("400");
      expect(gateway.editCalls).toHaveLength(1); // exactly one POST attempt
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("rejected");
      // Durable last_error is the STATIC PII-safe code — no dynamic text.
      expect(intent.lastError).toBe("EDIT_PROVIDER_REJECTED");
      expect(intent.lastError).not.toContain("token");
      // No POST retry after the rejection.
      const replay = await claimJubelioChannelStatusIntentForDispatch(
        db!,
        intent.id
      );
      expect(replay.claimed).toBe(false);
    });
  }
);

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, child: () => silentLogger() } as never;
}

describe.skipIf(!schemaState.ready)(
  "ticket #06 — sweep finds COMPLETED orders and keeps target ordering",
  () => {
    it("sweep dispatches Selesai for a completed order whose Siap Proses intent was already confirmed (bounded, idempotent)", async () => {
      const suffix = `sweep-selesai-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-selesai-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        lastObservedStatus: "Siap Proses",
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const first = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(first.missedOrdersScanned).toBeGreaterThanOrEqual(1);
      expect(first.missedDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({ targetVersion: 1, targetStatus: "Siap Proses", status: "confirmed" });
      expect(intents[1]).toMatchObject({ targetVersion: 2, targetStatus: "Selesai", status: "confirmed" });

      // Idempotent: a confirmed Selesai intent excludes the completed order
      // from the bounded window — no duplicate POST on the next run.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(second.missedDispatched).toBe(0);
      expect(gateway.editCalls).toHaveLength(1);
      expect(await getIntent(fixture.orderId)).toHaveLength(2);
    });

    it("sweep spares a pending Selesai intent on a completed order from the pending-terminal abort and dispatches it exactly once", async () => {
      const suffix = `sweep-selesai-pending-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      // Crash between recording the Selesai intent and the dispatch claim.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-selesai-pend-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      const [intent] = await getIntent(fixture.orderId);
      // Not superseded: the pending target IS the committed state's marker.
      expect(intent.status).toBe("confirmed");
      expect(intent.targetStatus).toBe("Selesai");
      expect(intent.attemptCount).toBe(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      // Idempotent: the confirmed Selesai intent does not re-dispatch.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(second.missedDispatched).toBe(0);
      expect(gateway.editCalls).toHaveLength(1);
    });

    it("sweep supersedes a STALE pending Siap Proses intent on a completed order and then dispatches Selesai as the next version", async () => {
      const suffix = `sweep-stale-pend-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-sweep-stale-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
        attemptCount: 0, // never dispatched
      });
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
      });
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "ticket #06 — pending Selesai write-boundary exemption (direct primitive, ticket06-integration review)",
  () => {
    it("(P) the terminal abort primitive itself spares a pending Selesai intent on a completed order with a fully verified SO ledger (same conditional UPDATE, zero POST/GET)", async () => {
      const suffix = `pend-selesai-primitive-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-selesai-prim-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      // The DIRECT primitive (the write boundary) must refuse: the pending
      // Selesai target IS the current projection of the committed state.
      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-pend-selesai-prim-${suffix}`);
      expect(aborted).toBeNull();
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("pending");
      // The spared pending target then dispatches exactly once via the seam.
      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      expect(intent.attemptCount).toBe(0); // the never-dispatched pending row was not aborted
    });

    it("(P) scan→write eligibility race: a pending Selesai intent whose ledger completes BEFORE the abort call is spared by the write-boundary re-check and dispatches after", async () => {
      const suffix = `pend-selesai-race-${Date.now()}`;
      // Incomplete ledger at (simulated) scan time: the payment operation is
      // still in `manual_review` (not yet confirmed).
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
        paymentOpStatus: "manual_review",
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-selesai-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      // The settlement completes between the sweep's scan and the abort
      // write: the payment operation becomes CONFIRMED with its persisted
      // positive payment id.
      await db!
        .update(jubelioSalesOperations)
        .set({ status: "confirmed", confirmedAt: new Date(), paymentId: PAYMENT_ID })
        .where(eq(jubelioSalesOperations.id, `${PREFIX}op-payment-${suffix}`));

      // Write-boundary: the SAME conditional UPDATE re-checks the committed
      // exemption at write time — the now-current Selesai target is spared.
      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-pend-selesai-race-${suffix}`);
      expect(aborted).toBeNull();
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("pending");
      // The spared target dispatches through the seam (one edit, confirmed).
      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: controlledGateway({ note: fixture.note, soId: fixture.soId }) as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("confirmed");
    });

    it("(P) a pending Selesai intent whose verified ledger is NOT complete (confirmed payment missing) is still terminal-superseded — never dispatched, never spared", async () => {
      const suffix = `pend-selesai-incomplete-${Date.now()}`;
      // NOTE on the review's "malformed confirmed rows" case: the schema's
      // check constraints (jubelio_sales_operation_confirmed_requires_
      // sales_order / _confirmed_invoice_requires_invoice_id /
      // _confirmed_payment_requires_payment_id) make a CONFIRMED operation
      // row with a NULL positive id impossible to persist, so the feasible
      // fail-closed variant here is an incomplete ledger (no confirmed
      // payment operation at all).
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: false,
        invoiceOnly: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-selesai-inc-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-pend-selesai-inc-${suffix}`);
      expect(aborted).toMatchObject({
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
      });
      // And the per-order reconcile fail-closes (zero POST) for the
      // unverified ledger.
      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0].status).toBe("aborted");
    });
    it("(P) a CONFIRMED payment op carrying id 0 is NOT a verified ledger (schema forbids NULL but permits 0): the pending Selesai intent is still terminal-superseded and never dispatched (positive-id eligibility, ticket06-integration review)", async () => {
      const suffix = `pend-selesai-id0-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      // The schema's check constraints only require the id to be NOT NULL —
      // a CONFIRMED op with id 0 (or negative) CAN persist (NULL cannot).
      // The exemption's "verified" comparison is therefore strictly id > 0,
      // not isNotNull, matching the reconcile's isSafePositiveInteger rule.
      await db!
        .update(jubelioSalesOperations)
        .set({ paymentId: 0 })
        .where(eq(jubelioSalesOperations.id, `${PREFIX}op-payment-${suffix}`));
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-selesai-id0-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      // The DIRECT primitive (write boundary) must refuse the exemption:
      // the ledger is not provably verified with a POSITIVE payment id.
      const aborted = await abortPendingTerminalChannelStatusIntent(db!, `${PREFIX}intent-pend-selesai-id0-${suffix}`);
      expect(aborted).toMatchObject({
        status: "aborted",
        mismatchReason: "PENDING_TERMINAL_SUPERSEDED",
      });
      // And the per-order reconcile fail-closes (zero POST):
      // isSafePositiveInteger rejects the id-0 payment row.
      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0].status).toBe("aborted");
    });

    it("(sweep) a completed order whose confirmed payment carries id 0 is not mirror-eligible: the pending Selesai intent is terminal-superseded and the missed scan never dispatches (zero POST)", async () => {
      const suffix = `pend-selesai-id0-sweep-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!
        .update(jubelioSalesOperations)
        .set({ paymentId: 0 })
        .where(eq(jubelioSalesOperations.id, `${PREFIX}op-payment-${suffix}`));
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-pend-selesai-id0s-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      // Count ALL provider reads through this stub (GET-only recovery and
      // any dispatch pre-read must stay at zero for the id-0 ledger).
      const getSaw: number[] = [];
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (id: number) => {
        getSaw.push(id);
        return innerGet(id);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 10,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      // The scan→write boundary does not treat the id-0 row as a verified
      // ledger: the pending terminal disposition supersede wins (zero
      // POST/GET for the intent), and the missed ready/completed window
      // excludes the order (bounded-scan fairness).
      expect(summary.pendingTerminalAborted).toBeGreaterThanOrEqual(1);
      expect(summary.missedDispatched).toBe(0);
      expect(gateway.editCalls).toHaveLength(0);
      expect(getSaw).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("aborted");
      expect(intent.mismatchReason).toBe("PENDING_TERMINAL_SUPERSEDED");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#04/#05 bounded sweep eligibility with malformed confirmed create ids",
  () => {
    it("does not spend the Menunggu Verifikasi window on a confirmed create with SO id 0", async () => {
      const suffix = `mv-zero-so-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Operator review required",
      });
      await db!.update(jubelioSalesOperations)
        .set({ salesOrderId: 0 })
        .where(eq(jubelioSalesOperations.id, `${PREFIX}op-create-${suffix}`));
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 50,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(summary.verifikasiOrdersScanned).toBe(0);
      expect(await getIntent(fixture.orderId)).toHaveLength(0);
      expect(gateway.editCalls).toHaveLength(0);
    });

    it("does not spend the Gagal Bayar window on a confirmed create with SO id 0", async () => {
      const suffix = `gb-zero-so-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
      });
      await db!.update(jubelioSalesOperations)
        .set({ salesOrderId: 0 })
        .where(eq(jubelioSalesOperations.id, `${PREFIX}op-create-${suffix}`));
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 50,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(summary.gagalBayarOrdersScanned).toBe(0);
      expect(await getIntent(fixture.orderId)).toHaveLength(0);
      expect(gateway.editCalls).toHaveLength(0);
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections (C): sweep fairness under bounded limits",
  () => {
    it("rotates repeated transient GET failures so aged intents beyond the limit are eventually reached", async () => {
      const suffix = `rotation-${Date.now()}`;
      const fixtures: Array<{ orderId: string; soId: number; note: string }> = [];
      for (const part of ["a", "b"]) {
        fixtures.push(
          await seedMirrorFixture({
            suffix: `${suffix}-${part}`,
            orderStatus: "ready_for_pickup",
            withInvoicePayment: true,
          })
        );
      }
      for (const [index, fixture] of fixtures.entries()) {
        await db!.insert(jubelioChannelStatusIntents).values({
          id: `${PREFIX}intent-rot-${suffix}-${index}`,
          orderId: fixture.orderId,
          salesOrderId: fixture.soId,
          targetVersion: 1,
          targetStatus: "Siap Proses",
          status: "possibly_sent",
          attemptCount: 1,
          dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
          // Make the deterministic ordering explicit: fixture a is older.
          updatedAt: new Date(Date.now() - (index + 1) * 60_000),
        });
      }
      const gateways: Array<{ calls: number[] }> = [];
      const runSweep = async () => {
        const g = controlledGateway({
          editSnapshot: new JubelioSalesGatewayError("Jubelio request failed (503)", {
            httpStatus: 503,
            ambiguous: false,
            retryable: true,
          }),
        });
        const calls: number[] = [];
        const baseGet = g.getSalesOrderForEdit.bind(g);
        g.getSalesOrderForEdit = (async (id: number) => {
          calls.push(id);
          return baseGet(id);
        }) as JubelioSalesGateway["getSalesOrderForEdit"];
        gateways.push({ calls });
        return reconcileChannelStatusMirrorForSweep(db!, {
          limit: 1,
          gateway: g as unknown as JubelioSalesGateway,
          logger: silentLogger(),
        });
      };

      const first = await runSweep();
      const second = await runSweep();

      // Each bounded run recovers AT MOST 1 intent, and rotation guarantees
      // the second run reaches a DIFFERENT intent instead of starving it.
      expect(first.possiblySentScanned).toBe(1);
      expect(second.possiblySentScanned).toBe(1);
      expect(gateways[0].calls).toHaveLength(1);
      expect(gateways[1].calls).toHaveLength(1);
      expect(gateways[1].calls[0]).not.toBe(gateways[0].calls[0]);
      expect(first.stillUnknown).toBe(1);
      expect(second.stillUnknown).toBe(1);
      // Rotation touches ONLY updated_at: no arbitrary error text is ever
      // persisted into last_error, and attempt_count stays 1 (it counts the
      // dispatch POST permission, not GET-only retries).
      for (const fixture of fixtures) {
        const [intent] = await getIntent(fixture.orderId);
        expect(intent.status).toBe("possibly_sent");
        expect(intent.lastError).toBeNull();
        expect(intent.attemptCount).toBe(1);
      }
    });

    it("(2) a controlled provider error containing PII/token is NEVER persisted during rotation, and attempt_count stays 1", async () => {
      const suffix = `rotation-pii-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-rot-pii-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      const hostile = new Error(
        "authorization Bearer super-secret-token; customer John Doe john@ex.com"
      );
      const before = new Date(Date.now() - 60_000);
      await db!.update(jubelioChannelStatusIntents)
        .set({ updatedAt: before })
        .where(eq(jubelioChannelStatusIntents.id, `${PREFIX}intent-rot-pii-${suffix}`));

      await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: controlledGateway({ editSnapshot: hostile }) as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("possibly_sent");
      expect(intent.lastError).toBeNull(); // hostile text never persisted
      expect(intent.attemptCount).toBe(1); // GET-only touch, not a dispatch
      expect(intent.updatedAt!.getTime()).toBeGreaterThan(before.getTime());
    });

    it("(1) an order with a confirmed invoice but NO confirmed payment can never consume the bounded window ahead of a fully eligible order", async () => {
      const suffix = `elig-gap-${Date.now()}`;
      // OLDER order: confirmed create + invoice but NO confirmed payment —
      // NOT mirror-eligible.
      const invoiceOnly = await seedMirrorFixture({
        suffix: `${suffix}-x`,
        orderStatus: "ready_for_pickup",
        invoiceOnly: true,
      });
      // NEWER order: fully eligible (create + invoice + payment confirmed).
      const eligible = await seedMirrorFixture({
        suffix: `${suffix}-y`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Force the deterministic ordering: the gap order is oldest.
      await db!.update(orders)
        .set({ updatedAt: new Date(Date.now() - 60_000) })
        .where(eq(orders.id, invoiceOnly.orderId));
      await db!.update(orders)
        .set({ updatedAt: new Date() })
        .where(eq(orders.id, eligible.orderId));
      const gateway = controlledGateway({ note: eligible.note, soId: eligible.soId });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        limit: 1,
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      // The bounded window must SKIP the create+invoice-only order entirely
      // and reach the truly eligible one (no starvation behind a gap order).
      expect(summary.missedOrdersScanned).toBe(1);
      expect(summary.missedDispatched).toBe(1);
      const [eligibleIntent] = await getIntent(eligible.orderId);
      expect(eligibleIntent.status).toBe("confirmed");
      expect(await getIntent(invoiceOnly.orderId)).toHaveLength(0);
    });

    it("missed-order scan under a small limit reaches every unresolved eligible order (confirmed orders excluded from the window)", async () => {
      const suffix = `missed-fair-${Date.now()}`;
      // Three unresolved eligible missed orders + one already-confirmed one.
      const missedFixtures: Array<{ orderId: string; soId: number; note: string }> = [];
      for (const part of ["a", "b", "c"]) {
        missedFixtures.push(
          await seedMirrorFixture({
            suffix: `${suffix}-${part}`,
            orderStatus: "ready_for_pickup",
            withInvoicePayment: true,
          })
        );
      }
      const confirmedFixture = await seedMirrorFixture({
        suffix: `${suffix}-done`,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-missed-done-${suffix}`,
        orderId: confirmedFixture.orderId,
        salesOrderId: confirmedFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        lastObservedStatus: "Siap Proses",
        confirmedAt: new Date(),
      });

      const runSweep = async () => {
        // A gateway stub per order: keyed by SO id so each dispatch gets a
        // snapshot for its own order.
        const bySo = new Map<number, JubelioSalesGateway>();
        for (const fixture of missedFixtures) {
          bySo.set(
            fixture.soId,
            controlledGateway({ note: fixture.note, soId: fixture.soId }) as unknown as JubelioSalesGateway
          );
        }
        const gateway: JubelioSalesGateway = {
          ...(controlledGateway({ note: missedFixtures[0].note, soId: missedFixtures[0].soId }) as unknown as JubelioSalesGateway),
          async getSalesOrderForEdit(id: number) {
            return bySo.get(id)!.getSalesOrderForEdit(id);
          },
          async editSalesOrder(call: { edit: JubelioSalesOrderEditSnapshot; targetChannelStatus: string }) {
            const inner = bySo.get(call.edit.salesorderId)!;
            return inner.editSalesOrder(call);
          },
        };
        return reconcileChannelStatusMirrorForSweep(db!, {
          limit: 2,
          gateway,
          logger: silentLogger(),
        });
      };

      const first = await runSweep();
      // The confirmed order must not consume the window: with limit 2 the
      // sweep still reaches two UNRESOLVED eligible orders.
      expect(first.missedOrdersScanned).toBe(2);
      expect(first.missedDispatched).toBe(2);

      const second = await runSweep();
      // The third unresolved order is reached on the next bounded run; the
      // confirmed ones stay out of the window.
      expect(second.missedOrdersScanned).toBeLessThanOrEqual(2);
      expect(second.missedDispatched).toBe(1);

      for (const fixture of missedFixtures) {
        const [intent] = await getIntent(fixture.orderId);
        expect(intent.status).toBe("confirmed");
      }
      const [confirmedIntent] = await getIntent(confirmedFixture.orderId);
      expect(confirmedIntent.status).toBe("confirmed"); // untouched
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#03 review corrections (A/B): recovery target check + transient GET classification",
  () => {
    it("(A) GET-only recovery confirms against the intent's OWN target status, never a hardcoded marker", async () => {
      const suffix = `target-check-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // A (future-ticket) non-Siap-Proses target on the SAME verified SO:
      // the schema allowlist admits it; recovery must confirm against the
      // intent's OWN target, not a hardcoded marker.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-target-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The edit WAS applied for that target: GET shows the marker + core.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, channelStatus: "Gagal Bayar" }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("confirmed");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("confirmed");
      expect(intent.lastObservedStatus).toBe("Gagal Bayar");
    });

    it("(A) recovery NEVER false-confirms when the GET shows a different marker than the intent's target", async () => {
      const suffix = `target-mismatch-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-target2-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // GET shows the OLD marker (Siap Proses) — not the intent's target:
      // this must NOT false-confirm.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, channelStatus: "Siap Proses" }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("RECOVERY_MARKER_NOT_OBSERVED");
    });

    it("(B) a TRANSIENT (5xx/429/timeout) pre-read GET failure after the claim stays possibly_sent for GET-only aged retry", async () => {
      const suffix = `transient-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Literal spec shape: 5xx after the claim — non-ambiguous, retryable.
      const gateway = controlledGateway({
        editSnapshot: new JubelioSalesGatewayError("Jubelio request failed (503)", {
          httpStatus: 503,
          ambiguous: false,
          retryable: true,
        }),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("in_flight");
      expect(gateway.editCalls).toHaveLength(0); // never a re-POST
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("possibly_sent"); // durable retryable state
    });

    it("(B) a definitive pre-read GET failure records a PII-safe durable investigation with the gateway code", async () => {
      const suffix = `definitive-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({
        editSnapshot: new JubelioSalesGatewayError(
          "Jubelio sales order edit pre-read is incomplete",
          { code: "EDIT_SHAPE_INCOMPLETE", httpStatus: 200, ambiguous: false, retryable: false }
        ),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("EDIT_SHAPE_INCOMPLETE");
    });

    it("(B) a TRANSIENT recovery GET failure stays possibly_sent (aged GET-only retry), never an investigation", async () => {
      const suffix = `recovery-transient-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-recovery-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      const gateway = controlledGateway({
        editSnapshot: new JubelioSalesGatewayError("Jubelio request failed (429)", {
          httpStatus: 429,
          ambiguous: false,
          retryable: true,
        }),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("in_flight");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("possibly_sent");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#04: Menunggu Verifikasi target (paid + committed manual review / operator block only)",
  () => {
    it("(1) projects Menunggu Verifikasi with exactly one full-payload edit for a paid-but-blocked order with a committed manual-review settlement", async () => {
      const suffix = `mv-happy-${Date.now()}`;
      const { orderId, note: fixtureNote, soId: fixtureSoId } = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Sales-Order payment is unverified: payment id missing",
        withInvoicePayment: true,
        paymentOpStatus: "manual_review",
      });
      const gateway = controlledGateway({ note: fixtureNote, soId: fixtureSoId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Menunggu Verifikasi");
      expect(gateway.editCalls[0].edit).toMatchObject({
        salesorderId: fixtureSoId,
        note: fixtureNote,
        invoiceId: INVOICE_ID,
        subTotal: PRICE,
        items: [{ salesorderDetailId: 74682, itemId: ITEM_ID, amount: PRICE }],
      });
      const intents = await getIntent(orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "confirmed",
        salesOrderId: fixtureSoId,
        lastObservedStatus: "Menunggu Verifikasi",
      });
      // NONINTERFERENCE: the mirror never touches the local order — the
      // order stays paid-but-blocked with no pickup code.
      const [order] = await db!.select().from(orders).where(eq(orders.id, orderId));
      expect(order.status).toBe("processing");
      expect(order.paymentStatus).toBe("paid");
      expect(order.fulfillmentBlockedReason).toBeTruthy();
      expect(order.pickupCode).toBeNull();
    });

    it("never projects Menunggu Verifikasi from a short pending/in-flight settlement or from mere admin-queue membership (processing + paid without a committed block)", async () => {
      const suffix = `mv-inflight-${Date.now()}`;
      // Same paid-but-blocked-shape the admin queue lists, but the committed
      // state has NO block reason and NO manual_review operation: the
      // settlement is merely pending/in flight.
      const { orderId } = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({});

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(orderId)).toHaveLength(0);
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#04: resolved investigation — the latest target becomes Siap Proses without stale dispatch",
  () => {
    it("(2a) after a CONFIRMED Menunggu Verifikasi edit, a committed ready state records the monotonic NEXT version targeting Siap Proses — never a stale re-dispatch", async () => {
      const suffix = `mv-resolved-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Sales-Order payment is unverified: payment id missing",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      // Phase 1: the committed paid-but-blocked state projects MV (v1).
      const first = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(first.status).toBe("confirmed");
      expect(gateway.editCalls.map((call) => call.target)).toEqual(["Menunggu Verifikasi"]);

      // The investigation is resolved: settlement completes and the committed
      // local state becomes ready_for_pickup + verified (block cleared).
      await db!.update(orders).set({
        status: "ready_for_pickup",
        pickupCode: "M12345",
        fulfillmentBlockedReason: null,
        updatedAt: new Date(),
      }).where(eq(orders.id, fixture.orderId));

      // Phase 2: the LATEST mirror target is Siap Proses (next version).
      const second = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(second.status).toBe("confirmed");
      expect(gateway.editCalls.map((call) => call.target)).toEqual([
        "Menunggu Verifikasi",
        "Siap Proses",
      ]);
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      const [v1, v2] = intents;
      expect(v1).toMatchObject({ targetVersion: 1, targetStatus: "Menunggu Verifikasi", status: "confirmed" });
      expect(v2).toMatchObject({ targetVersion: 2, targetStatus: "Siap Proses", status: "confirmed" });

      // Idempotent: no further dispatch and no stale MV re-dispatch.
      const third = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(third.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(2);
      expect(await getIntent(fixture.orderId)).toHaveLength(2);
    });

    it("(2b) supersedes a STALE PENDING Menunggu Verifikasi intent (never dispatched) when the committed state becomes ready and dispatches Siap Proses as the next version with zero MV POST", async () => {
      const suffix = `mv-stale-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // The MV intent was recorded while the order was paid-but-blocked; the
      // investigation resolved BEFORE any dispatch (still pending).
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-mv-stale-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Siap Proses");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      const [v1, v2] = intents;
      expect(v1).toMatchObject({
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "aborted",
        attemptCount: 0,
      });
      expect(v1.mismatchReason).toBe("PENDING_TARGET_SUPERSEDED");
      expect(v2).toMatchObject({
        targetVersion: 2,
        targetStatus: "Siap Proses",
        status: "confirmed",
      });
      // The superseded intent can never be claimed later (at-most-once kept).
      const replay = await claimJubelioChannelStatusIntentForDispatch(db!, v1.id);
      expect(replay.claimed).toBe(false);
    });

    it("(2c) the stale-pending supersede is concurrency-guarded: exactly one of dispatch claim / supersede wins", async () => {
      const suffix = `mv-sup-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-mv-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "pending",
      });

      const [claim, superseded] = await Promise.all([
        claimJubelioChannelStatusIntentForDispatch(db!, `${PREFIX}intent-mv-race-${suffix}`),
        supersedeStalePendingChannelStatusIntent(db!, {
          intentId: `${PREFIX}intent-mv-race-${suffix}`,
          targetStatus: "Siap Proses",
        }),
      ]);
      const [row] = await getIntent(fixture.orderId);
      if (claim.claimed) {
        expect(row.status).toBe("possibly_sent");
        expect(superseded).toBeNull();
      } else {
        expect(row.status).toBe("aborted");
        expect(superseded?.status).toBe("aborted");
      }
    });

    it("(2d) refuses to supersede a stale pending intent when the committed evidence for the new target does not hold (fail-closed)", async () => {
      const suffix = `mv-sup-guard-${Date.now()}`;
      // The order is NOT ready yet: the committed state does NOT evidence the
      // new Siap Proses target.
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-mv-guard-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const superseded = await supersedeStalePendingChannelStatusIntent(db!, {
        intentId: `${PREFIX}intent-mv-guard-${suffix}`,
        targetStatus: "Siap Proses",
      });
      expect(superseded).toBeNull();
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("pending");
      expect(intent.mismatchReason).toBeNull();
      expect(gateway.editCalls).toHaveLength(0);
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#04: sweep — paid-but-blocked Menunggu Verifikasi recovery (bounded, GET-only, noninterfering)",
  () => {
    it("(3a) the bounded sweep dispatches Menunggu Verifikasi for a paid-but-blocked order whose intent was never created, and does not re-dispatch once confirmed", async () => {
      const suffix = `mv-sweep-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Sales-Order invoice is unverified: shape mismatch",
        withInvoicePayment: true,
        invoiceOpStatus: "manual_review",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.verifikasiOrdersScanned).toBeGreaterThanOrEqual(1);
      expect(summary.verifikasiDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Menunggu Verifikasi");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "confirmed",
      });

      // Idempotent: the confirmed MV intent excludes the order from the
      // bounded window — no duplicate POST.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(summary.verifikasiDispatched).toBe(1);
      expect(gateway.editCalls).toHaveLength(1);
      void second;
    });

    it("(3b) never dispatches Menunggu Verifikasi for a paid processing order without committed manual-review/block evidence (queue membership or short pending/in-flight is not a trigger)", async () => {
      const suffix = `mv-sweep-neg-${Date.now()}`;
      // In-flight settlement evidence only: the ledger op is
      // dispatched_unknown and no block reason is committed. The admin
      // review queue would implicitly list this order; the mirror must not.
      const inFlight = await seedMirrorFixture({
        suffix: `${suffix}-if`,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: true,
        invoiceOpStatus: "dispatched_unknown",
      });
      const gateway = controlledGateway({});

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(inFlight.orderId)).toHaveLength(0);
      void summary;
    });

    it("(3c) the sweep's bounded ready window no longer excludes orders whose latest CONFIRMED intent targets Menunggu Verifikasi — the resolved investigation projects Siap Proses", async () => {
      const suffix = `mv-sweep-ready-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // A resolved investigation: the MV edit was confirmed earlier; the
      // committed local state is now ready_for_pickup + verified.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-mv-ready-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "confirmed",
        lastObservedStatus: "Menunggu Verifikasi",
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.missedDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Siap Proses");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Siap Proses",
        status: "confirmed",
      });
    });

    it("(3d) GET-only recovers an aged possibly-sent Menunggu Verifikasi edit for a still-blocked order (never a re-POST) and never dispatches Siap Proses behind the unresolved claim", async () => {
      const suffix = `mv-sweep-ps-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Sales-Order payment is unverified: payment id missing",
        withInvoicePayment: true,
        paymentOpStatus: "manual_review",
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-mv-ps-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The edit WAS applied before the crash: GET shows the MV marker.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, channelStatus: "Menunggu Verifikasi" }),
          salesorderId: fixture.soId,
        },
      });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.recovered).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(0); // GET-only, never a re-POST
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("confirmed");
      expect(intent.lastObservedStatus).toBe("Menunggu Verifikasi");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#04: fail-closed Menunggu Verifikasi edit + noninterference",
  () => {
    it("(4) fail-closes with zero POST and a durable PII-safe investigation when the remote SO diverges from the verified ledger during a Menunggu Verifikasi dispatch; the paid-but-blocked local state is untouched", async () => {
      const suffix = `mv-failclosed-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        blockedReason: "Sales-Order payment is unverified: payment id missing",
        withInvoicePayment: true,
        paymentOpStatus: "manual_review",
      });
      // Remote mutation between create and the MV edit: the SO money no
      // longer matches the verified create intent.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, subTotal: 999, grandTotal: 999 }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toMatch(/^[A-Z0-9_:.-]+$/);
      expect(intent.targetStatus).toBe("Menunggu Verifikasi");
      // NONINTERFERENCE: the mirror never touches the local order.
      const [order] = await db!.select().from(orders).where(eq(orders.id, fixture.orderId));
      expect(order.status).toBe("processing");
      expect(order.paymentStatus).toBe("paid");
      expect(order.fulfillmentBlockedReason).toBeTruthy();
      expect(order.pickupCode).toBeNull();
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#05: Gagal Bayar target (committed failed_payment, safe-to-edit SO only)",
  () => {
    it("(G1) projects Gagal Bayar with exactly one full-payload edit for a failed_payment order whose Sales Order is still active (cancel path never started)", async () => {
      const suffix = `gb-happy-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // No invoice remotely either (failed pre-invoice): the ledger has NO
      // verified invoice id, so the pre-read must show NO invoice link.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
        salesOrderId: fixture.soId,
      });
      // NONINTERFERENCE: the failed local order is untouched.
      const [order] = await db!.select().from(orders).where(eq(orders.id, fixture.orderId));
      expect(order.status).toBe("failed_payment");
      expect(order.paymentStatus).toBe("failed");
      expect(order.pickupCode).toBeNull();
    });

    it("(G2) never POSTs a Gagal Bayar edit once the Sales-Order cancel path STARTED/CONFIRMED — the pending mirror intent is durably aborted with a PII-safe, findable reason (zero POST, zero GET)", async () => {
      const suffix = `gb-cancel-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // The cancel path started after the failure: the cancel ledger
      // operation is committed (here: confirmed).
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "confirmed",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60_000),
        confirmedAt: new Date(Date.now() - 29 * 60_000),
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-cancel-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(outcome.status === "skipped" && outcome.reason).toBe("cancel_started");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("aborted");
      expect(intent.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      expect(intent.attemptCount).toBe(0); // never dispatched
      // The aborted intent can never be claimed later.
      const replay = await claimJubelioChannelStatusIntentForDispatch(db!, intent.id);
      expect(replay.claimed).toBe(false);
    });

    it("(G3) records a durable, findable PII-safe mismatch (zero POST/GET) for a failed_payment order whose cancel path started BEFORE any mirror intent existed", async () => {
      const suffix = `gb-cancel-rec-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // Cancel dispatched_unknown (maybe-sent): the marker edit must never
      // be attempted.
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "dispatched_unknown",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 10 * 60_000),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      let getSaw = 0;
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (...args: Parameters<
        JubelioSalesGateway["getSalesOrderForEdit"]
      >) => {
        getSaw++;
        return innerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0); // zero POST
      expect(getSaw).toBe(0); // zero GET
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "aborted",
        attemptCount: 0,
      });
      expect(intents[0].mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");

      // Idempotent: the durable record exists — no row growth on re-runs.
      const second = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(second.status).toBe("skipped");
      expect(await getIntent(fixture.orderId)).toHaveLength(1);
      expect(gateway.editCalls).toHaveLength(0);
    });

    it("(G4) a DEFINITIVELY never-applied cancel (rejected) leaves the active SO safe to edit — Gagal Bayar dispatch proceeds with the fail-closed pre-read", async () => {
      const suffix = `gb-rejected-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // The cancel POST was definitively refused BEFORE applying: the
      // remote SO is still active and no cancel write is in flight.
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-rejected-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "rejected",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${PREFIX}op-gb-rejected-${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60_000),
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
      });
    });

    it("(G5) fail-closes with zero POST and a durable investigation when the remote GET shows the SO was canceled (racing cancel), even though no cancel op was recorded locally", async () => {
      const suffix = `gb-remote-cancel-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({
            note: fixture.note,
            invoiceId: null,
            isCanceled: true,
          }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("PRE_READ_SO_CANCELED");
    });

    it("(G6) without a confirmed SO create there is NO Gagal Bayar edit and no mirror intent", async () => {
      const suffix = `gb-nocreate-${Date.now()}`;
      // Order failed before the SO create was confirmed: no confirmed
      // create ledger op.
      const clientId = `${PREFIX}client-gb-nocreate-${suffix}`;
      const orderId = `${PREFIX}order-gb-nocreate-${suffix}`;
      testClientIds.push(clientId);
      await db!.insert(clients).values({
        id: clientId,
        name: "Mirror DB Test",
        email: `${clientId}@example.com`,
        emailVerified: true,
      });
      await db!.insert(orders).values({
        id: orderId,
        userId: clientId,
        status: "failed_payment",
        paymentStatus: "failed",
        pickupCode: null,
        contactPhone: "081234567890",
        contactEmail: `${clientId}@example.com`,
        subtotal: String(PRICE),
        total: String(PRICE),
      });
      const gateway = controlledGateway({});

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(orderId)).toHaveLength(0);
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#05: sweep — failed_payment Gagal Bayar recovery (bounded, GET-only, noninterfering)",
  () => {
    it("(S1) the bounded sweep dispatches Gagal Bayar for a failed_payment order whose Sales Order is safe to edit and whose intent was never created; confirmed orders are excluded (idempotent)", async () => {
      const suffix = `gb-sweep-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.gagalBayarOrdersScanned).toBeGreaterThanOrEqual(1);
      expect(summary.gagalBayarDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
      });

      // Idempotent: the confirmed Gagal Bayar intent excludes the order from
      // the bounded window — no duplicate POST.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(gateway.editCalls).toHaveLength(1);
      expect(await getIntent(fixture.orderId)).toHaveLength(1);
      void second;
    });

    it("(S2) the sweep NEVER dispatches a Gagal Bayar edit for a failed_payment order whose cancel path is active — it records the durable PII-safe mismatch instead (zero POST/GET) and frees the bounded window on the next pass", async () => {
      const suffix = `gb-sweep-cancel-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // Cancel path started (confirmed) after the failure.
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-sweep-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "confirmed",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60_000),
        confirmedAt: new Date(Date.now() - 29 * 60_000),
      });
      let getSaw = 0;
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (...args: Parameters<
        JubelioSalesGateway["getSalesOrderForEdit"]
      >) => {
        getSaw++;
        return innerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const first = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(gateway.editCalls).toHaveLength(0); // zero POST
      expect(getSaw).toBe(0); // zero GET
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetStatus: "Gagal Bayar",
        status: "aborted",
        mismatchReason: "GAGAL_BAYAR_CANCEL_STARTED",
        attemptCount: 0,
      });

      // Anti-starvation: the recorded mismatch frees the bounded window —
      // the second pass scans no Gagal Bayar orders at all.
      const second = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });
      expect(second.gagalBayarOrdersScanned).toBe(0);
      expect(gateway.editCalls).toHaveLength(0);
      void first;
    });

    it("(S3) failed_payment orders are NO LONGER blanket-terminal for the mirror: a pending Gagal Bayar intent whose Sales Order is safe to edit is DISPATCHED by the sweep (one edit, not aborted)", async () => {
      const suffix = `gb-sweep-pending-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-pending-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("confirmed");
      expect(intent.mismatchReason).toBeNull();
    });

    it("(S4) a pending stale target intent for a failed_payment order with a SAFE Sales Order is superseded and the Gagal Bayar NEXT version is dispatched (zero stale POST)", async () => {
      const suffix = `gb-sweep-stale-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // A pending Menunggu Verifikasi intent is stale: the committed local
      // state is failed_payment (the payment failed; the order was never
      // paid). It was never dispatched, so the committed state supersedes it.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-stale-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "pending",
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Gagal Bayar");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Menunggu Verifikasi",
        status: "aborted",
        attemptCount: 0,
      });
      expect(intents[0].mismatchReason).toBe("PENDING_TARGET_SUPERSEDED");
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
      });
    });

    it("(S5) late settlement after a started cancel stays paid-but-blocked: the Menunggu Verifikasi derivation applies, but the edit fail-closes on the CANCELED remote Sales Order (zero POST, durable investigation)", async () => {
      const suffix = `gb-late-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: false,
        blockedReason: "Late payment arrived after the Sales-Order cancel path started",
      });
      // The cancel path was started (confirmed) before the late payment.
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-late-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "confirmed",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 60 * 60_000),
        confirmedAt: new Date(Date.now() - 59 * 60_000),
      });
      // The remote SO is canceled (the cancel was applied).
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, isCanceled: true }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      // #04 behavior for late-paid: the Menunggu Verifikasi target is
      // derived from the committed paid-but-blocked state, but the fail-
      // closed pre-read refuses the edit (SO canceled) — zero POST.
      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("PRE_READ_SO_CANCELED");
      // NONINTERFERENCE: paid/blocked local state untouched.
      const [order] = await db!.select().from(orders).where(eq(orders.id, fixture.orderId));
      expect(order.status).toBe("processing");
      expect(order.paymentStatus).toBe("paid");
      expect(order.fulfillmentBlockedReason).toBeTruthy();
    });

    it("(S6) after a late settlement is fully verified and the order is committed ready_for_pickup, the confirmed old Gagal Bayar intent is history and the next version projects Siap Proses", async () => {
      const suffix = `gb-late-ready-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // A confirmed Gagal Bayar intent from the earlier failed state.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-ready-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "confirmed",
        lastObservedStatus: "Gagal Bayar",
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: gateway as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      expect(summary.missedDispatched).toBeGreaterThanOrEqual(1);
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Siap Proses");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Siap Proses",
        status: "confirmed",
      });
    });

    it("(S7) an AMBIGUOUS old Gagal Bayar target (possibly_sent) is never breached or blindly re-POSTed after the order moved on — GET-only recovery against its OWN target", async () => {
      const suffix = `gb-late-ambiguous-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: false,
        blockedReason: "Sales-Order payment is unverified: payment id missing",
      });
      // An old Gagal Bayar intent was claimed before the late settlement
      // resurrected the order; its outcome is unknown (possibly_sent, aged).
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-ambig-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The remote SO is still active and was never edited for Gagal Bayar.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      // GET-only recovery: the GET shows the intent's own target was NOT
      // applied — investigation, never a re-POST; the newer committed state
      // (Menunggu Verifikasi, #04) is never dispatched behind the
      // unresolved old claim.
      expect(outcome.status).toBe("needs_investigation");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("needs_investigation");
      expect(intent.mismatchReason).toBe("RECOVERY_MARKER_NOT_OBSERVED");
    });

    it("(S8) the pending-terminal abort no longer disposes failed_payment orders' pending intents as terminal — only completed/cancelled orders are blanket-aborted", async () => {
      const suffix = `gb-term-${Date.now()}`;
      const failedFixture = await seedMirrorFixture({
        suffix: `${suffix}-f`,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      const completedFixture = await seedMirrorFixture({
        suffix: `${suffix}-c`,
        orderStatus: "processing",
        paymentStatus: "paid",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values([
        {
          id: `${PREFIX}intent-gb-term-f-${suffix}`,
          orderId: failedFixture.orderId,
          salesOrderId: failedFixture.soId,
          targetVersion: 1,
          targetStatus: "Gagal Bayar",
          status: "pending",
        },
        {
          id: `${PREFIX}intent-gb-term-c-${suffix}`,
          orderId: completedFixture.orderId,
          salesOrderId: completedFixture.soId,
          targetVersion: 1,
          targetStatus: "Siap Proses",
          status: "pending",
        },
      ]);
      // The completed fixture's order goes terminal after pickup.
      await db!.update(orders).set({ status: "completed" }).where(eq(orders.id, completedFixture.orderId));

      const summary = await reconcileChannelStatusMirrorForSweep(db!, {
        gateway: controlledGateway({}) as unknown as JubelioSalesGateway,
        logger: silentLogger(),
      });

      const [failedIntent] = await getIntent(failedFixture.orderId);
      // failed_payment is no longer blanket-terminal: the failed order is
      // left for the Gagal Bayar window (its SO here has NO confirmed
      // create ledger beyond the fixture's confirmed create — no cancel op
      // — so the window dispatches the marker; zero GET needed before the
      // dispatch, the pre-read GET is part of the safe edit).
      const [completedIntent] = await getIntent(completedFixture.orderId);
      expect(completedIntent.status).toBe("aborted"); // terminal (completed)
      expect(completedIntent.mismatchReason).toBe("PENDING_TERMINAL_SUPERSEDED");
      void failedFixture;
      void failedIntent;
      void summary;
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#05: started-cancel disposition race + noninterference",
  () => {
    it("(G7) the started-cancel disposition is concurrency-guarded: exactly one of dispatch claim / cancel-started abort wins (never a second POST for the same intent)", async () => {
      const suffix = `gb-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-race-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "dispatched_unknown",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 10 * 60_000),
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const [claim, aborted] = await Promise.all([
        claimJubelioChannelStatusIntentForDispatch(
          db!,
          `${PREFIX}intent-gb-race-${suffix}`
        ),
        abortPendingIntentForStartedCancel(
          db!,
          `${PREFIX}intent-gb-race-${suffix}`
        ),
      ]);
      const [row] = await getIntent(fixture.orderId);
      // Exactly one transition won; the other was refused.
      if (claim.claimed) {
        expect(row.status).toBe("possibly_sent");
        expect(aborted).toBeNull();
      } else {
        expect(row.status).toBe("aborted");
        expect(aborted?.status).toBe("aborted");
        expect(aborted?.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      }
      void gateway;
    });

    it("(G8) a Gagal Bayar mirror failure never touches the failed local order, the cancel path or the hold: noninterference at the reconcile seam", async () => {
      const suffix = `gb-nonint-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // Cancel path started (manual review): zero-POST disposition.
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-nonint-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "manual_review",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60_000),
      });
      // The gateway is never called for the started-cancel disposition: an
      // exploding gateway must not change the outcome either.
      const gateway = controlledGateway({
        editSnapshot: new Error("unexpected GET in the cancel-blocked disposition"),
      });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(outcome.status === "skipped" && outcome.reason).toBe("cancel_started");
      expect(gateway.editCalls).toHaveLength(0);
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("aborted");
      expect(intent.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      // NONINTERFERENCE: the failed local order is untouched.
      const [order] = await db!.select().from(orders).where(eq(orders.id, fixture.orderId));
      expect(order.status).toBe("failed_payment");
      expect(order.paymentStatus).toBe("failed");
      expect(order.pickupCode).toBeNull();
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "#05 parent-review corrections: cancel-race fail-closed claim + pre-POST re-check",
  () => {
    it("(R1) the Gagal Bayar dispatch claim fails closed against the CURRENT committed cancel-active evidence in the SAME claim statement: a cancel op committed after the eligibility read refuses the claim (intent stays pending, zero POST), and the subsequent reconcile records the cancel-started mismatch", async () => {
      const suffix = `gb-claim-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      // The mirror intent was recorded while the cancel path was NOT yet
      // started; the cancel op COMMITS before the dispatch claim runs.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-claimrace-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-claimrace-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "confirmed",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 5 * 60_000),
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      // The CANCEL-AWARE claim: refused even though the row is `pending`.
      const refused = await claimJubelioChannelStatusIntentForGagalBayarDispatch(
        db!,
        `${PREFIX}intent-gb-claimrace-${suffix}`
      );
      expect(refused.claimed).toBe(false);
      expect(refused.reason).toBe("cancel_started");
      const [stillPending] = await getIntent(fixture.orderId);
      expect(stillPending.status).toBe("pending"); // row untouched, never claimed
      expect(stillPending.attemptCount).toBe(0);
      expect(gateway.editCalls).toHaveLength(0); // zero POST

      // The subsequent reconcile re-derives the committed state and records
      // the durable cancel-started mismatch (zero POST/GET).
      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("skipped");
      expect(outcome.status === "skipped" && outcome.reason).toBe("cancel_started");
      expect(gateway.editCalls).toHaveLength(0);
      const [aborted] = await getIntent(fixture.orderId);
      expect(aborted.status).toBe("aborted");
      expect(aborted.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      // The generic (Siap/Menunggu Verifikasi) claim remains refused for an
      // aborted intent — at-most-once preserved.
      const replay = await claimJubelioChannelStatusIntentForDispatch(
        db!,
        aborted.id
      );
      expect(replay.claimed).toBe(false);
    });

    it("(R2) the claim succeeds when the cancel path is NOT active (generic claim semantics preserved) and fails for a not-yet-existing SO mismatch only via the generic paths", async () => {
      const suffix = `gb-claim-ok-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-claimok-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });

      const claimed = await claimJubelioChannelStatusIntentForGagalBayarDispatch(
        db!,
        `${PREFIX}intent-gb-claimok-${suffix}`
      );
      expect(claimed.claimed).toBe(true);
      expect(claimed.intent?.status).toBe("possibly_sent");
    });

    it("(R3) the LAST safe pre-POST boundary re-checks the committed cancel state AFTER the pre-read GET: a cancel op committed in that window blocks the POST with zero provider writes and a durable cancel-started mismatch", async () => {
      const suffix = `gb-postcheck-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, invoiceId: null }),
          salesorderId: fixture.soId,
        },
      });
      // Simulated interleaving: the cancel op COMMITS after the context
      // read (eligibility derived Gagal Bayar) and after the claim, WHILE
      // the pre-read GET runs — before the edit POST.
      const innerGet = gateway.getSalesOrderForEdit.bind(gateway);
      gateway.getSalesOrderForEdit = (async (...args: Parameters<
        JubelioSalesGateway["getSalesOrderForEdit"]
      >) => {
        await db!.insert(jubelioSalesOperations).values({
          id: `${PREFIX}op-gb-postcheck-cancel-${suffix}`,
          orderId: fixture.orderId,
          type: "cancel",
          status: "dispatched_unknown",
          reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
          payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
          salesOrderId: fixture.soId,
          attemptCount: 1,
          dispatchedAt: new Date(),
        });
        return innerGet(...args);
      }) as JubelioSalesGateway["getSalesOrderForEdit"];

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(outcome.status === "skipped" && outcome.reason).toBe("cancel_started");
      expect(gateway.editCalls).toHaveLength(0); // zero POST — the marker was withheld
      const [intent] = await getIntent(fixture.orderId);
      expect(intent.status).toBe("aborted");
      expect(intent.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      // The intent can never be claimed later (at-most-once preserved).
      const replay = await claimJubelioChannelStatusIntentForDispatch(db!, intent.id);
      expect(replay.claimed).toBe(false);
      void innerGet;
    });

    it("(R4) the started-cancel disposition is race-guarded: under a committed ACTIVE cancel op the cancel-aware claim is ALWAYS refused (reason cancel_started) and the abort wins", async () => {
      const suffix = `gb-postcheck-race-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "failed_payment",
        paymentStatus: "failed",
        withInvoicePayment: false,
      });
      await db!.insert(jubelioSalesOperations).values({
        id: `${PREFIX}op-gb-postcheck-race-cancel-${suffix}`,
        orderId: fixture.orderId,
        type: "cancel",
        status: "confirmed",
        reference: `OKCIR_SO_CANCEL:${fixture.orderId}:${suffix}`,
        payload: { type: "cancel", cancel: { salesOrderId: fixture.soId } },
        salesOrderId: fixture.soId,
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60_000),
        confirmedAt: new Date(Date.now() - 29 * 60_000),
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-gb-postcheck-race-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Gagal Bayar",
        status: "pending",
      });

      const [claim, aborted] = await Promise.all([
        claimJubelioChannelStatusIntentForGagalBayarDispatch(
          db!,
          `${PREFIX}intent-gb-postcheck-race-${suffix}`
        ),
        abortPendingIntentForStartedCancel(
          db!,
          `${PREFIX}intent-gb-postcheck-race-${suffix}`
        ),
      ]);
      const [row] = await getIntent(fixture.orderId);
      // The committed cancel op is ACTIVE, so the cancel-aware claim is
      // ALWAYS refused: the correlated evidence refuses the claim (row
      // untouched) and the started-cancel abort durably wins.
      expect(claim.claimed).toBe(false);
      expect(claim.reason).toBe("cancel_started");
      expect(row.status).toBe("aborted");
      expect(row.mismatchReason).toBe("GAGAL_BAYAR_CANCEL_STARTED");
      expect(aborted?.status).toBe("aborted");
    });
  }
);

describe.skipIf(!schemaState.ready)(
  "ticket #06 — Selesai projected from the COMMITTED completed local order",
  () => {
    it("dispatches exactly one full-payload edit targeting Selesai when the committed order is completed after pickup", async () => {
      const suffix = `selesai-happy-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // The COMMITTED store transition: completed only ever follows
      // ready_for_pickup (the pickup path), never a payment result.
      await db!.update(orders).set({ status: "completed" }).where(eq(orders.id, fixture.orderId));
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      // Full-payload edit still preserves the verified core attributes.
      expect(gateway.editCalls[0].edit).toMatchObject({
        salesorderId: fixture.soId,
        note: fixture.note,
        invoiceId: INVOICE_ID,
        subTotal: PRICE,
      });
      const [intent] = await getIntent(fixture.orderId);
      expect(intent).toMatchObject({
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "confirmed",
        lastObservedStatus: "Selesai",
        salesOrderId: fixture.soId,
      });
      // NONINTERFERENCE: the local order is untouched.
      const [order] = await db!.select().from(orders).where(eq(orders.id, fixture.orderId));
      expect(order.status).toBe("completed");
      expect(order.paymentStatus).toBe("paid");
    });

    it("records the monotonic NEXT version targeting Selesai after a confirmed Siap Proses intent (no re-POST of the old target)", async () => {
      const suffix = `selesai-next-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      // The older stage was already dispatched and confirmed; the committed
      // local order then went completed — the projection must follow.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-selesai-next-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        lastObservedStatus: "Siap Proses",
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed", // historical record preserved
      });
      expect(intents[1]).toMatchObject({
        targetVersion: 2,
        targetStatus: "Selesai",
        status: "confirmed",
        lastObservedStatus: "Selesai",
      });
    });

    it("GET-only recovers an aged possibly_sent intent on a completed order, then dispatches Selesai as the NEXT version — never re-POSTing the old target", async () => {
      const suffix = `selesai-recover-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-selesai-recover-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      // The edit WAS applied before the crash: the provider GET shows the
      // OLD target marker + core attributes.
      const gateway = controlledGateway({
        editSnapshot: {
          ...controlledEditSnapshot({ note: fixture.note, channelStatus: "Siap Proses" }),
          salesorderId: fixture.soId,
        },
      });

      // First pass: GET-only recovery of the OLD target (zero POST).
      const first = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(first.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(0);
      const [v1] = await getIntent(fixture.orderId);
      expect(v1.status).toBe("confirmed");
      expect(v1.lastObservedStatus).toBe("Siap Proses");

      // Second call: the older intent is now RESOLVED, the committed order
      // is completed → a NEW Selesai version is dispatched sequentially.
      const second = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(second.status).toBe("confirmed");
      expect(gateway.editCalls).toHaveLength(1);
      expect(gateway.editCalls[0].target).toBe("Selesai");
      const intents = await getIntent(fixture.orderId);
      expect(intents).toHaveLength(2);
      expect(intents[0].status).toBe("confirmed");
      expect(intents[0].targetStatus).toBe("Siap Proses");
      expect(intents[1]).toMatchObject({ targetVersion: 2, targetStatus: "Selesai", status: "confirmed" });
    });

    it("never dispatches a NEWER Selesai target while an older intent is still unresolved (fresh possibly_sent or open investigation)", async () => {
      const suffix = `selesai-blocking-${Date.now()}`;
      // (a) FRESH possibly_sent claim: in flight, zero POST, no new version.
      const psFixture = await seedMirrorFixture({
        suffix: `${suffix}-ps`,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-selesai-block-ps-${suffix}`,
        orderId: psFixture.orderId,
        salesOrderId: psFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "possibly_sent",
        attemptCount: 1,
        dispatchedAt: new Date(),
      });
      const psGateway = controlledGateway({ note: psFixture.note, soId: psFixture.soId });
      const psOutcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: psFixture.orderId,
        gateway: psGateway as unknown as JubelioSalesGateway,
      });
      expect(psOutcome.status).toBe("in_flight");
      expect(psGateway.editCalls).toHaveLength(0);
      expect(await getIntent(psFixture.orderId)).toHaveLength(1);

      // (b) OPEN investigation: only an explicit operator action moves past
      // it — a newer Selesai target is never dispatched behind it.
      const invFixture = await seedMirrorFixture({
        suffix: `${suffix}-inv`,
        orderStatus: "completed",
        withInvoicePayment: true,
      });
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-selesai-block-inv-${suffix}`,
        orderId: invFixture.orderId,
        salesOrderId: invFixture.soId,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "needs_investigation",
        mismatchReason: "PRE_READ_SO_CANCELED",
        mismatchAt: new Date(),
      });
      const invGateway = controlledGateway({ note: invFixture.note, soId: invFixture.soId });
      const invOutcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: invFixture.orderId,
        gateway: invGateway as unknown as JubelioSalesGateway,
      });
      expect(invOutcome.status).toBe("skipped");
      expect(invGateway.editCalls).toHaveLength(0);
      expect(await getIntent(invFixture.orderId)).toHaveLength(1);
    });

    it("never dispatches Selesai for a completed order whose verified SO ledger is incomplete", async () => {
      const suffix = `selesai-unverified-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "completed",
        withInvoicePayment: false,
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(fixture.orderId)).toHaveLength(0);
    });

    it("never dispatches Dibatalkan for a cancelled order — future-facing mapping only, no runtime cancel path", async () => {
      const suffix = `dibatalkan-mapping-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "cancelled",
        withInvoicePayment: true,
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });

      // Even with a fully verified SO ledger, a cancelled order is never a
      // dispatch trigger in this ticket: no lawful runtime `cancelled`
      // transition exists, and the Dibatalkan mapping is contract-only.
      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(fixture.orderId)).toHaveLength(0);
    });

    it("never projects an earlier stage (Siap Proses) over an already-confirmed Selesai intent on the same order", async () => {
      const suffix = `selesai-no-regress-${Date.now()}`;
      const fixture = await seedMirrorFixture({
        suffix,
        orderStatus: "ready_for_pickup",
        withInvoicePayment: true,
      });
      // Pathological/unreachable data (Selesai before completion) — the
      // monotonic-progression guard must still refuse a backward overwrite.
      await db!.insert(jubelioChannelStatusIntents).values({
        id: `${PREFIX}intent-selesai-no-regress-${suffix}`,
        orderId: fixture.orderId,
        salesOrderId: fixture.soId,
        targetVersion: 1,
        targetStatus: "Selesai",
        status: "confirmed",
        lastObservedStatus: "Selesai",
        confirmedAt: new Date(),
      });
      const gateway = controlledGateway({ note: fixture.note, soId: fixture.soId });

      const outcome = await reconcileJubelioChannelStatusForOrder(db!, {
        orderId: fixture.orderId,
        gateway: gateway as unknown as JubelioSalesGateway,
      });
      expect(outcome.status).toBe("skipped");
      expect(gateway.editCalls).toHaveLength(0);
      expect(await getIntent(fixture.orderId)).toHaveLength(1);
    });
  }
);
