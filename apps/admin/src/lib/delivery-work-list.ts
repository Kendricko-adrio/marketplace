import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db as appDb, orders, clients, branches, deliveryShipments, jubelioSalesOperations } from "@/db";
import { projectDeliveryStage } from "./delivery-workflow";
import { deliverySettlementVerified } from "./delivery-settlement";
import { deliverySnapshotValid } from "./shipment-fulfillment";

export const DELIVERY_QUEUES = ["actionable", "monitoring", "completed", "all"] as const;
export type DeliveryQueue = typeof DELIVERY_QUEUES[number];

// Public scoped read seam. The route supplies current server policy scope.
// All intersections and both totals precede pagination. No provider or writes.
export async function listDeliveryWork(database: typeof appDb, input: {
  scope: { mode: "own"; branchId: string } | { mode: "all" };
  branchId?: string | null;
  search?: string | null;
  stage?: string | null;
  queue: DeliveryQueue;
  from?: string | null;
  to?: string | null;
  page: number;
  orderIds?: string[];
}) {
  const conditions = [eq(orders.fulfillmentMethod, "delivery")];
  if (input.orderIds) conditions.push(input.orderIds.length ? inArray(orders.id, input.orderIds) : eq(orders.id, ""));
  if (input.scope.mode === "own") conditions.push(eq(orders.branchId, input.scope.branchId));
  else if (input.branchId) conditions.push(eq(orders.branchId, input.branchId));
  if (input.search) conditions.push(or(ilike(orders.id, `%${input.search}%`), ilike(clients.name, `%${input.search}%`), ilike(orders.contactPhone, `%${input.search}%`))!);
  return database.transaction(async (tx) => {
    const rows = await tx.select({ order: orders, customer: { id: clients.id, name: clients.name, email: clients.email }, branch: { id: branches.id, name: branches.name, city: branches.city }, shipment: deliveryShipments })
      .from(orders).innerJoin(clients, eq(clients.id, orders.userId)).leftJoin(branches, eq(branches.id, orders.branchId)).leftJoin(deliveryShipments, eq(deliveryShipments.orderId, orders.id))
      .where(and(...conditions)).orderBy(asc(orders.createdAt), asc(orders.id));
    const ops = rows.length ? await tx.select().from(jubelioSalesOperations).where(inArray(jubelioSalesOperations.orderId, rows.map((row) => row.order.id))) : [];
    const base = rows.map((row) => {
      const verified = deliverySettlementVerified(row.order, ops.filter((op) => op.orderId === row.order.id));
      const stage = projectDeliveryStage({ ...row.order, shipment: row.shipment, settlementVerified: verified });
      const actionable = row.order.status === "processing" && row.order.paymentStatus === "paid" && verified && !row.order.fulfillmentBlockedReason && !row.order.deliveryFailureCode && deliverySnapshotValid(row.order.deliverySnapshot) &&
        (row.shipment === null || row.shipment.state === "packed" || (row.shipment.state === "booked" && !row.shipment.handedOverAt && (!row.shipment.latestStatus || row.shipment.latestStatus === "WAITING")));
      const monitoring = !stage.terminal && row.order.status === "processing" && row.order.paymentStatus === "paid" && verified && !row.order.fulfillmentBlockedReason && !row.order.deliveryFailureCode && !["RETURNED", "SHIPMENT_ISSUE"].includes(row.shipment?.latestStatus ?? "") && row.shipment?.state === "booked" && (!!row.shipment.handedOverAt || ["PICKED_UP", "ON_DELIVERY", "ON_HOLD", "CANCELED"].includes(row.shipment.latestStatus ?? ""));
      return { ...row.order, customer: row.customer, branch: row.branch, stage, actionable, monitoring };
    }).filter((row) => (!input.stage || input.stage === row.stage.label) &&
      (input.queue === "all" || (input.queue === "actionable" && row.actionable) || (input.queue === "monitoring" && row.monitoring) || (input.queue === "completed" && ["Barang diterima", "Selesai manual"].includes(row.stage.label))));
    const from = input.from ? new Date(`${input.from}T00:00:00Z`).getTime() : -Infinity;
    const to = input.to ? new Date(`${input.to}T00:00:00Z`).getTime() + 86400000 : Infinity;
    const matching = base.filter((row) => row.createdAt.getTime() >= from && row.createdAt.getTime() < to);
    const totalPages = Math.ceil(matching.length / 20);
    const page = Math.min(Math.max(1, input.page), Math.max(1, totalPages));
    return { data: matching.slice((page - 1) * 20, page * 20).map((row) => ({ id: row.id, createdAt: row.createdAt, status: row.status, paymentStatus: row.paymentStatus, total: row.total, fulfillmentMethod: row.fulfillmentMethod, customer: row.customer, branch: row.branch, stage: row.stage })), pagination: { page, limit: 20, total: matching.length, baseTotal: base.length, totalPages } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
