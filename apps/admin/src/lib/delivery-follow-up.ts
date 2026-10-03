/**
 * delivery-follow-up — the scoped follow-up queue + the manual resolution
 * actions (ticket 07, spec Ready + tiket 07).
 *
 * PUBLIC SEAM (pinned by delivery-follow-up.db.test.ts):
 *   createDeliveryFollowUp(db) — NO gateway, NO provider method exists on
 *   this seam: the booking release NEVER creates a booking (a separate
 *   manual book via the ticket-05 service is the only way onward), and the
 *   settlement recovery stays the SYSTEM GET-only path (never an admin
 *   "mark verified" button).
 *
 *     list(actorView, kind) — 'settlement' | 'packing' | 'booking' |
 *       'shipment' | 'all'; every call is gated by orders:view + the Branch
 *       Scope: an own-branch scope sees ONLY its Home Branch's rows (the
 *       cross-branch rows hide), an all-branch scope sees everything, a
 *       denied view yields an EMPTY list. The COMPLETED orders are excluded
 *       from the open queue. The row summaries expose ONLY safe fields
 *       (names/status — the reason codes, never raw provider dumps).
 *
 *     failPacking(orderId, actor, reasonCode) — the EXACT spec codes only
 *       (physical_stock_unavailable | damaged_goods |
 *       paid_service_limits_exceeded); requires a verified paid unblocked
 *       processing DELIVERY order WITHOUT a remote booking/dispatch (the
 *       ledger absent or `packed`); keeps the order processing/paid; sets
 *       delivery_failure_code/at/by; audits transactionally. The flag blocks
 *       the normal packing/booking/handoff (the ticket-05/06 services guard
 *       it) and is NOT erased by the settlement sweep (which only clears the
 *       settlement block). No refund/cancel-SO/stock-adjustment/communication.
 *
 *     releaseBooking(orderId, actor, proof) — ONLY for the settled
 *       `booking_unknown` state (a live dispatch stays held): the proof is
 *       an AUTHORIZED HUMAN's audited attestation that Jubelio confirmed the
 *       first operation is CLOSED and NO booking exists —
 *       {source:'jubelio_confirmation', non-blank reference, non-blank
 *       reason, absenceConfirmed===true, operationClosed===true, attemptNumber
 *       === the CURRENT ledger attempt}. Never inferred from a
 *       timeout/404/elapsed time/blank dashes; if it cannot be proven the
 *       case stays held and escalates OUTSIDE the app; NO automatic create.
 *       The release moves unknown → packed in one conditional claim (only
 *       one simultaneous winner), archives the ORIGINAL dispatch actor/time/
 *       stored request into `delivery_booking_reviews` (per ledger+attempt
 *       unique), keeps the attempt count monotonic (never reset), and allows
 *       exactly ONE future atomic book claim; the stale/repeated same proofs
 *       are denied (each future attempt requires NEW proof).
 *
 *     finishManually(orderId, actor, reason) — ONLY for a KNOWN booked
 *       verified paid unblocked unflagged order whose tracking shows
 *       RETURNED/SHIPMENT_ISSUE OR whose physical handoff was stamped; the
 *       AWB alone is never evidence; the mandatory trimmed reason;
 *       processing → completed + delivery_manual_reason/at/by + the FINISH
 *       audit; NO pickup code; the late callbacks never reopen/requeue.
 *
 * Authorization on EVERY action/method: the FK-valid ACTIVE acting admin
 * (the user row read), orders:edit, and the EXACT current-DB Home Branch —
 * even for an owner/all-branch flag (visibility is never a bypass);
 * cross-branch and unknown ids hide behind NOT_FOUND.
 */
import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  deliveryBookingReviews,
  deliveryShipments,
  jubelioSalesOperations,
  orders,
  users,
} from "@/db";
import type {
  DeliverySnapshotPayload,
  ShipmentCreateRequestPayload,
} from "@marketplace/db/src/schema";
import { writeAuditEvent } from "@/lib/rbac/audit-writer";
import { createLogger } from "@/lib/logger";

const log = createLogger({ module: "delivery-follow-up" });

import { PACKING_FAILURE_REASONS } from './delivery-follow-up-contract';
export { PACKING_FAILURE_REASONS } from './delivery-follow-up-contract';

export const BOOKING_RELEASE_PROOF_SOURCE = "jubelio_confirmation";

export type PackingFailureReason = (typeof PACKING_FAILURE_REASONS)[number];
export type FollowUpListKind = "settlement" | "packing" | "booking" | "shipment" | "all";

export interface FollowUpViewActor {
  canViewOrders: boolean;
  viewScope: "all" | "own_branch";
  homeBranchId: string | null;
}

export interface FollowUpMutationActor {
  id: string;
  homeBranchId: string | null;
  canEditOrders: boolean;
  policyVersion?: number | null;
}

export interface BookingReleaseProof {
  source: string;
  reference: string;
  reason: string;
  attemptNumber: number;
  absenceConfirmed: boolean;
  operationClosed: boolean;
}

export interface FollowUpRow {
  orderId: string;
  kind: Exclude<FollowUpListKind, "all">;
  status: string;
  paymentStatus: string;
  deliveryFailureCode: string | null;
  fulfillmentBlockedReason: string | null;
  shipmentState: string | null;
  latestStatus: string | null;
  /** Safe display summary (branch/service/destination names only). */
  serviceName: string | null;
  destinationSummary: string | null;
  createdAt: string;
}

export type FollowUpErrorCode = "NOT_FOUND" | "FORBIDDEN" | "NOT_ELIGIBLE";

export class DeliveryFollowUpError extends Error {
  readonly code: FollowUpErrorCode;

  constructor(code: FollowUpErrorCode, message: string) {
    super(message);
    this.name = "DeliveryFollowUpError";
    this.code = code;
  }
}

function nonBlank(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const SHIPMENT_ISSUE_STATUSES = ["RETURNED", "SHIPMENT_ISSUE"] as const;

// The app's own drizzle instance type (the branches-service idiom): the
// transaction executor type derives from it.
import { db as appDb } from "@/db";
type FollowUpDb = typeof appDb;

export function createDeliveryFollowUp(db: FollowUpDb) {
  async function list(
    view: FollowUpViewActor,
    kind: FollowUpListKind
  ): Promise<FollowUpRow[]> {
    if (!view.canViewOrders) return [];
    const scopeOwn = view.viewScope === "own_branch";
    const home = nonBlank(view.homeBranchId);
    if (scopeOwn && !home) return [];

    const wanted = (candidate: Exclude<FollowUpListKind, "all">) =>
      kind === "all" || kind === candidate;

    type OrderRow = {
      id: string;
      status: string;
      paymentStatus: string;
      deliveryFailureCode: string | null;
      fulfillmentBlockedReason: string | null;
      createdAt: Date;
      snapshot: DeliverySnapshotPayload | null;
    };

    const parts: Array<FollowUpRow & { sortKey: number }> = [];

    async function collectLedger(
      filter: unknown[],
      kindValue: Exclude<FollowUpListKind, "all">,
      sortKey: number
    ): Promise<void> {
      const scope = [
        eq(orders.fulfillmentMethod, "delivery"),
        eq(orders.status, "processing"),
        eq(orders.paymentStatus, "paid"),
        ...(filter ?? []),
      ];
      if (scopeOwn) scope.unshift(eq(orders.branchId, home));
      const rows = (await db
        .select({
          id: orders.id,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          deliveryFailureCode: orders.deliveryFailureCode,
          fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
          createdAt: orders.createdAt,
          shipment: {
            state: deliveryShipments.state,
            awb: deliveryShipments.awb,
            latestStatus: deliveryShipments.latestStatus,
            latestEventAt: deliveryShipments.latestEventAt,
          },
          snapshot: orders.deliverySnapshot,
        })
        .from(orders)
        .innerJoin(deliveryShipments, eq(deliveryShipments.orderId, orders.id))
        .where(and(...(scope as never[])))) as unknown as OrderRow[];
      const merged = rows as unknown as Array<
        OrderRow & { shipment: { state: string | null; awb: string | null; latestStatus: string | null; latestEventAt: Date | null } }
      >;
      for (const row of merged) {
        const snapshot = row.snapshot ?? null;
        parts.push({
          orderId: row.id,
          kind: kindValue,
          status: row.status,
          paymentStatus: row.paymentStatus,
          deliveryFailureCode: row.deliveryFailureCode,
          fulfillmentBlockedReason: row.fulfillmentBlockedReason ? 'SETTLEMENT_UNVERIFIED' : null,
          shipmentState: row.shipment.state ?? null,
          latestStatus: row.shipment.latestStatus ?? null,
          serviceName: snapshot?.service ? String(snapshot.service.name) : null,
          destinationSummary: snapshot?.address
            ? `${snapshot.address.recipientName} — ${snapshot.address.fullAddress}`
            : null,
          createdAt: String(row.createdAt),
          sortKey,
        });
      }
    }

    async function collectPlain(
      filter: unknown[],
      kindValue: Exclude<FollowUpListKind, "all">,
      sortKey: number
    ): Promise<void> {
      const scope = [eq(orders.fulfillmentMethod, "delivery"), eq(orders.paymentStatus, 'paid'), ...(filter ?? [])];
      if (scopeOwn) scope.unshift(eq(orders.branchId, home));
      const rows = (await db
        .select({
          id: orders.id,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          deliveryFailureCode: orders.deliveryFailureCode,
          fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
          createdAt: orders.createdAt,
          snapshot: orders.deliverySnapshot,
        })
        .from(orders)
        .where(and(...(scope as never[])))) as unknown as OrderRow[];
      for (const row of rows) {
        const snapshot = row.snapshot ?? null;
        parts.push({
          orderId: row.id,
          kind: kindValue,
          status: row.status,
          paymentStatus: row.paymentStatus,
          deliveryFailureCode: row.deliveryFailureCode,
          fulfillmentBlockedReason: row.fulfillmentBlockedReason ? 'SETTLEMENT_UNVERIFIED' : null,
          shipmentState: null,
          latestStatus: null,
          serviceName: snapshot?.service ? String(snapshot.service.name) : null,
          destinationSummary: snapshot?.address
            ? `${snapshot.address.recipientName} — ${snapshot.address.fullAddress}`
            : null,
          createdAt: String(row.createdAt),
          sortKey,
        });
      }
    }

    if (wanted("settlement")) {
      // The paid-but-blocked delivery orders (the settlement unverified).
      await collectPlain([isNotNull(orders.fulfillmentBlockedReason), eq(orders.status, "processing")], "settlement", 0);
    }
    if (wanted("packing")) {
      // The packing-failed orders — the processing stays, the failure is
      // unresolved until a manual confirmation; excluded once completed.
      await collectPlain(
        [isNotNull(orders.deliveryFailureCode), eq(orders.status, "processing")],
        "packing",
        1
      );
    }
    if (wanted("booking")) {
      // The settled ambiguous booking ledger (the unknown holds).
      await collectLedger([inArray(deliveryShipments.state, ['booking_unknown', 'booking_dispatched'])], "booking", 2);
    }
    if (wanted("shipment")) {
      // RETURNED / SHIPMENT_ISSUE BEFORE the completion (never completed).
      await collectLedger(
        [or(inArray(deliveryShipments.latestStatus, [...SHIPMENT_ISSUE_STATUSES]), and(eq(deliveryShipments.state, 'booked'), isNotNull(deliveryShipments.handedOverAt), or(isNull(deliveryShipments.latestStatus), eq(deliveryShipments.latestStatus, 'WAITING'))))],
        "shipment",
        3
      );
    }

    // Dedupe by orderId: the earliest sorted kind wins (a stable class).
    const seen = new Map<string, FollowUpRow>();
    for (const row of parts.sort((left, right) => left.sortKey - right.sortKey)) {
      if (!seen.has(row.orderId)) seen.set(row.orderId, row);
    }
    log.info("delivery follow-up list", { kind, scope: view.viewScope, rows: seen.size });
    return Array.from(seen.values());
  }

  /**
   * The shared mutation gate: the FK-valid ACTIVE acting admin, orders:edit,
   * and the EXACT current-DB Home Branch (an all-branch owner is never a
   * bypass): the cross-branch/unknown ids hide behind NOT_FOUND; then the
   * delivery/paid/processing/unblocked state must hold.
   */
  async function requireDeliveryActionable(
    tx: Parameters<Parameters<FollowUpDb["transaction"]>[0]>[0],
    orderId: string,
    actor: FollowUpMutationActor
  ) {
    if (!actor.canEditOrders) {
      throw new DeliveryFollowUpError("FORBIDDEN", "Butuh izin orders:edit.");
    }
    if (!nonBlank(actor.homeBranchId)) {
      throw new DeliveryFollowUpError("FORBIDDEN", "Kebijakan tidak memiliki Home Branch.");
    }
    const actorRows = await tx
      .select({ id: users.id, isActive: users.isActive, branchId: users.branchId })
      .from(users)
      .where(eq(users.id, actor.id))
      .for('share')
      .limit(1);
    if (actorRows.length === 0 || actorRows[0].isActive !== true || actorRows[0].branchId !== actor.homeBranchId) {
      throw new DeliveryFollowUpError("FORBIDDEN", "Admin tidak ditemukan atau tidak aktif.");
    }
    const locked = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    if (locked.length === 0 || locked[0].branchId !== actor.homeBranchId) {
      throw new DeliveryFollowUpError("NOT_FOUND", "Pesanan tidak ditemukan.");
    }
    const order = locked[0];
    if (order.fulfillmentMethod !== "delivery") {
      throw new DeliveryFollowUpError("NOT_ELIGIBLE", "Bukan pesanan pengiriman.");
    }
    if (order.paymentStatus !== "paid") {
      throw new DeliveryFollowUpError("NOT_ELIGIBLE", "Pesanan belum dibayar.");
    }
    if (order.status !== "processing") {
      throw new DeliveryFollowUpError(
        "NOT_ELIGIBLE",
        "Pesanan tidak lagi dalam pemenuhan pengiriman."
      );
    }
    if (order.fulfillmentBlockedReason) {
      throw new DeliveryFollowUpError(
        "NOT_ELIGIBLE",
        "Settlement Jubelio belum terverifikasi. Pemulihan hanya GET-only sistem (tindak lanjut settlement)."
      );
    }
    const ops = await tx.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.orderId, orderId));
    const invoice = ops.find(op => op.type === 'invoice');
    const payment = ops.find(op => op.type === 'payment');
    const cancel = ops.find(op => op.type === 'cancel' && ['intent','dispatched_unknown','confirmed','manual_review'].includes(op.status));
    if (cancel || !order.jubelioSalesOrderId || !order.jubelioInvoiceId || !order.jubelioPaymentId ||
        invoice?.status !== 'confirmed' || invoice.salesOrderId !== order.jubelioSalesOrderId || invoice.invoiceId !== order.jubelioInvoiceId ||
        payment?.status !== 'confirmed' || payment.salesOrderId !== order.jubelioSalesOrderId || payment.invoiceId !== order.jubelioInvoiceId || payment.paymentId !== order.jubelioPaymentId) {
      throw new DeliveryFollowUpError('NOT_ELIGIBLE', 'Settlement Jubelio belum terverifikasi.');
    }
    if (order.deliveryFailureCode) throw new DeliveryFollowUpError('NOT_ELIGIBLE', 'Pesanan ditandai tidak dapat dipenuhi.');
    return order;
  }

  async function failPacking(
    orderId: string,
    actor: FollowUpMutationActor,
    reasonCode: string
  ): Promise<{ status: "packing_failed"; reasonCode: string }> {
    if (!(PACKING_FAILURE_REASONS as readonly string[]).includes(reasonCode)) {
      throw new DeliveryFollowUpError(
        "NOT_ELIGIBLE",
        "Alasan pemenuhan tidak dikenal; gunakan salah satu dari: " +
          PACKING_FAILURE_REASONS.join(", ") +
          "."
      );
    }
    return db.transaction(async (tx) => {
      const order = await requireDeliveryActionable(tx, orderId, actor);
      if (order.deliveryFailureCode) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Pesanan sudah ditandai tidak dapat dipenuhi."
        );
      }
      // The packing failure happens BEFORE a booking exists: the ledger must be
      // absent or merely `packed` — never booked/dispatched/booked-ambiguous.
      const ledgerRows = await tx
        .select({ id: deliveryShipments.id, state: deliveryShipments.state })
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const ledgerState = ledgerRows[0]?.state ?? null;
      if (ledgerState && ledgerState !== "packed") {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Pesanan sudah dikirim ke kurir (booking ada) — penandai gagal pada tahap packing tidak berlaku lagi."
        );
      }
      await tx
        .update(orders)
        .set({
          deliveryFailureCode: reasonCode,
          deliveryFailureAt: new Date(),
          deliveryFailureBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      await writeAuditEvent(tx, {
        actorId: actor.id,
        action: "SHIPMENT_PACKING_FAILED",
        entityType: "order",
        entityId: orderId,
        changes: {
          deliveryFailureCode: { from: null, to: reasonCode },
        },
        policyVersion: actor.policyVersion ?? null,
        branchScope: "single_branch",
        branchId: actor.homeBranchId ?? null,
      });
      log.info("packing failed recorded", { orderId, reasonCode });
      return { status: "packing_failed" as const, reasonCode };
    });
  }

  async function releaseBooking(
    orderId: string,
    actor: FollowUpMutationActor,
    proof: BookingReleaseProof | null
  ): Promise<{ status: "packed"; attemptNumber: number }> {
    return db.transaction(async (tx) => {
      await requireDeliveryActionable(tx, orderId, actor);
      const ledgerRows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const shipment = ledgerRows[0];
      if (!shipment) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Tidak ada ledger pengiriman untuk dilepas."
        );
      }
      if (shipment.state === "booked") {
        throw new DeliveryFollowUpError("NOT_ELIGIBLE", "Pesanan sudah terbook.");
      }
      if (shipment.state !== "booking_unknown") {
        // A live booking_dispatched is NOT releasable: the outcome is
        // unknown, not proven-absent — stay held, escalate outside the app.
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Tahanan booking hanya dilepas pada state ambigu yang sudah stabil (booking_unknown)."
        );
      }
      if (
        !proof ||
        typeof proof !== "object" ||
        proof.source !== BOOKING_RELEASE_PROOF_SOURCE ||
        !nonBlank(proof.reference) ||
        !nonBlank(proof.reason) ||
        proof.absenceConfirmed !== true ||
        proof.operationClosed !== true ||
        !Number.isSafeInteger(proof.attemptNumber) ||
        proof.attemptNumber !== shipment.attemptCount
      ) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Bukti rilis tidak lengkap/tidak cocok: konfirmasi Jubelio (operasi pertama ditutup tanpa booking) untuk attempt saat ini wajib."
        );
      }

      // The one-winner conditional claim (the concurrent loser's 0-row
      // result refuses with no insert).
      const released = await tx
        .update(deliveryShipments)
        .set({ state: "packed", updatedAt: new Date() })
        .where(
          and(
            eq(deliveryShipments.id, shipment.id),
            eq(deliveryShipments.state, "booking_unknown")
          )
        )
        .returning({ id: deliveryShipments.id });
      if (released.length === 0) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Tahanan sudah dilepas oleh aksi lain."
        );
      }
      // Archive the trusted attestation + the ORIGINAL dispatch history.
      await tx.insert(deliveryBookingReviews).values({
        id: crypto.randomUUID(),
        orderId,
        shipmentId: shipment.id,
        attemptNumber: shipment.attemptCount,
        originalDispatchedBy: shipment.dispatchedBy,
        originalDispatchedAt: shipment.dispatchedAt,
        archivedRequest: shipment.storedRequest as ShipmentCreateRequestPayload,
        proofSource: proof.source,
        proofReference: proof.reference,
        proofReason: proof.reason,
        absenceConfirmed: true,
        operationClosed: true,
        releasedBy: actor.id,
        releasedAt: new Date(),
      });
      await writeAuditEvent(tx, {
        actorId: actor.id,
        action: "SHIPMENT_BOOKING_RELEASED",
        entityType: "order",
        entityId: orderId,
        changes: {
          state: { from: "booking_unknown", to: "packed" },
          attemptNumber: { to: shipment.attemptCount },
          proofReference: { to: proof.reference },
        },
        policyVersion: actor.policyVersion ?? null,
        branchScope: "single_branch",
        branchId: actor.homeBranchId ?? null,
      });
      log.info("booking released by trusted attestation", {
        orderId,
        attemptNumber: shipment.attemptCount,
      });
      return { status: "packed" as const, attemptNumber: shipment.attemptCount };
    });
  }

  async function finishManually(
    orderId: string,
    actor: FollowUpMutationActor,
    reason: string
  ): Promise<{ status: "completed" }> {
    const trimmedReason = nonBlank(reason);
    if (!trimmedReason) {
      throw new DeliveryFollowUpError(
        "NOT_ELIGIBLE",
        "Alasan selesai manual wajib diisi."
      );
    }
    return db.transaction(async (tx) => {
      const order = await requireDeliveryActionable(tx, orderId, actor);
      if (order.deliveryFailureCode) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Pesanan ditandai tidak dapat dipenuhi — bukan kandidat selesai manual."
        );
      }
      const ledgerRows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const shipment = ledgerRows[0];
      if (
        !shipment ||
        shipment.state !== "booked" ||
        !nonBlank(shipment.awb) ||
        !shipment.bookedAt ||
        !nonBlank(shipment.bookedBy) ||
        shipment.bookedPrice == null
      ) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Hanya pesanan terbook lengkap (AWB/booking tersimpan) yang dapat diselesaikan manual; AWB saja bukan bukti."
        );
      }
      const issueTrack = SHIPMENT_ISSUE_STATUSES.includes(
        (shipment.latestStatus ?? "") as (typeof SHIPMENT_ISSUE_STATUSES)[number]
      );
      const physicalEvidence = shipment.handedOverAt != null || ['PICKED_UP', 'ON_DELIVERY'].includes(shipment.latestStatus ?? '');
      if (!issueTrack && !physicalEvidence) {
        throw new DeliveryFollowUpError(
          "NOT_ELIGIBLE",
          "Selesai manual membutuhkan kendala RETURNED/SHIPMENT_ISSUE atau bukti serah-terima fisik; AWB saja tidak cukup."
        );
      }
      await tx
        .update(orders)
        .set({
          status: "completed",
          deliveryManualReason: trimmedReason,
          deliveryManualAt: new Date(),
          deliveryManualBy: actor.id,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, "processing")));
      await writeAuditEvent(tx, {
        actorId: actor.id,
        action: "SHIPMENT_MANUAL_FINISH",
        entityType: "order",
        entityId: orderId,
        changes: {
          status: { to: "completed" },
          manualReason: { to: trimmedReason },
        },
        policyVersion: actor.policyVersion ?? null,
        branchScope: "single_branch",
        branchId: actor.homeBranchId ?? null,
      });
      log.info("delivery finished manually", { orderId });
      return { status: "completed" as const };
    });
  }

  return { list, failPacking, releaseBooking, finishManually };
}