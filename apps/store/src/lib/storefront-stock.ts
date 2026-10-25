import { sql } from "drizzle-orm";
import { products, productVariants, branchStocks, branches } from "@/db";

/** Predikat berkorelasi: hanya pasangan mapped, cabang aktif, sellable > 0.
 * Stock provider sudah net reserved/on_order; kurangi pending lokal saja.
 */
export function sellableVariantSql(branchId?: string | null) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${branchStocks}
    JOIN ${branches} ON ${branches.id} = ${branchStocks.branchId}
    WHERE ${branchStocks.productVariantId} = ${productVariants.id}
      AND ${branches.status} = 'aktif'
      AND ${branches.jubelioLocationId} IS NOT NULL
      AND ${productVariants.jubelioItemId} IS NOT NULL
      AND COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} > 0
      ${branchId ? sql`AND ${branchStocks.branchId} = ${branchId}` : sql``}
  )`;
}

export function sellableProductSql() {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${productVariants}
    WHERE ${productVariants.productId} = ${products.id}
      AND ${sellableVariantSql()}
  )`;
}
