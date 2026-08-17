/**
 * True when at least one branch has at least one unit available
 * (Jubelio on-hand minus holds not yet confirmed by Jubelio). Confirmed
 * reservations are already reflected in `stock`, so subtracting
 * `reservedStock` again would double-count them. Returns false when stock rows
 * exist but no branch has a sellable unit.
 */
export function hasAvailableStock(
  branchStocks: { stock: number; pendingRemoteStock: number }[]
): boolean {
  return branchStocks.some((s) => s.stock - s.pendingRemoteStock > 0);
}
