/**
 * True when at least one branch has at least one unit available
 * (stock minus reserved). Used to grey out product cards whose product
 * exists in the DB but has no sellable stock in any branch.
 */
export function hasAvailableStock(
  branchStocks: { stock: number; reservedStock: number }[]
): boolean {
  return branchStocks.some((s) => s.stock - s.reservedStock > 0);
}
