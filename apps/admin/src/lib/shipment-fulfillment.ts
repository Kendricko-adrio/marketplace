/**
 * shipment-fulfillment — packing + booking Jubelio Shipment for verified-paid
 * DELIVERY orders (ticket 05, spec Ready "Booking, otorisasi, ledger biaya").
 *
 * PUBLIC SEAM (pinned by shipment-fulfillment.db.test.ts):
 *   createShipmentFulfillment(db, gateway)
 *     pack(orderId, actor) — locks the ORDER row, re-checks eligibility,
 *       rejects an already-existing ledger row, persists the packed intent
 *       + the STORED create request (built ONLY from the order's immutable
 *       `delivery_snapshot`; ref_no = orderId as a pure correlation; is_cod
 *       false; insurance off; NO invented package_detail/carton; string
 *       region ids + zipcodes) and audits SHIPMENT_PACKED.
 *     book(orderId, actor) — re-checks the same eligibility + Home Branch +
 *       the pack record, takes the ATOMIC ONE-TIME dispatch claim
 *       (`packed → booking_dispatched`, committed BEFORE the POST; the loser
 *       refuses without posting), then ONE provider POST (outside the
 *       transactions, no retries): a failure/timeout after the dispatch leaves
 *       a DURABLE booking_unknown (audit SHIPMENT_BOOKING_UNKNOWN) and a
 *       repeated book refuses; success: the persisted AWB + shipment id +
 *       http/https-checked tracking URL + THREE distinct money figures
 *       (quote rates / booked price / billed price — billed stays NULL when
 *       the provider did not send price_bill) and the mismatch is Audited but
 *       never blocks. The ORDER stays `processing`: an AWB is NOT a physical
 *       handoff and the order is NOT completed.
 *
 * Actor authorization is enforced HERE on EVERY action:
 *   - `canEditOrders` must hold (the API's orders:edit guard mirrors it);
 *   - the Home Branch must EXACTLY equal the order's branch — including the
 *     owner/an all-branch editor (visibility is never a bypass);
 *     cross-branch and unknown ids hide behind NOT_FOUND (existence is not
 *     disclosed);
 *   - a policy without a Home Branch can never pack or book; the acting admin
 *     row must exist and be active.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
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
import { createLogger, serializeError } from "@/lib/logger";

const log = createLogger({ module: "shipment-fulfillment" });

// The executor type mirrors the app's @/db instance and the transaction
// callback (the branches-service idiom).
import { db as appDb } from "@/db";
type Executor =
  | typeof appDb
  | Parameters<Parameters<typeof appDb.transaction>[0]>[0];

export interface ShipmentFulfillmentActor {
  /** Acting admin id (the audit actor). */
  id: string;
  /** Server-pinned Home Branch (Current Policy) — exact match required. */
  homeBranchId: string | null;
  /** orders:edit grant in force (the API guard mirrors it). */
  canEditOrders: boolean;
  /** Policy version in force, written onto the audit events (optional). */
  policyVersion?: number | null;
}

export type ShipmentFulfillmentErrorCode =
  | "NOT_FOUND" // unknown order OR a cross-branch order (existence hidden)
  | "FORBIDDEN" // missing orders:edit, no Home Branch policy, inactive admin
  | "NOT_ELIGIBLE" // unpaid/failed/pickup/blocked/unverified/already packed
  | "BOOKING_AMBIGUOUS"; // the dispatch is uncertain — no certainty, no retry

export class ShipmentFulfillmentError extends Error {
  readonly code: ShipmentFulfillmentErrorCode;

  constructor(code: ShipmentFulfillmentErrorCode, message: string) {
    super(message);
    this.name = "ShipmentFulfillmentError";
    this.code = code;
  }
}

export interface ShipmentCreateGateway {
  getAwb?(awb: string): Promise<unknown>;
  createShipment(
    request: ShipmentCreateRequestPayload
  ): Promise<{
    shipment_id: number;
    awb: string;
    tracking_url?: string;
    price: number;
    price_bill?: number;
  }>;
}

export interface PackedShipment {
  status: "packed";
}

export interface BookedShipment {
  status: "booked";
  shipmentId: number;
  awb: string;
  trackingUrl: string | null;
  /** The approved ongkir from the snapshot (e.g. 20000). */
  quoteRates: number;
  /** The provider's `price` (e.g. 25000). */
  bookingPrice: number;
  /** The provider's `price_bill` when present; NULL stays unknown (never 0). */
  billedPrice: number | null;
}

// ---------------------------------------------------------------------------
// Eligibility (fail closed; never touches the provider)
// ---------------------------------------------------------------------------

function nonBlank(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(n) ? n : null;
}

const SHIPMENT_ID_REGEX = /^\d{1,16}$/;
const ZIP_REGEX = /^\d{3,10}$/;

/**
 * Locks the ORDER row and re-checks eligibility for EVERY action (pack and
 * book alike). Under the row lock this also serializes concurrent pack/book
 * on the same order.
 */
async function requirePackableOrder(
  db: Executor,
  orderId: string,
  actor: ShipmentFulfillmentActor
) {
  if (!actor.canEditOrders) {
    throw new ShipmentFulfillmentError("FORBIDDEN", "Butuh izin orders:edit.");
  }
  if (!nonBlank(actor.homeBranchId)) {
    throw new ShipmentFulfillmentError(
      "FORBIDDEN",
      "Kebijakan tidak memiliki Home Branch."
    );
  }
  const actorRows = await db
    .select({ id: users.id, isActive: users.isActive, branchId: users.branchId })
    .from(users)
    .where(eq(users.id, actor.id))
    .for("share")
    .limit(1);
  if (actorRows.length === 0 || actorRows[0].isActive !== true || actorRows[0].branchId !== actor.homeBranchId) {
    throw new ShipmentFulfillmentError(
      "FORBIDDEN",
      "Admin tidak ditemukan atau tidak aktif."
    );
  }

  const locked = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update")
    .limit(1);
  if (locked.length === 0 || locked[0].branchId !== actor.homeBranchId) {
    // Unknown AND cross-branch both hide behind not-found.
    throw new ShipmentFulfillmentError("NOT_FOUND", "Pesanan tidak ditemukan.");
  }
  const order = locked[0];
  if (order.paymentStatus !== "paid") {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Pesanan belum dibayar.");
  }
  if (order.status !== "processing") {
    // failed_payment/expired and terminal states are the canonical rejects;
    // `expires_at` is only the UNPAID reservation TTL — a verified-paid
    // processing order stays packable even days after that clock.
    throw new ShipmentFulfillmentError(
      "NOT_ELIGIBLE",
      "Pesanan harus berstatus processing untuk pemenuhan pengiriman."
    );
  }
  if (order.fulfillmentMethod !== "delivery") {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Bukan pesanan pengiriman.");
  }
  if (order.fulfillmentBlockedReason) {
    throw new ShipmentFulfillmentError(
      "NOT_ELIGIBLE",
      "Settlement Jubelio belum terverifikasi. Lihat antrean review."
    );
  }
  // Ticket 07 — the packing-failure flag blocks the normal fulfillment
  // pipeline; the resolution lives in the delivery follow-up surfaces.
  if (order.deliveryFailureCode) {
    throw new ShipmentFulfillmentError(
      "NOT_ELIGIBLE",
      "Pesanan ditandai tidak dapat dipenuhi — buka daftar tindak lanjut pengiriman."
    );
  }

  // The verified settlement ledger: BOTH operations confirmed WITH the ids
  // matching the order row (no active cancel operation).
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
  const cancelOp = ops.find((op) => op.type === "cancel");
  if (cancelOp && ["intent", "dispatched_unknown", "confirmed", "manual_review"].includes(cancelOp.status)) {
    throw new ShipmentFulfillmentError(
      "NOT_ELIGIBLE",
      "Pembatalan Sales Order aktif — penanganan manual diperlukan."
    );
  }
  const invoiceOp = ops.find((op) => op.type === "invoice");
  if (
    !invoiceOp ||
    invoiceOp.status !== "confirmed" ||
    invoiceOp.invoiceId === null ||
    invoiceOp.invoiceId !== order.jubelioInvoiceId ||
    invoiceOp.salesOrderId !== order.jubelioSalesOrderId
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Invoice Jubelio belum terverifikasi.");
  }
  const paymentOp = ops.find((op) => op.type === "payment");
  if (
    !paymentOp ||
    paymentOp.status !== "confirmed" ||
    paymentOp.paymentId === null ||
    paymentOp.paymentId !== order.jubelioPaymentId ||
    paymentOp.invoiceId !== order.jubelioInvoiceId ||
    paymentOp.salesOrderId !== order.jubelioSalesOrderId ||
    order.jubelioSalesOrderId === null
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Pembayaran Jubelio belum terverifikasi.");
  }

  requireStrictSnapshot(order.deliverySnapshot);
  return order;
}

/** The delivery snapshot must be complete + strict (fail closed). */
function requireStrictSnapshot(snapshot: DeliverySnapshotPayload | null): DeliverySnapshotPayload {
  if (!snapshot) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot pengiriman tidak tersedia.");
  }
  const { address, origin, parcel, service, pricing } = snapshot;
  if (
    !nonBlank(address?.recipientName) ||
    !/\d/.test(nonBlank(address?.phone)) ||
    !nonBlank(address?.fullAddress) ||
    !ZIP_REGEX.test(nonBlank(address?.postalCode)) ||
    !SHIPMENT_ID_REGEX.test(nonBlank(address?.areaId)) ||
    !nonBlank(address?.province) ||
    !nonBlank(address?.city) ||
    !nonBlank(address?.district) ||
    !nonBlank(address?.area) ||
    !SHIPMENT_ID_REGEX.test(nonBlank(address?.provinceId)) ||
    !SHIPMENT_ID_REGEX.test(nonBlank(address?.cityId)) ||
    !SHIPMENT_ID_REGEX.test(nonBlank(address?.districtId))
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot alamat penerima belum lengkap.");
  }
  if (
    !nonBlank(origin?.name) ||
    !/\d/.test(nonBlank(origin?.phone)) ||
    !nonBlank(origin?.address) ||
    !ZIP_REGEX.test(nonBlank(origin?.zipcode)) ||
    (origin?.areaId != null && !SHIPMENT_ID_REGEX.test(nonBlank(origin?.areaId)))
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot asal kirim belum lengkap.");
  }
  if (
    !Number.isSafeInteger(parcel?.weight) ||
    (parcel?.weight ?? 0) <= 0 ||
    !Array.isArray(parcel?.items) ||
    parcel.items.length === 0
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot berat paket tidak valid.");
  }
  for (const item of parcel.items) {
    const value = toFiniteNumber(item?.value);
    if (
      !nonBlank(item?.item_name) ||
      !Number.isSafeInteger(item?.quantity) ||
      (item?.quantity ?? 0) <= 0 ||
      value === null ||
      value < 0 ||
      !Number.isSafeInteger(item?.weight) ||
      (item?.weight ?? 0) <= 0 ||
      [item?.length, item?.width, item?.height].some(
        (part) => typeof part !== "number" || !Number.isFinite(part) || (part as number) <= 0
      )
    ) {
      throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot barang tidak valid.");
    }
  }
  const quoteRates = toFiniteNumber(service?.shippingCost);
  if (
    !Number.isSafeInteger(service?.courierId) ||
    (service?.courierId ?? 0) <= 0 ||
    !Number.isSafeInteger(service?.serviceId) ||
    (service?.serviceId ?? 0) <= 0 ||
    !nonBlank(service?.name) ||
    quoteRates === null ||
    quoteRates < 0
  ) {
    throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot layanan tidak valid.");
  }
  for (const field of [
    "subtotal",
    "discount",
    "taxableBase",
    "shippingCost",
    "serviceFee",
    "ppnRatePercent",
    "ppnAmount",
    "total",
  ]) {
    const money = toFiniteNumber(
      (pricing as unknown as Record<string, unknown>)?.[field]
    );
    if (money === null || money < 0) {
      throw new ShipmentFulfillmentError("NOT_ELIGIBLE", "Snapshot harga tidak valid.");
    }
  }
  return snapshot;
}

/**
 * The strict, immutable /shipments/create request built ONLY from the
 * snapshot (documented fields; no invented carton; string ids; insurance off).
 */
function buildStoredRequest(
  snapshot: DeliverySnapshotPayload,
  orderId: string
): ShipmentCreateRequestPayload {
  const originAreaId = nonBlank(snapshot.origin.areaId);
  const destinationAreaId = nonBlank(snapshot.address.areaId);
  return {
    ref_no: orderId,
    courier_id: snapshot.service.courierId,
    courier_service_id: snapshot.service.serviceId,
    is_cod: false,
    shipping_insurance: 0,
    origin: {
      name: nonBlank(snapshot.origin.name),
      phone: nonBlank(snapshot.origin.phone),
      address: nonBlank(snapshot.origin.address),
      zipcode: nonBlank(snapshot.origin.zipcode),
      ...(originAreaId && SHIPMENT_ID_REGEX.test(originAreaId)
        ? { area_id: originAreaId }
        : {}),
    },
    destination: {
      name: nonBlank(snapshot.address.recipientName),
      phone: nonBlank(snapshot.address.phone),
      address: nonBlank(snapshot.address.fullAddress),
      zipcode: nonBlank(snapshot.address.postalCode),
      ...(destinationAreaId && SHIPMENT_ID_REGEX.test(destinationAreaId)
        ? { area_id: destinationAreaId }
        : {}),
    },
    items: snapshot.parcel.items.map((item) => ({
      item_name: nonBlank(item.item_name),
      quantity: item.quantity,
      value: Number(item.value ?? 0),
      weight: item.weight,
      length: item.length,
      width: item.width,
      height: item.height,
    })),
  };
}

export function createShipmentFulfillment(
  // A full database is required: a nested savepoint would NOT make the
  // dispatch intent durable before the external POST.
  db: typeof appDb,
  gateway: ShipmentCreateGateway
) {
  async function pack(
    orderId: string,
    actor: ShipmentFulfillmentActor
  ): Promise<PackedShipment> {
    return db.transaction(async (tx) => {
      const order = await requirePackableOrder(tx, orderId, actor);

      const existing = await tx
        .select({ id: deliveryShipments.id, state: deliveryShipments.state })
        .from(deliveryShipments)
        .where(eq(deliveryShipments.orderId, orderId))
        .limit(1);
      if (existing.length > 0) {
        // A stale/duplicate packing attempt is rejected — the ledger already
        // carries this order's intent.
        throw new ShipmentFulfillmentError(
          "NOT_ELIGIBLE",
          `Pesanan sudah berada di ledger pengiriman (state terkini: ${existing[0].state}).`
        );
      }

      const storedRequest = buildStoredRequest(
        order.deliverySnapshot as DeliverySnapshotPayload,
        orderId
      );
      await tx.insert(deliveryShipments).values({
        id: crypto.randomUUID(),
        orderId,
        state: "packed",
        storedRequest,
        attemptCount: 0,
        quoteRates: String(Number(order.deliverySnapshot!.service.shippingCost)),
        packedBy: actor.id,
      });

      await writeAuditEvent(tx, {
        actorId: actor.id,
        action: "SHIPMENT_PACKED",
        entityType: "order",
        entityId: orderId,
        changes: {
          state: { from: null, to: "packed" },
          quoteRates: { to: Number(order.deliverySnapshot!.service.shippingCost) },
          ref_no: { to: orderId },
        },
        policyVersion: actor.policyVersion ?? null,
        branchScope: "single_branch",
        branchId: order.branchId,
      });
      log.info("shipment packed", { orderId, refNo: orderId });
      return { status: "packed" };
    });
  }

  function refusalForState(state: string): ShipmentFulfillmentError {
    if (state === "booked") {
      return new ShipmentFulfillmentError("NOT_ELIGIBLE", "Pesanan sudah dibooking.");
    }
    if (state === "booking_dispatched" || state === "booking_unknown") {
      return new ShipmentFulfillmentError(
        "BOOKING_AMBIGUOUS",
        "Status booking tidak pasti — menunggu rekonsiliasi/kepastian manual; tidak ada POST ulang."
      );
    }
    return new ShipmentFulfillmentError(
      "NOT_ELIGIBLE",
      "Pesanan belum selesai di-pack (atau ledger tidak ditemukan)."
    );
  }

  async function book(
    orderId: string,
    actor: ShipmentFulfillmentActor
  ): Promise<BookedShipment> {
    // ===== 1) The atomic ONE-TIME dispatch claim commits BEFORE the POST ==
    // Under the locked order row + the conditional state update, exactly one
    // caller across service instances can claim; every loser refuses without
    // posting.
    const claimed = await db.transaction(async (tx) => {
      await requirePackableOrder(tx, orderId, actor);
      const claim = await tx
        .update(deliveryShipments)
        .set({
          state: "booking_dispatched",
          attemptCount: sql`${deliveryShipments.attemptCount} + 1`,
          dispatchedAt: new Date(),
          dispatchedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(deliveryShipments.orderId, orderId),
            eq(deliveryShipments.state, "packed")
          )
        )
        .returning({
          id: deliveryShipments.id,
          storedRequest: deliveryShipments.storedRequest,
          quoteRates: deliveryShipments.quoteRates,
          packedAt: deliveryShipments.createdAt,
        });
      if (claim.length === 0) {
        const rows = await tx
          .select({ state: deliveryShipments.state })
          .from(deliveryShipments)
          .where(eq(deliveryShipments.orderId, orderId))
          .limit(1);
        throw refusalForState(rows[0]?.state ?? "");
      }
      return claim[0];
    });
    const storedRequest = claimed.storedRequest as ShipmentCreateRequestPayload;
    const quoteRates = Number(claimed.quoteRates);

    // ===== 2) ONE provider POST (no retry; ambiguity stays ambiguous) =====
    // The claim is already COMMITTED: a crash between here and the settle
    // leaves a durable booking_dispatched/booking_unknown that a repeated
    // book can never silently re-POST.
    let result;
    try {
      result = await gateway.createShipment(storedRequest);
    } catch (error) {
      await db.transaction(async (tx) => {
      await tx
        .update(deliveryShipments)
        .set({ state: "booking_unknown", updatedAt: new Date() })
        .where(
          and(
            eq(deliveryShipments.orderId, orderId),
            eq(deliveryShipments.state, "booking_dispatched")
          )
        );
      await writeAuditEvent(tx, {
        actorId: actor.id,
        action: "SHIPMENT_BOOKING_UNKNOWN",
        entityType: "order",
        entityId: orderId,
        changes: {
          state: { from: "booking_dispatched", to: "booking_unknown" },
          reason: {
            to: error instanceof Error ? error.message : String(error),
          },
          quoteRates: { to: quoteRates },
        },
        policyVersion: actor.policyVersion ?? null,
        branchScope: "single_branch",
        branchId: actor.homeBranchId ?? null,
      });
      });
      log.error("shipment booking left ambiguous after dispatch", {
        orderId,
        refNo: storedRequest.ref_no,
        error: serializeError(error),
      });
      throw new ShipmentFulfillmentError(
        "BOOKING_AMBIGUOUS",
        "Booking tidak pasti (dispatch terkirim tanpa AWB). Menunggu rekonsiliasi; tidak ada POST ulang."
      );
    }

    // ===== 3) Booked: persist the AWB + THREE costs + the audit ===========
    const bookingPrice = Number(result.price);
    let billedPrice =
      result.price_bill === undefined || result.price_bill === null
        ? null
        : Number(result.price_bill);
    const trackingUrl =
      typeof result.tracking_url === "string" &&
      result.tracking_url.trim() &&
      /^https?:\/\//.test(result.tracking_url.trim())
        ? result.tracking_url.trim()
        : null;
    await db.transaction(async (tx) => {
    const saved = await tx
      .update(deliveryShipments)
      .set({
        state: "booked",
        shipmentId: result.shipment_id,
        awb: result.awb,
        trackingUrl,
        bookedPrice: String(bookingPrice),
        billedPrice: billedPrice === null ? null : String(billedPrice),
        bookedAt: new Date(),
        bookedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deliveryShipments.orderId, orderId),
          eq(deliveryShipments.state, "booking_dispatched")
        )
      ).returning({ id: deliveryShipments.id });
    if (saved.length !== 1) throw new ShipmentFulfillmentError("BOOKING_AMBIGUOUS", "Booking terkirim; penyimpanan hasil perlu rekonsiliasi.");

    await writeAuditEvent(tx, {
      actorId: actor.id,
      action: "SHIPMENT_BOOKED",
      entityType: "order",
      entityId: orderId,
      changes: {
        state: { from: "booking_dispatched", to: "booked" },
        awb: { to: result.awb },
        shipmentId: { to: result.shipment_id },
        quoteRates: { to: quoteRates },
        bookedPrice: { to: bookingPrice },
        billedPrice: { to: billedPrice },
        bookingDelta: { to: bookingPrice - quoteRates },
        billedDelta: { to: billedPrice === null ? null : billedPrice - quoteRates },
      },
      policyVersion: actor.policyVersion ?? null,
      branchScope: "single_branch",
      branchId: actor.homeBranchId ?? null,
    });
    });
    log.info("shipment booked", { orderId, awb: result.awb, refNo: storedRequest.ref_no });
    // Missing billing is a read-only observation AFTER durable booking success.
    // A failed/malformed GET never fails the booking and never repeats create.
    if (billedPrice === null && gateway.getAwb) {
      try {
        const detail = await gateway.getAwb(result.awb) as Record<string, unknown>;
        const observed = toFiniteNumber(detail?.price_bill);
        if (detail?.shipment_id !== result.shipment_id || detail.awb !== result.awb ||
            (detail.ref_no != null && detail.ref_no !== orderId) || observed === null || observed < 0) throw new Error('BILL_UNAVAILABLE');
        await db.transaction(async (tx) => {
          const saved = await tx.update(deliveryShipments).set({ billedPrice: String(observed), updatedAt: new Date() })
            .where(and(eq(deliveryShipments.orderId, orderId), eq(deliveryShipments.shipmentId, result.shipment_id), eq(deliveryShipments.state, 'booked')))
            .returning({ id: deliveryShipments.id });
          if (saved.length !== 1) throw new Error('BILL_UNAVAILABLE');
          await writeAuditEvent(tx, { actorId: actor.id, action: 'SHIPMENT_BILL_OBSERVED', entityType: 'order', entityId: orderId,
            changes: { billedPrice: { to: observed }, billedDelta: { to: observed - quoteRates } }, policyVersion: actor.policyVersion ?? null,
            branchScope: 'single_branch', branchId: actor.homeBranchId });
        });
        billedPrice = observed;
        log.info('shipment billed cost observed', { orderId });
      } catch { log.error('shipment billing lookup unavailable; booking remains successful', { orderId }); }
    }

    return {
      status: "booked",
      shipmentId: result.shipment_id,
      awb: result.awb,
      trackingUrl,
      quoteRates,
      bookingPrice,
      billedPrice,
    };
  }

  return { pack, book };
}