import { and, eq, inArray, sql } from "drizzle-orm";
import { db, jubelioSalesOperations, orderItems, orders } from "@/db";
import { recordOrderCommunicationEvent } from "@marketplace/db/src/order-communications/order-communication-repository";
import { recordJubelioSalesIntent } from "@/lib/jubelio-sales-operations";
import {
  describeFailureEvidence,
  failureEvidenceMatches,
  failureStatusToken,
  type FailureEvidence,
} from "@/features/payments/payment-evidence";

/**
 * Persistence untuk transisi gagal order dan kewajiban cancel Sales Order
 * (spec TX-05 §10.1).
 *
 * Satu transaksi memuat: transisi `pending_payment → failed_payment`, cancel
 * intent durable pada ledger Jubelio existing, dan satu fakta komunikasi.
 * Tidak ada HTTP provider di dalam transaksi — dispatcher cancel berjalan
 * setelah commit, sehingga crash di antara keduanya tetap meninggalkan
 * pekerjaan yang bisa dilanjutkan.
 *
 * Repository ini juga pemilik guard mutual exclusion cancel/invoice: cancel
 * hanya dibuat bila invoice/payment belum aktif, dan transisi gagal ditolak
 * (`payment_active`) bila settlement sudah berjalan.
 */

export type WriteDatabase = Pick<typeof db, "transaction">;
type OrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PaymentFailureAttributes = {
  paymentType?: string;
  transactionId?: string;
};

export type FailureCommitOutcome =
  | {
      outcome: "committed";
      cancelObligationCreated: boolean;
      cancelObligationPending: boolean;
      orderCommunicationVersion: number;
    }
  | { outcome: "already_paid" }
  | { outcome: "not_eligible"; status: string }
  | { outcome: "payment_active" }
  | { outcome: "not_found" }
  | { outcome: "evidence_mismatch" };

/** Reference cancel stabil per order; dispatcher lama memakai nilai yang sama. */
export function cancelOperationReference(orderId: string): string {
  return `SO_CANCEL:${orderId}`;
}

const ACTIVE_SETTLEMENT_STATUSES = ["intent", "dispatched_unknown", "confirmed"] as const;

async function lockOrder(tx: OrderTx, orderId: string) {
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  const [row] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      salesOrderId: orders.jubelioSalesOrderId,
      orderCommunicationVersion: orders.orderCommunicationVersion,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Cancel intent hanya boleh dibuat bila invoice/payment belum aktif. Lock order
 * sudah dipegang, jadi urutan lock mengikuti order → provider ledger.
 */
async function hasActiveSettlement(tx: OrderTx, orderId: string): Promise<boolean> {
  const rows = await tx
    .select({ type: jubelioSalesOperations.type, status: jubelioSalesOperations.status })
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, orderId),
        inArray(jubelioSalesOperations.type, ["invoice", "payment"]),
        inArray(jubelioSalesOperations.status, [...ACTIVE_SETTLEMENT_STATUSES])
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function existingCancelOperation(tx: OrderTx, orderId: string) {
  const [row] = await tx
    .select({ status: jubelioSalesOperations.status })
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, orderId),
        eq(jubelioSalesOperations.type, "cancel")
      )
    )
    .limit(1);
  return row ?? null;
}

async function writeCancelObligation(
  tx: OrderTx,
  input: { orderId: string; salesOrderId: number }
): Promise<boolean> {
  const existing = await existingCancelOperation(tx, input.orderId);
  if (existing) return false;
  await recordJubelioSalesIntent(tx, {
    orderId: input.orderId,
    type: "cancel",
    reference: cancelOperationReference(input.orderId),
    salesOrderId: input.salesOrderId,
    payload: { type: "cancel", cancel: { salesOrderId: input.salesOrderId } },
  });
  return true;
}

/**
 * Commit gagal + kewajiban cancel secara atomik.
 *
 * Evidence yang tidak cocok dengan order/total (`evidence_mismatch`) tidak
 * mengubah apa pun: caller harus memperoleh observation baru, bukan menebak.
 */
export async function commitOrderFailureObligation(
  input: {
    orderId: string;
    evidence: FailureEvidence;
    now: Date;
    paymentAttributes?: PaymentFailureAttributes;
  },
  database: WriteDatabase = db
): Promise<FailureCommitOutcome> {
  return database.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return { outcome: "not_found" } as const;
    if (!failureEvidenceMatches(input.evidence, { reference: order.id, amount: order.total })) {
      return { outcome: "evidence_mismatch" } as const;
    }
    if (order.paymentStatus === "paid") return { outcome: "already_paid" } as const;
    if (order.status !== "pending_payment" || order.paymentStatus !== "pending") {
      return { outcome: "not_eligible", status: order.status } as const;
    }
    // A running settlement means the payment may already be verified locally:
    // failing it would contradict durable evidence. Keep it pending + review.
    if (await hasActiveSettlement(tx, input.orderId)) {
      return { outcome: "payment_active" } as const;
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: "failed_payment",
        paymentStatus: "failed",
        paymentFailureReason: describeFailureEvidence(input.evidence),
        midtransFailureStatus: failureStatusToken(input.evidence),
        ...(input.paymentAttributes?.paymentType
          ? { paymentMethod: input.paymentAttributes.paymentType }
          : {}),
        ...(input.paymentAttributes?.transactionId
          ? { midtransTransactionId: input.paymentAttributes.transactionId }
          : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.status, "pending_payment"),
          eq(orders.paymentStatus, "pending")
        )
      )
      .returning({ orderCommunicationVersion: orders.orderCommunicationVersion });
    if (!updated) return { outcome: "not_eligible", status: order.status } as const;

    // Cancel obligation is created ONLY for a confirmed Sales Order, in this
    // same commit. A never-confirmed SO needs no remote cancel.
    const cancelObligationCreated =
      order.salesOrderId != null
        ? await writeCancelObligation(tx, {
            orderId: input.orderId,
            salesOrderId: order.salesOrderId,
          })
        : false;
    const cancel = await existingCancelOperation(tx, input.orderId);

    if (updated.orderCommunicationVersion >= 1) {
      await recordOrderCommunicationEvent(tx, {
        orderId: input.orderId,
        kind: "payment_failed",
        source: "payment_failure",
        occurredAt: null,
        receivedAt: input.now,
      });
    }

    return {
      outcome: "committed",
      cancelObligationCreated,
      cancelObligationPending: cancel?.status === "intent",
      orderCommunicationVersion: updated.orderCommunicationVersion,
    } as const;
  });
}

/**
 * Repair kewajiban cancel untuk order historis yang sudah `failed_payment`
 * tetapi kehilangan cancel intent-nya (crash antara commit dan dispatch pada
 * versi lama). Hanya berjalan dengan evidence durable yang cocok; tidak
 * mengulang email/status gagal.
 */
export async function repairMissingCancelObligation(
  input: { orderId: string; evidence: FailureEvidence; now: Date },
  database: WriteDatabase = db
): Promise<FailureCommitOutcome> {
  return database.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return { outcome: "not_found" } as const;
    if (!failureEvidenceMatches(input.evidence, { reference: order.id, amount: order.total })) {
      return { outcome: "evidence_mismatch" } as const;
    }
    if (order.paymentStatus === "paid") return { outcome: "already_paid" } as const;
    if (order.status !== "failed_payment" || order.paymentStatus !== "failed") {
      return { outcome: "not_eligible", status: order.status } as const;
    }
    if (order.salesOrderId == null) {
      return { outcome: "not_eligible", status: "no_confirmed_sales_order" } as const;
    }
    if (await hasActiveSettlement(tx, input.orderId)) {
      return { outcome: "payment_active" } as const;
    }
    const cancelObligationCreated = await writeCancelObligation(tx, {
      orderId: input.orderId,
      salesOrderId: order.salesOrderId,
    });
    const cancel = await existingCancelOperation(tx, input.orderId);
    return {
      outcome: "committed",
      cancelObligationCreated,
      cancelObligationPending: cancel?.status === "intent",
      orderCommunicationVersion: order.orderCommunicationVersion,
    } as const;
  });
}

/** Block fulfillment for a PAID order (kept here so services never import routes). */
export async function blockPaidOrderFulfillment(
  orderId: string,
  reason: string,
  database: Pick<typeof db, "update"> = db
): Promise<void> {
  await database
    .update(orders)
    .set({ fulfillmentBlockedReason: reason, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "paid")));
}

export type FailureCommunicationContext = {
  order: {
    id: string;
    contactEmail: string;
    total: string;
    subtotal: string;
    serviceFee: string;
    ppnRate: string;
    ppnAmount: string;
    pickupDate: Date | null;
    pickupTime: string | null;
  };
  items: Array<{
    productName: string;
    variantInfo: string | null;
    price: string;
    quantity: number;
  }>;
};

/** Data proyeksi email gagal bayar untuk jalur komunikasi versi 0 (legacy). */
export async function readFailureCommunicationContext(
  orderId: string,
  database: Pick<typeof db, "select"> = db
): Promise<FailureCommunicationContext | null> {
  const [orderRow] = await database
    .select({
      id: orders.id,
      contactEmail: orders.contactEmail,
      total: orders.total,
      subtotal: orders.subtotal,
      serviceFee: orders.serviceFee,
      ppnRate: orders.ppnRate,
      ppnAmount: orders.ppnAmount,
      pickupDate: orders.pickupDate,
      pickupTime: orders.pickupTime,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!orderRow) return null;
  const items = await database
    .select({
      productName: orderItems.productName,
      variantInfo: orderItems.variantInfo,
      price: orderItems.price,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return { order: orderRow, items };
}

/** Total order terkini, dipakai pemanggil legacy untuk evidence amount. */
export async function readOrderTotal(
  orderId: string,
  database: Pick<typeof db, "select"> = db
): Promise<{ total: string; status: string; paymentStatus: string } | null> {
  const [row] = await database
    .select({ total: orders.total, status: orders.status, paymentStatus: orders.paymentStatus })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ?? null;
}
