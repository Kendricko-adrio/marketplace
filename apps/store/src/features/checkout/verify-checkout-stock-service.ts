import {
  verifyCheckoutStock,
  type CheckoutStockResult,
  type CheckoutStockSelection,
} from "@marketplace/db/src/checkout-live-stock";
import type { Db } from "@marketplace/db/src/jubelio-sync";
import {
  persistCheckoutStockAdjustments,
  type CheckoutStockAdjustment,
} from "@/lib/checkout-stock-adjustment";
import { createModuleLogger } from "@/lib/logger";

const log = createModuleLogger("verify-checkout-stock");

type VerifiedCartStockResult = Exclude<CheckoutStockResult, { reason: "insufficient" }> | (
  Extract<CheckoutStockResult, { reason: "insufficient" }> & { adjustments: CheckoutStockAdjustment[] }
);

/** Verifikasi seluruh observasi sebelum mengubah quantity; tidak membuat hold/order. */
export async function verifyAndAdjustCheckoutStock(
  db: Db,
  cartId: string,
  selections: (CheckoutStockSelection & { cartItemId: string })[]
): Promise<VerifiedCartStockResult> {
  const result = await verifyCheckoutStock(db, selections);
  if (result.ok || result.reason !== "insufficient") return result;

  try {
    const adjustments = await persistCheckoutStockAdjustments(db, cartId, selections, result.shortages);
    log.info(`cart quantities adjusted to verified stock (cart ${cartId}, items ${adjustments.length})`);
    return { ...result, adjustments };
  } catch {
    log.error("verified stock cart adjustment failed", new Error("Cart stock adjustment failed"));
    throw new Error("Cart stock adjustment failed");
  }
}
