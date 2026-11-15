import {
  db,
  carts,
  cartItems,
  branches,
  productVariants,
  products,
  clients,
  checkoutRequests,
  variantPriceCurrent,
  variantPriceRevisions,
  addresses,
  orders,
  orderItems,
  branchStocks,
} from "@/db";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import type { CheckoutRequestIdentity } from "@/lib/checkout-request";

export type PlaceOrderTx = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "select" | "insert" | "update" | "delete">;

export type PlaceOrderDatabase = Pick<typeof db, "select">;

export async function loadCart(userId: string, database: PlaceOrderDatabase = db) {
  return database
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);
}

export async function loadCartItems(cartId: string, database: PlaceOrderDatabase = db) {
  return database
    .select({
      cartItemId: cartItems.id,
      cartItemUpdatedAt: cartItems.updatedAt,
      quantity: cartItems.quantity,
      variantId: productVariants.id,
      variantColor: productVariants.color,
      variantSize: productVariants.size,
      variantPrice: productVariants.price,
      parcelDimensions: productVariants.parcelDimensions,
      jubelioItemId: productVariants.jubelioItemId,
      productId: products.id,
      productName: products.name,
      branchId: cartItems.branchId,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(cartItems.cartId, cartId));
}

export async function loadBranch(branchId: string, database: PlaceOrderDatabase = db) {
  return database
    .select()
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
}

export async function loadClientEmailVerified(clientId: string, database: PlaceOrderDatabase = db) {
  return database.select({ emailVerified: clients.emailVerified }).from(clients)
    .where(eq(clients.id, clientId)).limit(1);
}

export function lockCheckoutOwner(tx: PlaceOrderTx, clientId: string) {
  return tx.select({ id: clients.id }).from(clients)
    .where(eq(clients.id, clientId)).for("update");
}

export function loadAcceptedCheckoutRequest(tx: PlaceOrderTx, identity: CheckoutRequestIdentity) {
  return tx.select().from(checkoutRequests).where(and(
      eq(checkoutRequests.clientId, identity.clientId),
      eq(checkoutRequests.requestKey, identity.requestKey),
    )).limit(1);
}

export function loadFreshClient(tx: PlaceOrderTx, clientId: string) {
  return tx.select({ emailVerified: clients.emailVerified })
    .from(clients).where(eq(clients.id, clientId)).limit(1);
}

export function loadFreshVariants(tx: PlaceOrderTx, variantIds: string[]) {
  return tx.select().from(productVariants)
    .where(inArray(productVariants.id, variantIds))
    .orderBy(asc(productVariants.id)).for("update");
}

export function loadFreshMarkdown(tx: PlaceOrderTx, variantIds: string[]) {
  return tx
    .select({
      variantId: variantPriceCurrent.variantId,
      revisionId: variantPriceRevisions.id,
      targetUnitPrice: variantPriceRevisions.targetUnitPrice,
    })
    .from(variantPriceCurrent)
    .innerJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(inArray(variantPriceCurrent.variantId, variantIds))
    .orderBy(asc(variantPriceCurrent.variantId))
    .for("update");
}

export function loadFreshBranch(tx: PlaceOrderTx, branchId: string) {
  return tx.select().from(branches).where(eq(branches.id, branchId)).for("share");
}

export function loadAddress(tx: PlaceOrderTx, addressId: string, clientId: string) {
  return tx.select().from(addresses).where(and(eq(addresses.id, addressId), eq(addresses.userId, clientId))).for("share");
}

export function loadFreshCartItems(tx: PlaceOrderTx, cartId: string, ids: string[]) {
  return tx.select().from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), inArray(cartItems.id, ids)))
    .orderBy(asc(cartItems.id)).for("update");
}

export function holdBranchStock(tx: PlaceOrderTx, branchId: string, variantId: string, quantity: number, observedAt: Date) {
  return tx
    .update(branchStocks)
    .set({
      pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(branchStocks.branchId, branchId),
        eq(branchStocks.productVariantId, variantId),
        // Never hold against a snapshot superseded by a concurrent
        // webhook, checkout, or provider refresh.
        eq(branchStocks.providerStockSyncedAt, observedAt),
        sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} >= ${quantity}`
      )
    )
    .returning({ branchId: branchStocks.branchId });
}

export function loadHoldStockSnapshot(tx: PlaceOrderTx, branchId: string, variantId: string) {
  return tx
    .select({ availableStock: branchStocks.availableStock, providerStockSyncedAt: branchStocks.providerStockSyncedAt })
    .from(branchStocks)
    .where(
      and(
        eq(branchStocks.branchId, branchId),
        eq(branchStocks.productVariantId, variantId)
      )
    )
    .limit(1);
}

export function loadOrderBranch(tx: PlaceOrderTx, orderId: string) {
  return tx
    .select({ branchId: orders.branchId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
}

export function releaseHoldsOnReject(tx: PlaceOrderTx, orderBranchId: string, variantId: string, quantity: number) {
  return tx
    .update(branchStocks)
    .set({
      pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${quantity})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(branchStocks.branchId, orderBranchId),
        eq(branchStocks.productVariantId, variantId)
      )
    );
}

export function failOrderOnReject(tx: PlaceOrderTx, orderId: string, message: string) {
  return tx
    .update(orders)
    .set({
      status: "failed_payment",
      paymentStatus: "failed",
      paymentFailureReason: message,
      midtransFailureStatus: "sales_order_rejected",
      updatedAt: new Date(),
    })
    .where(
      and(eq(orders.id, orderId), eq(orders.status, "pending_payment"))
    );
}

export function persistPaymentRedirect(tx: PlaceOrderTx, orderId: string, redirectUrl: string) {
  return tx
    .update(orders)
    .set({
      snapRedirectUrl: redirectUrl,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

export function deleteCheckedOutCartItem(tx: PlaceOrderTx, itemId: string, cartId: string) {
  return tx
    .delete(cartItems)
    .where(
      and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId))
    );
}

export function insertOrder(tx: PlaceOrderTx, values: typeof orders.$inferInsert) { return tx.insert(orders).values(values); }
export function insertOrderItem(tx: PlaceOrderTx, values: typeof orderItems.$inferInsert) { return tx.insert(orderItems).values(values); }
export function insertCheckoutRequest(tx: PlaceOrderTx, values: typeof checkoutRequests.$inferInsert) { return tx.insert(checkoutRequests).values(values); }

export { recordJubelioSalesIntent as recordSalesIntent } from "@/lib/jubelio-sales-operations";

export type PlaceOrderSelectedItem = Awaited<ReturnType<typeof loadCartItems>>[number];
