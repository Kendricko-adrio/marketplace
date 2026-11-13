/**
 * Repository `order-communications` — dipakai lintas app dengan executor
 * (db/tx) MILIK PEMANGGIL. Tidak ada instance database, auth, SMTP, atau
 * gateway provider di sini.
 *
 * Invariant yang dipegang modul ini:
 *   - Event unik per `(order_id, kind)`; replay tidak pernah membuat fakta
 *     kedua dan tidak pernah mereset checkpoint.
 *   - Tugas email unik per `(order_id, kind)`; claim memakai lease + token,
 *     attempt dicatat SEBELUM dispatch.
 *   - Notifikasi `delivery_ready` exactly-once secara logis: checkpoint
 *     `notification_created_at` adalah klaimnya, sehingga penghapusan baris
 *     notifikasi oleh admin tidak membuat notifikasi yang sama dibuat ulang.
 *   - Baris order dengan `order_communication_version = 0` tidak pernah
 *     mendapat efek baru.
 */

import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import {
  notifications,
  orderCommunicationEvents,
  orderEmailJobs,
  orders,
  jubelioSalesOperations,
  deliveryShipments,
} from "../schema";
import {
  ORDER_EMAIL_KINDS,
  ORDER_EMAIL_LEASE_MS,
  ORDER_EMAIL_MAX_ATTEMPTS,
  isOrderEmailKind,
  type ClaimedOrderEmailJob,
  type OrderCommunicationEventSnapshot,
  type OrderCommunicationKind,
  type OrderCommunicationState,
  type OrderEmailJobSnapshot,
  type OrderEmailKind,
  type OrderEmailJobStatus,
  type OrderEmailSendOutcome,
} from "./order-communication-contract";
import {
  isOrderEmailApplicable,
  nextOrderEmailAttempt,
} from "./order-communication-policy";

export type OrderCommunicationDb = NodePgDatabase<typeof schema>;
export type OrderCommunicationTx = Parameters<
  Parameters<OrderCommunicationDb["transaction"]>[0]
>[0];
export type OrderCommunicationExecutor =
  | OrderCommunicationDb
  | OrderCommunicationTx;

const DELIVERY_READY_NOTIFICATION_TITLE = "Order dibayar — siap diproses";

function deliveryReadyNotificationMessage(orderId: string): string {
  return `Order #${orderId.slice(0, 8).toUpperCase()} sudah dibayar dan siap disiapkan untuk pengiriman.`;
}

function safeErrorCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------------
// Event (fakta)
// ---------------------------------------------------------------------------

/**
 * Catat fakta komunikasi SEKALI per `(orderId, kind)`. Aman untuk replay dan
 * untuk pemanggil yang sudah berada di dalam transaksi bisnis.
 */
export async function recordOrderCommunicationEvent(
  tx: OrderCommunicationExecutor,
  input: {
    orderId: string;
    kind: OrderCommunicationKind;
    source: string;
    occurredAt: Date | null;
    receivedAt: Date;
  }
): Promise<{ eventId: string; created: boolean }> {
  const inserted = await tx
    .insert(orderCommunicationEvents)
    .values({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      kind: input.kind,
      source: input.source,
      occurredAt: input.occurredAt,
      receivedAt: input.receivedAt,
    })
    .onConflictDoNothing({
      target: [
        orderCommunicationEvents.orderId,
        orderCommunicationEvents.kind,
      ],
    })
    .returning({ id: orderCommunicationEvents.id });
  if (inserted.length > 0) {
    return { eventId: inserted[0].id, created: true };
  }
  const existing = await tx
    .select({ id: orderCommunicationEvents.id })
    .from(orderCommunicationEvents)
    .where(
      and(
        eq(orderCommunicationEvents.orderId, input.orderId),
        eq(orderCommunicationEvents.kind, input.kind)
      )
    )
    .limit(1);
  if (!existing[0]) {
    throw new Error("Order communication event could not be recorded");
  }
  return { eventId: existing[0].id, created: false };
}

// ---------------------------------------------------------------------------
// Authoritative state
// ---------------------------------------------------------------------------

const IN_TRANSIT_PROVIDER_STATUSES = ["PICKED_UP", "ON_DELIVERY", "DELIVERED"];

async function readVerifiedLedger(
  db: OrderCommunicationExecutor,
  orderId: string
): Promise<boolean> {
  const ops = await db
    .select({
      type: jubelioSalesOperations.type,
      status: jubelioSalesOperations.status,
      salesOrderId: jubelioSalesOperations.salesOrderId,
      invoiceId: jubelioSalesOperations.invoiceId,
      paymentId: jubelioSalesOperations.paymentId,
    })
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.orderId, orderId));
  const confirmed = (type: string) => {
    const op = ops.find((row) => row.type === type);
    return op != null && op.status === "confirmed";
  };
  const positive = (type: string) => {
    const op = ops.find((row) => row.type === type);
    if (!op) return false;
    const value =
      type === "create"
        ? op.salesOrderId
        : type === "invoice"
          ? op.invoiceId
          : op.paymentId;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  };
  return (
    confirmed("create") &&
    positive("create") &&
    confirmed("invoice") &&
    positive("invoice") &&
    confirmed("payment") &&
    positive("payment")
  );
}

function toEventSnapshot(
  row: typeof orderCommunicationEvents.$inferSelect
): OrderCommunicationEventSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    emailJobCreatedAt: row.emailJobCreatedAt,
    notificationCreatedAt: row.notificationCreatedAt,
  };
}

function toJobSnapshot(
  row: typeof orderEmailJobs.$inferSelect
): OrderEmailJobSnapshot {
  return {
    id: row.id,
    kind: row.kind as OrderEmailKind,
    eventId: row.eventId,
    status: row.status,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    claimToken: row.claimToken,
    leaseUntil: row.leaseUntil,
    sentAt: row.sentAt,
    errorCode: row.errorCode,
  };
}

/**
 * Baca keadaan authoritative order: baris order tersimpan + ledger provider
 * terverifikasi + bukti pengiriman tersimpan. Dipakai policy sebelum claim dan
 * sesaat sebelum dispatch.
 */
export async function readOrderCommunicationState(
  db: OrderCommunicationExecutor,
  orderId: string
): Promise<OrderCommunicationState | null> {
  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentMethod: orders.fulfillmentMethod,
      fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
      deliveryManualReason: orders.deliveryManualReason,
      orderCommunicationVersion: orders.orderCommunicationVersion,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order) return null;

  const [verifiedLedger, shipmentRows, eventRows, jobRows] = await Promise.all([
    readVerifiedLedger(db, orderId),
    db
      .select({
        handedOverAt: deliveryShipments.handedOverAt,
        latestStatus: deliveryShipments.latestStatus,
        deliveredAt: deliveryShipments.deliveredAt,
      })
      .from(deliveryShipments)
      .where(eq(deliveryShipments.orderId, orderId))
      .limit(1),
    db
      .select()
      .from(orderCommunicationEvents)
      .where(eq(orderCommunicationEvents.orderId, orderId)),
    db
      .select()
      .from(orderEmailJobs)
      .where(eq(orderEmailJobs.orderId, orderId)),
  ]);

  const shipment = shipmentRows[0] ?? null;
  const isDelivery = order.fulfillmentMethod === "delivery";
  const latestStatus =
    typeof shipment?.latestStatus === "string" ? shipment.latestStatus : null;
  const ready =
    order.paymentStatus === "paid" &&
    verifiedLedger &&
    order.fulfillmentBlockedReason == null &&
    ["processing", "ready_for_pickup", "completed"].includes(order.status);

  return {
    orderId: order.id,
    orderCommunicationVersion: order.orderCommunicationVersion,
    stage: {
      fulfillmentMethod: isDelivery ? "delivery" : "pickup",
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      ready,
      inTransit:
        isDelivery &&
        (shipment?.handedOverAt != null ||
          (latestStatus != null &&
            IN_TRANSIT_PROVIDER_STATUSES.includes(latestStatus))),
      delivered: isDelivery && shipment?.deliveredAt != null,
      closedManually: order.deliveryManualReason != null,
    },
    events: eventRows.map(toEventSnapshot),
    emailJobs: jobRows.map(toJobSnapshot),
  };
}

/**
 * Event committed yang masih punya efek belum diproduksi, dibatasi `limit` dan
 * hanya untuk order bermarker versi 1. Oldest first supaya batch selalu maju.
 */
export async function listProjectableOrderCommunications(
  db: OrderCommunicationExecutor,
  input: { limit: number; now: Date; orderId?: string }
): Promise<OrderCommunicationState[]> {
  const pendingEffect = or(
    and(
      isNull(orderCommunicationEvents.emailJobCreatedAt),
      inArray(orderCommunicationEvents.kind, [...ORDER_EMAIL_KINDS])
    ),
    and(
      eq(orderCommunicationEvents.kind, "delivery_ready"),
      isNull(orderCommunicationEvents.notificationCreatedAt)
    )
  ) as SQL;
  const conditions: SQL[] = [
    sql`${orders.orderCommunicationVersion} >= 1`,
    pendingEffect,
  ];
  if (input.orderId) {
    conditions.push(eq(orderCommunicationEvents.orderId, input.orderId));
  }
  const rows = await db
    .select({ orderId: orderCommunicationEvents.orderId })
    .from(orderCommunicationEvents)
    .innerJoin(orders, eq(orders.id, orderCommunicationEvents.orderId))
    .where(and(...conditions))
    .orderBy(asc(orderCommunicationEvents.receivedAt))
    .limit(Math.max(1, input.limit));

  const states: OrderCommunicationState[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.orderId)) continue;
    seen.add(row.orderId);
    const state = await readOrderCommunicationState(db, row.orderId);
    if (state) states.push(state);
  }
  return states;
}

// ---------------------------------------------------------------------------
// Materialisasi efek (email job + notifikasi)
// ---------------------------------------------------------------------------

async function ensureEmailJob(
  db: OrderCommunicationExecutor,
  input: { eventId: string; orderId: string; kind: OrderEmailKind; now: Date }
): Promise<boolean> {
  const inserted = await db
    .insert(orderEmailJobs)
    .values({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      kind: input.kind,
      eventId: input.eventId,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: [orderEmailJobs.orderId, orderEmailJobs.kind],
    })
    .returning({ id: orderEmailJobs.id });
  return inserted.length > 0;
}

/**
 * Produksi efek dari satu event committed.
 *
 * `applicable` dibaca ulang dari keadaan authoritative: bila tahap event sudah
 * dilewati, tidak ada job yang dibuat (dan checkpoint tetap ditulis supaya
 * event yang sama tidak diperiksa berulang). Notifikasi delivery exactly-once
 * logis memakai checkpoint `notification_created_at` sebagai klaim.
 */
export async function materializeOrderCommunicationEffects(
  db: OrderCommunicationExecutor,
  input: { eventId: string; now: Date }
): Promise<{ emailJobCreated: boolean; notificationCreated: boolean }> {
  const eventRows = await db
    .select()
    .from(orderCommunicationEvents)
    .where(eq(orderCommunicationEvents.id, input.eventId))
    .limit(1);
  const event = eventRows[0];
  if (!event) return { emailJobCreated: false, notificationCreated: false };

  // Keadaan authoritative dibaca SEKALI: efek apa pun (job email maupun
  // notifikasi) hanya diproduksi bila tahapnya masih tahap terakhir. Kondisi
  // terbaru selalu mengalahkan email/notifikasi lama, dan order versi 0 tidak
  // pernah menghasilkan efek.
  const state = await readOrderCommunicationState(db, event.orderId);

  let emailJobCreated = false;
  if (isOrderEmailKind(event.kind) && event.emailJobCreatedAt == null) {
    const applicable =
      state != null &&
      isOrderEmailApplicable({ kind: event.kind, state });
    if (applicable) {
      emailJobCreated = await ensureEmailJob(db, {
        eventId: event.id,
        orderId: event.orderId,
        kind: event.kind,
        now: input.now,
      });
    }
    await db
      .update(orderCommunicationEvents)
      .set({ emailJobCreatedAt: input.now })
      .where(
        and(
          eq(orderCommunicationEvents.id, event.id),
          isNull(orderCommunicationEvents.emailJobCreatedAt)
        )
      );
  }

  let notificationCreated = false;
  if (
    event.kind === "delivery_ready" &&
    event.notificationCreatedAt == null
  ) {
    const orderRows = await db
      .select({
        id: orders.id,
        branchId: orders.branchId,
        fulfillmentMethod: orders.fulfillmentMethod,
      })
      .from(orders)
      .where(eq(orders.id, event.orderId))
      .limit(1);
    const order = orderRows[0];
    const readyStillApplicable =
      state != null &&
      isOrderEmailApplicable({ kind: "delivery_ready", state });
    if (
      order &&
      order.branchId &&
      order.fulfillmentMethod === "delivery" &&
      readyStillApplicable
    ) {
      const claimed = await db
        .update(orderCommunicationEvents)
        .set({ notificationCreatedAt: input.now })
        .where(
          and(
            eq(orderCommunicationEvents.id, event.id),
            isNull(orderCommunicationEvents.notificationCreatedAt)
          )
        )
        .returning({ id: orderCommunicationEvents.id });
      if (claimed.length > 0) {
        const notificationId = crypto.randomUUID();
        await db.insert(notifications).values({
          id: notificationId,
          type: "order_paid",
          orderId: order.id,
          branchId: order.branchId,
          title: DELIVERY_READY_NOTIFICATION_TITLE,
          message: deliveryReadyNotificationMessage(order.id),
        });
        await db.execute(
          sql`SELECT pg_notify('new_notification', ${JSON.stringify({
            id: notificationId,
          })})`
        );
        notificationCreated = true;
      }
    }
  }

  return { emailJobCreated, notificationCreated };
}

// ---------------------------------------------------------------------------
// Antrean email: claim, lease, finish
// ---------------------------------------------------------------------------

/**
 * Claim atomik dengan lease. Job `sending` yang lease-nya kedaluwarsa boleh
 * di-claim lagi dengan SISA batas attempt yang sama (bukan reset nol); job
 * yang budget attempt-nya sudah habis ditutup `failed` lebih dulu sehingga
 * tidak pernah menyumbat batch.
 */
export async function claimDueOrderEmailJobs(
  db: OrderCommunicationDb,
  input: { limit: number; now: Date; leaseUntil?: Date }
): Promise<ClaimedOrderEmailJob[]> {
  const leaseUntil =
    input.leaseUntil ?? new Date(input.now.getTime() + ORDER_EMAIL_LEASE_MS);
  return db.transaction(async (tx) => {
    await tx
      .update(orderEmailJobs)
      .set({
        status: "failed",
        errorCode: "LEASE_EXPIRED_EXHAUSTED",
        claimToken: null,
        leaseUntil: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orderEmailJobs.status, "sending"),
          lte(orderEmailJobs.leaseUntil, input.now),
          sql`${orderEmailJobs.attemptCount} >= ${ORDER_EMAIL_MAX_ATTEMPTS}`
        )
      );

    const candidates = await tx
      .select({ id: orderEmailJobs.id })
      .from(orderEmailJobs)
      .where(
        and(
          sql`${orderEmailJobs.attemptCount} < ${ORDER_EMAIL_MAX_ATTEMPTS}`,
          or(
            and(
              inArray(orderEmailJobs.status, ["pending", "retry"]),
              lte(orderEmailJobs.nextAttemptAt, input.now)
            ),
            and(
              eq(orderEmailJobs.status, "sending"),
              lte(orderEmailJobs.leaseUntil, input.now)
            )
          )
        )
      )
      .orderBy(asc(orderEmailJobs.nextAttemptAt), asc(orderEmailJobs.id))
      .limit(Math.max(1, input.limit))
      .for("update", { skipLocked: true });

    const claimed: ClaimedOrderEmailJob[] = [];
    for (const candidate of candidates) {
      const claimToken = crypto.randomUUID();
      const updated = await tx
        .update(orderEmailJobs)
        .set({
          status: "sending",
          attemptCount: sql`${orderEmailJobs.attemptCount} + 1`,
          claimToken,
          leaseUntil,
          errorCode: null,
          updatedAt: input.now,
        })
        .where(eq(orderEmailJobs.id, candidate.id))
        .returning({
          id: orderEmailJobs.id,
          orderId: orderEmailJobs.orderId,
          kind: orderEmailJobs.kind,
          eventId: orderEmailJobs.eventId,
          attemptCount: orderEmailJobs.attemptCount,
          claimToken: orderEmailJobs.claimToken,
          leaseUntil: orderEmailJobs.leaseUntil,
        });
      const row = updated[0];
      if (!row || row.claimToken !== claimToken || row.leaseUntil == null) {
        continue;
      }
      claimed.push({
        id: row.id,
        orderId: row.orderId,
        kind: row.kind as OrderEmailKind,
        eventId: row.eventId,
        attemptCount: row.attemptCount,
        claimToken: row.claimToken,
        leaseUntil: row.leaseUntil,
      });
    }
    return claimed;
  });
}

export type FinishOrderEmailAttemptOutcome =
  | OrderEmailSendOutcome
  | "superseded";

/**
 * Tutup satu attempt. WAJIB membawa claim token: worker lama (lease
 * kedaluwarsa) tidak boleh menimpa claim baru.
 */
export async function finishOrderEmailAttempt(
  db: OrderCommunicationDb,
  input: {
    jobId: string;
    claimToken: string;
    outcome: FinishOrderEmailAttemptOutcome;
    now: Date;
    errorCode?: string | null;
  }
): Promise<boolean> {
  const rows = await db
    .select({
      id: orderEmailJobs.id,
      status: orderEmailJobs.status,
      attemptCount: orderEmailJobs.attemptCount,
    })
    .from(orderEmailJobs)
    .where(eq(orderEmailJobs.id, input.jobId))
    .limit(1);
  const current = rows[0];
  if (
    !current ||
    current.status !== "sending" ||
    current.attemptCount > ORDER_EMAIL_MAX_ATTEMPTS
  ) {
    return false;
  }

  const base = {
    claimToken: null,
    leaseUntil: null,
    updatedAt: input.now,
  };

  if (input.outcome === "accepted") {
    const updated = await db
      .update(orderEmailJobs)
      .set({
        ...base,
        status: "sent",
        sentAt: input.now,
        errorCode: null,
      })
      .where(
        and(
          eq(orderEmailJobs.id, input.jobId),
          eq(orderEmailJobs.claimToken, input.claimToken),
          eq(orderEmailJobs.status, "sending"),
          eq(orderEmailJobs.attemptCount, current.attemptCount)
        )
      )
      .returning({ id: orderEmailJobs.id });
    return updated.length > 0;
  }

  if (input.outcome === "superseded") {
    const updated = await db
      .update(orderEmailJobs)
      .set({ ...base, status: "superseded", errorCode: null })
      .where(
        and(
          eq(orderEmailJobs.id, input.jobId),
          eq(orderEmailJobs.claimToken, input.claimToken),
          eq(orderEmailJobs.status, "sending"),
          eq(orderEmailJobs.attemptCount, current.attemptCount)
        )
      )
      .returning({ id: orderEmailJobs.id });
    return updated.length > 0;
  }

  const decision = nextOrderEmailAttempt({
    attemptCount: current.attemptCount,
    outcome: input.outcome,
    now: input.now,
  });
  const updated = await db
    .update(orderEmailJobs)
    .set({
      ...base,
      status: decision.status,
      nextAttemptAt: decision.nextAttemptAt ?? input.now,
      errorCode: safeErrorCode(input.errorCode) ?? "EMAIL_DELIVERY_FAILED",
    })
    .where(
      and(
        eq(orderEmailJobs.id, input.jobId),
        eq(orderEmailJobs.claimToken, input.claimToken),
        eq(orderEmailJobs.status, "sending"),
        eq(orderEmailJobs.attemptCount, current.attemptCount)
      )
    )
    .returning({ id: orderEmailJobs.id });
  return updated.length > 0;
}

/** Status job yang masih mungkin dikirim (untuk diagnosa/batch berikutnya). */
export const ACTIVE_ORDER_EMAIL_JOB_STATUSES: readonly OrderEmailJobStatus[] = [
  "pending",
  "sending",
  "retry",
];
