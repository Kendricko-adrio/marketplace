import { and, eq } from "drizzle-orm";
import { cartItems } from "@/db";
import type { Db } from "@marketplace/db/src/jubelio-sync";
import type { CheckoutStockShortage } from "@marketplace/db/src/checkout-live-stock";

export type CheckoutStockAdjustment = {
  cartItemId: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
};

/** Same verified-stock cart contract for the cart button and final payment gate. */
export async function persistCheckoutStockAdjustments(
  db: Db,
  cartId: string,
  selectedItems: { cartItemId: string; variantId: string; branchId: string | null }[],
  shortages: CheckoutStockShortage[]
): Promise<CheckoutStockAdjustment[]> {
  const adjustments = shortages.map((shortage) => {
    const item = selectedItems.find((selected) => selected.variantId === shortage.variantId && selected.branchId === shortage.branchId);
    if (!item) throw new Error("Stock shortage does not match a selected cart item");
    return {
      cartItemId: item.cartItemId,
      productName: shortage.productName,
      requestedQuantity: shortage.requestedQuantity,
      availableQuantity: shortage.availableQuantity,
    };
  });
  await db.transaction(async (tx) => {
    for (const adjustment of adjustments) {
      // Zero is not a valid cart quantity. Keep the item, deselect in the UI.
      if (adjustment.availableQuantity === 0) continue;
      const changed = await tx.update(cartItems)
        .set({ quantity: adjustment.availableQuantity })
        .where(and(
          eq(cartItems.id, adjustment.cartItemId),
          eq(cartItems.cartId, cartId),
          eq(cartItems.quantity, adjustment.requestedQuantity)
        )).returning({ id: cartItems.id });
      if (!changed.length) throw new Error("Cart quantity changed during stock adjustment");
    }
  });
  return adjustments;
}

export function checkoutStockAdjustmentMessage(adjustments: CheckoutStockAdjustment[]): string {
  return adjustments.map((item) => item.availableQuantity === 0
    ? `${item.productName}: stok habis, dikeluarkan dari checkout tetapi tetap di keranjang.`
    : `${item.productName}: jumlah diubah dari ${item.requestedQuantity} menjadi ${item.availableQuantity} sesuai stok tersedia.`
  ).join(" ") + " Periksa kembali pesanan sebelum melanjutkan.";
}
