/**
 * shipment-tracking — the SHARED pure tracking factory (ticket 06, spec
 * Ready "Pelacakan" + the Shipment v1.8 webhook contract).
 *
 * PUBLIC SEAM (pinned by shipment-tracking.test.ts):
 *   createShipmentTracking(db, gateway?, options?) — app-LOCAL: the caller
 *   injects its own typed FULL NodePgDatabase<typeof schema>, the optional
 *   GET gateway and its own logger; NOTHING cross-app is imported (no auth,
 *   no store/admin logger/network modules).
 *     handoff(orderId, actor)  — records the physical serah-terima: an
 *       orders:edit actor with the EXACT current-DB branch match (even the
 *       owner; all-branch visibility is never a bypass), a verified paid
 *       unblocked BOOKED ledger; NO provider POST, NO order completion; an
 *       idempotent stamp (once + audit).
 *     reconcile(orderId, actor)— GET-ONLY on the KNOWN AWB: the eligibility
 *       recheck is committed first, the single GET happens OUTSIDE any
 *       transaction, and a fresh rechecked+relocked transaction applies
 *       NOTHING unless the returned shipment_id/awb/ref_no match the order;
 *       the billed cost (price_bill) lands only when present (a non-blocking
 *       delta audit); an invalid/null billed stays unknown; after completion
 *       only informational GETs are allowed — late statuses/issues are never
 *       applied.
 *     ingestWebhook(rawBody, hexSignature, secret) — the trusted callback:
 *       the HMAC verification FIRST (before any parse/mutation), the raw
 *       UTF-8 body is never reserialized, a ~1 MiB cap is checked before the
 *       crypto, the normalized latest_status vocabulary is whitelisted (never
 *       the carrier's tracking.status codes), the dedupe is by the raw-body
 *       sha256 fingerprint, the progress is monotonic, DELIVERED completes
 *       (even an empty POD / no handoff stamp), and after completion NOTHING
 *       reopens (the late receipts are stored ignored — ticket 07 owns the
 *       follow-up). NO Midtrans/SO/stock/notification/refund writes; no
 *       polling; PII-safe audit changes only.
 *
 * Signature construction (the vendor's OWN example code): HMAC-SHA256 with
 * the key = the shared secret, over the message = the raw body + the secret,
 * compared as hex constant-time. Bad types / an empty secret / bad hex all
 * reject WITHOUT parsing.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auditLogs, branches, deliveryShipments, deliveryTrackingEvents, jubelioSalesOperations, orders, users } from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type TrackingDb = NodePgDatabase<typeof import("./schema")>;
type TrackingExecutor = TrackingDb | Parameters<Parameters<TrackingDb["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShipmentTrackingActor {
  id: string;
  homeBranchId: string | null;
  canEditOrders: boolean;
  policyVersion?: number | null;
}

export interface ShipmentTrackingGateway {
  /** GET /shipments/awb/{awb} — read-only detail; throws when unknown. */
  getAwb(awb: string): Promise<unknown>;
}

export interface ShipmentTrackingOptions {
  /** App-local structured logger injection (no cross-app imports). */
  logger?: {
    info(event: string, data?: Record<string, unknown>): void;
    error(event: string, data?: Record<string, unknown>): void;
  };
}

export interface ShipmentHandoffResult {
  status: "handed" | "already_handed";
}

export interface ShipmentReconcileResult {
  status: "reconciled";
  latestStatus: string | null;
  billedPrice: number | null;
}

export interface ShipmentWebhookResult {
  status: "applied" | "recorded" | "duplicate" | "ignored";
}

export type ShipmentTrackingErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_ELIGIBLE"
  | "INVALID_SIGNATURE"
  | "SHIPMENT_UNAVAILABLE"
  | "SHIPMENT_MALFORMED";

export class ShipmentTrackingError extends Error {
  readonly code: ShipmentTrackingErrorCode;

  constructor(code: ShipmentTrackingErrorCode, message: string) {
    super(message);
    this.name = "ShipmentTrackingError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Pure signature verification (the vendor's own example construction)
// ---------------------------------------------------------------------------

export function verifyShipmentSignature(
  rawBody: unknown,
  hexSignature: unknown,
  secret: unknown
): boolean {
  if (typeof rawBody !== "string" || rawBody.length === 0) return false;
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    typeof hexSignature !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(hexSignature)
  ) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody + secret)
    .digest("hex");
  const provided = hexSignature.toLowerCase();
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex")
  );
}

const MAX_WEBHOOK_BODY_CHARS = 1_048_576; // ~1 MiB cap, checked BEFORE crypto

const TRACKING_STATUS_RANK: Record<string, number> = {
  WAITING: 0,
  CONFIRMED_BY_COURIER: 1,
  ON_THE_WAY_PICK_UP: 2,
  PICKED_UP: 3,
  ON_DELIVERY: 4,
  DELIVERED: 5,
};

const EXCEPTION_STATUSES = new Set(["ON_HOLD", "RETURNED", "CANCELED", "SHIPMENT_ISSUE"]);
function knownStatus(status: string): boolean { return status in TRACKING_STATUS_RANK || EXCEPTION_STATUSES.has(status); }
function trackingTime(block: unknown): Date | null {
  const entries = Array.isArray(block) ? block : [block];
  const times = entries.map((entry) => entry && typeof entry === "object" ? (entry as Record<string, unknown>).date : null)
    .filter((value): value is string => typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
    .map((value) => Date.parse(value));
  return times.length ? new Date(Math.max(...times)) : null;
}
function advances(previous: string | null, next: string, previousAt: Date | null, nextAt: Date | null, authoritativeGet = false): boolean {
  if (!knownStatus(next) || previous === next || previous === "DELIVERED") return false;
  if (previousAt && nextAt && nextAt < previousAt) return false;
  if (EXCEPTION_STATUSES.has(next)) return true;
  if (previous && EXCEPTION_STATUSES.has(previous)) return authoritativeGet || !!(nextAt && previousAt && nextAt >= previousAt);
  return TRACKING_STATUS_RANK[next] > (previous ? TRACKING_STATUS_RANK[previous] ?? -1 : -1);
}

function nonBlank(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFinitePrice(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** A POD/storage URL must be a plain http(s) link — no javascript/userinfo. */
function safeHttpLink(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The shared audit writer (schema.auditLogs inside the caller's transaction)
// ---------------------------------------------------------------------------

async function auditInsert(
  tx: TrackingExecutor,
  values: {
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    changes: unknown;
    policyVersion: number | null;
    branchId: string | null;
  }
): Promise<void> {
  await tx.insert(auditLogs).values({
    id: crypto.randomUUID(),
    userId: values.userId,
    action: values.action,
    entityType: values.entityType,
    entityId: values.entityId,
    changes: values.changes,
    policyVersion: values.policyVersion,
    branchScope: "single_branch",
    branchId: values.branchId,
    ipAddress: null,
  });
}

// ---------------------------------------------------------------------------
// The eligibility core (mirrors shipment-fulfillment's gates, app-local)
// ---------------------------------------------------------------------------

async function requireTrackableOrder(
  db: TrackingExecutor,
  orderId: string,
  actor: ShipmentTrackingActor,
  options: ShipmentTrackingOptions
) {
  if (!actor.canEditOrders) {
    throw new ShipmentTrackingError("FORBIDDEN", "Butuh izin orders:edit.");
  }
  if (!nonBlank(actor.homeBranchId)) {
    throw new ShipmentTrackingError("FORBIDDEN", "Kebijakan tidak memiliki Home Branch.");
  }
  const actorRows = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  if (actorRows.length === 0 || actorRows[0].isActive !== true) {
    throw new ShipmentTrackingError("FORBIDDEN", "Admin tidak ditemukan atau tidak aktif.");
  }

  // The ORDER row lock: serializes handoff/reconcile with book/webhooks.
  const locked = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update")
    .limit(1);
  if (locked.length === 0 || locked[0].branchId !== actor.homeBranchId) {
    throw new ShipmentTrackingError("NOT_FOUND", "Pesanan tidak ditemukan.");
  }
  const order = locked[0];
  if (order.fulfillmentMethod !== "delivery") {
    throw new ShipmentTrackingError("NOT_ELIGIBLE", "Bukan pesanan pengiriman.");
  }
  if (order.paymentStatus !== "paid") {
    throw new ShipmentTrackingError("NOT_ELIGIBLE", "Pesanan belum dibayar.");
  }
  // A COMPLETED order stays open for informational reconciliation (the
  // reconcile rules); everything else must be an unblocked processing order.
  if (order.status !== "processing" && order.status !== "completed") {
    throw new ShipmentTrackingError(
      "NOT_ELIGIBLE",
      "Pesanan tidak berstatus pemenuhan pengiriman."
    );
  }
  if (order.fulfillmentBlockedReason) {
    throw new ShipmentTrackingError(
      "NOT_ELIGIBLE",
      "Settlement Jubelio belum terverifikasi."
    );
  }
  // Ticket 07 — the packing-failure flag also blocks the physical
  // handoff/reconcile actions (the resolution lives in the follow-up).
  if (order.deliveryFailureCode) {
    throw new ShipmentTrackingError(
      "NOT_ELIGIBLE",
      "Pesanan ditandai tidak dapat dipenuhi — buka daftar tindak lanjut pengiriman."
    );
  }

  // The CURRENT DB branch must still exist and be ACTIVE (an owner's stale
  // Home Branch is never a bypass and a dead branch cannot hand off).
  const branchRows = await db
    .select({ id: branches.id, status: branches.status })
    .from(branches)
    .where(eq(branches.id, order.branchId as string))
    .limit(1);
  if (branchRows.length === 0 || branchRows[0].status !== "aktif") {
    throw new ShipmentTrackingError("NOT_ELIGIBLE", "Cabang asal kirim tidak aktif.");
  }

  // The verified ledger: both operations confirmed WITH the ids matching.
  const ops = await db
    .select({
      type: jubelioSalesOperations.type,
      status: jubelioSalesOperations.status,
      invoiceId: jubelioSalesOperations.invoiceId,
      paymentId: jubelioSalesOperations.paymentId,
    })
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.orderId, orderId));
  const invoiceOp = ops.find((op) => op.type === "invoice");
  const paymentOp = ops.find((op) => op.type === "payment");
  if (
    !invoiceOp ||
    invoiceOp.status !== "confirmed" ||
    invoiceOp.invoiceId === null ||
    invoiceOp.invoiceId !== order.jubelioInvoiceId ||
    !paymentOp ||
    paymentOp.status !== "confirmed" ||
    paymentOp.paymentId === null ||
    paymentOp.paymentId !== order.jubelioPaymentId ||
    order.jubelioSalesOrderId === null
  ) {
    throw new ShipmentTrackingError(
      "NOT_ELIGIBLE",
      "Settlement Jubelio belum terverifikasi penuh."
    );
  }
  options.logger?.info("tracking eligibility verified", { orderId });
  return order;
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

export function createShipmentTracking(
  db: TrackingDb,
  gateway?: ShipmentTrackingGateway,
  options: ShipmentTrackingOptions = {}
) {
  const logger = options.logger;
  const logInfo = (event: string, data?: Record<string, unknown>) =>
    logger?.info(event, data);
  const logError = (event: string, data?: Record<string, unknown>) =>
    logger?.error(event, data);

  async function handoff(
    orderId: string,
    actor: ShipmentTrackingActor
  ): Promise<ShipmentHandoffResult> {
    return db.transaction(async (tx) => {
      const order = await requireTrackableOrder(tx, orderId, actor, options);
      if (order.status === "completed") throw new ShipmentTrackingError("NOT_ELIGIBLE", "Pesanan sudah selesai; serah-terima baru tidak dapat dicatat.");
      const ledgerRows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const ledger = ledgerRows[0];
      if (
        !ledger ||
        ledger.state !== "booked" ||
        !nonBlank(ledger.awb) ||
        ledger.shipmentId === null ||
        !ledger.bookedAt ||
        !nonBlank(ledger.bookedBy)
      ) {
        throw new ShipmentTrackingError(
          "NOT_ELIGIBLE",
          "Pesanan belum memiliki booking pengiriman terverifikasi."
        );
      }
      if (ledger.handedOverAt) {
        // Idempotent: the stamp exists; no second write, no second audit.
        logInfo("shipment handoff already stamped", { orderId });
        return { status: "already_handed" as const };
      }
      await tx
        .update(deliveryShipments)
        .set({
          handedOverAt: new Date(),
          handedOverBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(deliveryShipments.id, ledger.id));
      await auditInsert(tx, {
        userId: actor.id,
        action: "SHIPMENT_HANDOFF",
        entityType: "order",
        entityId: orderId,
        changes: {
          handedOver: { from: false, to: true },
        },
        policyVersion: actor.policyVersion ?? null,
        branchId: actor.homeBranchId ?? null,
      });
      logInfo("shipment handoff recorded", { orderId });
      return { status: "handed" as const };
    });
  }

  async function reconcile(
    orderId: string,
    actor: ShipmentTrackingActor
  ): Promise<ShipmentReconcileResult> {
    if (!gateway) {
      throw new ShipmentTrackingError(
        "SHIPMENT_MALFORMED",
        "Gateway rekonsiliasi GET tidak tersedia."
      );
    }
    // ===== Reauthorize + eligibility in a committed, locked read tx ========
    let awb = "";
    await db.transaction(async (tx) => {
      await requireTrackableOrder(tx, orderId, actor, options);
      const rows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const ledger = rows[0];
      if (
        !ledger ||
        ledger.state !== "booked" ||
        !nonBlank(ledger.awb) ||
        ledger.shipmentId === null
      ) {
        throw new ShipmentTrackingError(
          "NOT_ELIGIBLE",
          "Tidak ada AWB terbook untuk direkonsiliasi."
        );
      }
      awb = nonBlank(ledger.awb);
    });

    // ===== The single GET happens OUTSIDE any transaction (no remote in a
    // DB transaction); the AWB is encodeURIComponent-encoded. =============
    const detail = (await gateway.getAwb(awb)) as Record<string, unknown>;

    // ===== Recheck + relock AFTER the GET, then apply (or not) ============
    return db.transaction(async (tx) => {
      const currentOrder = await requireTrackableOrder(tx, orderId, actor, options);
      const rows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      const ledger = rows[0];
      if (
        !ledger ||
        ledger.state !== "booked" ||
        !nonBlank(ledger.awb) ||
        ledger.shipmentId === null
      ) {
        throw new ShipmentTrackingError(
          "NOT_ELIGIBLE",
          "Ledger pengiriman berubah saat rekonsiliasi."
        );
      }
      // The returned identity must match THIS shipment exactly.
      const returnedId = Number(detail.shipment_id);
      const returnedAwb = nonBlank(detail.awb);
      const returnedRef = nonBlank(detail.ref_no);
      if (
        !Number.isSafeInteger(returnedId) ||
        returnedId !== ledger.shipmentId ||
        returnedAwb !== ledger.awb ||
        (returnedRef && returnedRef !== orderId)
      ) {
        logError("shipment reconcile identity mismatch", { orderId });
        throw new ShipmentTrackingError(
          "SHIPMENT_MALFORMED",
          "Detail AWB tidak cocok dengan pesanan ini. Tidak ada perubahan diterapkan."
        );
      }

      const latestStatus = typeof detail.latest_status === "string" ? detail.latest_status.trim() : "";
      const providerAt = trackingTime(detail.tracking);
      const availableTracking = safeHttpLink(detail.tracking_url) ?? safeHttpLink(detail.live_tracking_url);
      const availablePod = latestStatus === "DELIVERED" ? safeHttpLink(detail.pod_url) : null;
      if ((availableTracking && availableTracking !== ledger.trackingUrl) || (availablePod && availablePod !== ledger.podUrl)) {
        await tx.update(deliveryShipments).set({
          ...(availableTracking ? { trackingUrl: availableTracking } : {}),
          ...(availablePod ? { podUrl: availablePod } : {}), updatedAt: new Date(),
        }).where(eq(deliveryShipments.id, ledger.id));
      }
      const billed = toFinitePrice(detail.price_bill); // null stays unknown
      const completed = currentOrder.status === "completed" || ledger.deliveredAt != null;
      if (!completed && advances(ledger.latestStatus, latestStatus, ledger.latestEventAt, providerAt, true)) {
        const delivered = latestStatus === "DELIVERED";
        await tx
          .update(deliveryShipments)
          .set({
            latestStatus,
            latestEventAt: providerAt ?? ledger.latestEventAt,
            ...(delivered ? { deliveredAt: providerAt ?? new Date(), podUrl: safeHttpLink(detail.pod_url) ?? ledger.podUrl } : {}),
            ...(billed !== null ? { billedPrice: String(billed) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(deliveryShipments.id, ledger.id));
        if (delivered) {
          // DELIVERED completes (verified GET) with no pickup code; no
          // Midtrans/SO/stock/notification writes, no refund.
          await tx
            .update(orders)
            .set({ status: "completed", fulfillmentBlockedReason: null, updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.status, "processing")));
        }
        await tx.insert(deliveryTrackingEvents).values({
          id: crypto.randomUUID(), shipmentId: ledger.id, externalShipmentId: ledger.shipmentId,
          refNo: orderId, awb: nonBlank(ledger.awb), latestStatus, source: 'get', applied: true,
          providerEventAt: providerAt, receivedAt: new Date(), appliedAt: new Date(),
          fingerprint: crypto.createHash('sha256').update('GET\n' + JSON.stringify([ledger.awb, latestStatus, providerAt?.toISOString() ?? null])).digest('hex'),
        }).onConflictDoNothing({ target: deliveryTrackingEvents.fingerprint });
        await auditInsert(tx, {
          userId: actor.id,
          action: "SHIPMENT_RECONCILED",
          entityType: "order",
          entityId: orderId,
          changes: {
            latestStatus: { from: ledger.latestStatus, to: latestStatus },
            billedPrice: { to: billed },
          },
          policyVersion: actor.policyVersion ?? null,
          branchId: actor.homeBranchId ?? null,
        });
        logInfo("shipment reconciled", { orderId, appliedStatus: latestStatus });
        return { status: "reconciled" as const, latestStatus, billedPrice: billed };
      }

      // Informational only — a completed order may still learn the billed
      // cost but NEVER a late status/issue/handoff; an absent bill stays NULL
      // (never 0).
      if (billed !== null && (ledger.billedPrice == null || Number(ledger.billedPrice) !== billed)) {
        await tx
          .update(deliveryShipments)
          .set({ billedPrice: String(billed), updatedAt: new Date() })
          .where(eq(deliveryShipments.id, ledger.id));
      }
      await auditInsert(tx, {
        userId: actor.id,
        action: "SHIPMENT_RECONCILED",
        entityType: "order",
        entityId: orderId,
        changes: {
          applied: { to: false },
          ...(latestStatus ? { ignoredStatus: { to: latestStatus } } : {}),
          billedPrice: { to: billed },
        },
        policyVersion: actor.policyVersion ?? null,
        branchId: actor.homeBranchId ?? null,
      });
      logInfo("shipment reconcile informational only", {
        orderId,
        latestStatus: latestStatus || null,
      });
      return {
        status: "reconciled" as const,
        latestStatus: ledger.latestStatus,
        billedPrice: billed ?? (ledger.billedPrice == null ? null : Number(ledger.billedPrice)),
      };
    });
  }

  async function ingestWebhook(
    rawBody: string,
    hexSignature: string,
    secret: string
  ): Promise<ShipmentWebhookResult> {
    // The ~1 MiB cap BEFORE any crypto work; an empty/oversized body refuses.
    if (typeof rawBody !== "string" || rawBody.length === 0) {
      throw new ShipmentTrackingError("INVALID_SIGNATURE", "Empty webhook body");
    }
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_CHARS) {
      logError("shipment webhook body too large", {});
      throw new ShipmentTrackingError("INVALID_SIGNATURE", "Webhook body too large");
    }
    // Verify FIRST — never parse before the trusted check; the raw body is
    // signed and read as-is (never reserialized).
    if (!verifyShipmentSignature(rawBody, hexSignature, secret)) {
      logError("shipment webhook signature invalid", {});
      throw new ShipmentTrackingError("INVALID_SIGNATURE", "Invalid webhook signature");
    }
    const fingerprint = crypto.createHash("sha256").update(rawBody).digest("hex");

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      logError("shipment webhook body unparseable", {});
      return { status: "ignored" };
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.event !== "awb") {
      // A tolerated but unhandled event family — never adopted.
      return { status: "ignored" };
    }

    const awb = nonBlank(envelope.awb);
    const reportedStatus = typeof envelope.latest_status === "string" ? envelope.latest_status.trim() : "";
    const reportedId = typeof envelope.shipment_id === "number" && Number.isSafeInteger(envelope.shipment_id) ? envelope.shipment_id : null;
    const reportedRef = nonBlank(envelope.ref_no);
    const trackingBlock = envelope.tracking;
    const providerEventAt = trackingTime(trackingBlock);
    const statusDetail = nonBlank(
      (trackingBlock as Record<string, unknown> | undefined)?.status_detail
    );

    return db.transaction(async (tx) => {
      // Locate ONLY a KNOWN AWB (never adopt/create shipments from a
      // callback) and lock the ORDER row for the receipt + the application.
      const ledgerRows = await tx
        .select()
        .from(deliveryShipments)
        .where(eq(deliveryShipments.awb, awb))
        .limit(1);
      let ledger = ledgerRows[0];
      if (!ledger) {
        // An unknown AWB changes nothing (no receipt without a shipment).
        return { status: "ignored" as const };
      }
      await tx.select().from(orders).where(eq(orders.id, ledger.orderId)).for("update").limit(1);
      const fresh = await tx.select().from(deliveryShipments).where(eq(deliveryShipments.id, ledger.id)).limit(1);
      if (!fresh[0]) return { status: "ignored" as const };
      ledger = fresh[0];
      const orderRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ledger.orderId))
        .limit(1);
      const order = orderRows[0];

      // The exact fingerprint already received → a duplicate: no insert, no
      // audit, no double effect.
      const duplicate = await tx
        .select({ id: deliveryTrackingEvents.id })
        .from(deliveryTrackingEvents)
        .where(eq(deliveryTrackingEvents.fingerprint, fingerprint))
        .limit(1);
      if (duplicate.length > 0) {
        return { status: "duplicate" as const };
      }

      // Matched metadata can enrich a completed delivery without reopening it.
      const matchedIdentity = reportedId === ledger.shipmentId && (!reportedRef || reportedRef === ledger.orderId);
      const availableTracking = matchedIdentity ? safeHttpLink(envelope.tracking_url) ?? safeHttpLink(envelope.live_tracking_url) : null;
      const availablePod = matchedIdentity && reportedStatus === "DELIVERED" ? safeHttpLink(envelope.pod_url) : null;
      if ((availableTracking && availableTracking !== ledger.trackingUrl) || (availablePod && availablePod !== ledger.podUrl)) {
        await tx.update(deliveryShipments).set({
          ...(availableTracking ? { trackingUrl: availableTracking } : {}),
          ...(availablePod ? { podUrl: availablePod } : {}), updatedAt: new Date(),
        }).where(eq(deliveryShipments.id, ledger.id));
      }
      let applied = false;
      let ignoredReason: string | null = "not_applicable";
      let nextStatus: string | null = null;

      if (reportedId === null || reportedId <= 0) {
        ignoredReason = "invalid_shipment_id";
      } else if (
        (reportedId !== null && reportedId !== ledger.shipmentId) ||
        (reportedRef && reportedRef !== ledger.orderId) ||
        awb !== ledger.awb
      ) {
        // An identity mismatch is recorded but never applied/adopted.
        ignoredReason =
          reportedId !== null && reportedId !== ledger.shipmentId
            ? "shipment_id_mismatch"
            : "ref_no_mismatch";
      } else if (!order) {
        ignoredReason = "order_missing";
      } else if (order.fulfillmentMethod !== "delivery") {
        ignoredReason = "not_delivery";
      } else if (order.status === "completed") {
        // Terminal: never reopen, never create new issues (ticket 07).
        ignoredReason = "order_completed";
      } else if (order.status !== "processing" || order.paymentStatus !== "paid" || order.fulfillmentBlockedReason) {
        ignoredReason = "order_not_ready";
      } else if (!reportedStatus) {
        ignoredReason = "missing_status";
      } else if (!knownStatus(reportedStatus)) {
        // An unknown vocabulary: received, recorded, ignored.
        ignoredReason = "unknown_status";
      } else {
        if (!advances(ledger.latestStatus, reportedStatus, ledger.latestEventAt, providerEventAt)) {
          // Monotonic progress: an older/equal event is recorded, not applied.
          ignoredReason = "older_status";
        } else {
          ignoredReason = null;
        }
      }

      if (ignoredReason === null) {
        applied = true;
        nextStatus = reportedStatus;
        const delivered = reportedStatus === "DELIVERED";
        await tx
          .update(deliveryShipments)
          .set({
            latestStatus: nextStatus,
            latestEventAt: providerEventAt ?? ledger.latestEventAt,
            ...(delivered
              ? {
                  deliveredAt: providerEventAt ?? new Date(),
                  podUrl: safeHttpLink(envelope.pod_url) ?? ledger.podUrl,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(deliveryShipments.id, ledger.id));
        if (delivered) {
          // DELIVERED completes even with an EMPTY POD and no handoff stamp;
          // the pickup code stays null; no Midtrans/SO/stock/notification
          // writes and no refund.
          await tx
            .update(orders)
            .set({ status: "completed", fulfillmentBlockedReason: null, updatedAt: new Date() })
            .where(and(eq(orders.id, ledger.orderId), eq(orders.status, "processing")));
        }
        await auditInsert(tx, {
          userId: null,
          action: "SHIPMENT_TRACKING_EVENT",
          entityType: "order",
          entityId: ledger.orderId,
          changes: {
            latestStatus: { from: ledger.latestStatus, to: nextStatus },
            delivered: { to: delivered },
          },
          policyVersion: null,
          branchId: order?.branchId ?? null,
        });
      }

      await tx.insert(deliveryTrackingEvents).values({
        id: crypto.randomUUID(),
        shipmentId: ledger.id,
        externalShipmentId: reportedId,
        refNo: reportedRef || null,
        awb,
        latestStatus: reportedStatus || null,
        statusDetail: statusDetail || null,
        fingerprint,
        receivedAt: new Date(),
        applied,
        appliedAt: applied ? new Date() : null,
        ignoredReason,
        providerEventAt,
      });

      return {
        status: (applied ? "applied" : "recorded") as ShipmentWebhookResult["status"],
      };
    });
  }

  return { handoff, reconcile, ingestWebhook };
}