import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, clients, checkoutRequests, orders, orderItems, branchStocks, jubelioSalesOperations } from "@/db";
import { dispatchJubelioSalesCreate } from "./jubelio-sales-lifecycle";
import {
  findRedemptionForOrder,
  lockRedemptionOwners,
  releaseReservedRedemption,
} from "./discount-lifecycle";
import { createModuleLogger } from "./logger";

/**
 * Module logger: hanya nama module yang di-bind di sini. Field korelasi dibaca
 * dari scope aktif saat baris ditulis, jadi aman dibuat sekali saat import.
 */
const log = createModuleLogger("checkout-recovery");

/** Bagian existing sweep, bukan worker/outbox baru. Tidak menginisialisasi Snap. */
export async function resumeUndispatchedCheckoutCreates(limit: number): Promise<number> {
  const rows = await db.select({ operation: jubelioSalesOperations }).from(jubelioSalesOperations)
    .innerJoin(checkoutRequests, eq(checkoutRequests.orderId, jubelioSalesOperations.orderId))
    .innerJoin(orders, and(eq(orders.id, checkoutRequests.orderId), eq(orders.userId, checkoutRequests.clientId)))
    .where(and(eq(jubelioSalesOperations.type, "create"), eq(jubelioSalesOperations.status, "intent"),
      eq(orders.status, "pending_payment"), eq(orders.paymentStatus, "pending"), gt(orders.expiresAt, new Date())))
    .orderBy(asc(jubelioSalesOperations.createdAt)).limit(Math.min(50, Math.max(1, limit)));
  let resumed = 0;
  for (const { operation } of rows) {
    try {
      if (!operation.orderId || operation.payload.type !== "create") continue;
      const outcome = await dispatchJubelioSalesCreate({ orderId: operation.orderId,
        create: operation.payload.create, checkoutRecovery: true });
      if (outcome.status === "confirmed") resumed++;
      log.info(`Order ${operation.orderId}: checkout create intent recovery completed (${outcome.status})`);
    } catch {
      log.error(`Order ${operation.orderId}: checkout create intent recovery unavailable`);
    }
  }
  const rejected = await db.select({ orderId: jubelioSalesOperations.orderId }).from(jubelioSalesOperations)
    .innerJoin(checkoutRequests, eq(checkoutRequests.orderId, jubelioSalesOperations.orderId))
    .where(and(eq(jubelioSalesOperations.type, "create"), eq(jubelioSalesOperations.status, "rejected"),
      isNull(jubelioSalesOperations.holdAccountedAt))).limit(Math.min(50, Math.max(1, limit)));
  for (const row of rejected) {
    if (!row.orderId) continue; // Attempt-owned operations use the separate attempt recovery.
    try { await finalizeRejectedCheckoutCreate(row.orderId); }
    catch { log.error(`Order ${row.orderId}: rejected checkout hold accounting unavailable`); }
  }
  return resumed;
}

/** Hanya bukti definitive pre-apply rejection; tidak pernah dipakai untuk ambiguity. */
export async function finalizeRejectedCheckoutCreate(orderId: string): Promise<void> {
  const [discovered] = await db.select().from(checkoutRequests).where(eq(checkoutRequests.orderId, orderId)).limit(1);
  if (!discovered) return;
  const redemption = await findRedemptionForOrder(orderId);
  const accounted = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, discovered.clientId)).for("update");
    const [receipt] = await tx.select().from(checkoutRequests).where(eq(checkoutRequests.id, discovered.id)).for("update");
    // Group 3 BEFORE the order: Offer identity → usage → client usage.
    if (redemption && redemption.status === "reserved") {
      await lockRedemptionOwners(tx, redemption);
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    const [op] = await tx.select().from(jubelioSalesOperations).where(and(
      eq(jubelioSalesOperations.orderId, orderId), eq(jubelioSalesOperations.type, "create"))).limit(1);
    if (!receipt || !order || order.userId !== receipt.clientId || !order.branchId || order.paymentStatus === "paid" ||
        !op || op.status !== "rejected" || op.holdAccountedAt) return false;
    const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.variantId));
    for (const line of lines) {
      await tx.update(branchStocks).set({ pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${line.quantity})`, updatedAt: new Date() })
        .where(and(eq(branchStocks.branchId, order.branchId), eq(branchStocks.productVariantId, line.variantId)));
    }
    // Definitive never-applied create is a SAFE unpaid terminal: release the
    // Redemption once, in the same commit as the stock accounting.
    if (redemption) {
      await releaseReservedRedemption(tx, {
        identity: redemption,
        orderId,
        source: "sales-order-rejected",
        reason: "Sales Order rejected definitively before apply",
      });
    }
    const [claimed] = await tx.update(jubelioSalesOperations).set({ holdAccountedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jubelioSalesOperations.id, op.id), eq(jubelioSalesOperations.status, "rejected"), isNull(jubelioSalesOperations.holdAccountedAt))).returning({ id: jubelioSalesOperations.id });
    if (!claimed) throw new Error("Rejected hold accounting claim changed.");
    await tx.update(orders).set({ status: "failed_payment", paymentStatus: "failed", paymentFailureReason: "Sales Order ditolak sebelum diterapkan.",
      midtransFailureStatus: "sales_order_rejected", updatedAt: new Date() }).where(eq(orders.id, orderId));
    return true;
  });
  if (accounted) log.info(`Order ${orderId}: definitively rejected checkout hold released once`);
}
