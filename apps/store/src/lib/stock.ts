/**
 * Sellable-stock rule for the Jubelio Sales-Order flow (plan:
 * jubelio-sales-api-switching, feature 1).
 *
 * `branch_stock.availableStock` mirrors the provider's own `available` figure
 * (= on_hand − on_order − reserved), captured by jubelio-sync. Because the
 * provider's `available` already nets out on_order/reserved, local code must
 * NEVER subtract the provider series again — the only local subtraction is
 * `pendingRemoteStock`, the units held for Sales Orders whose remote outcome
 * is not yet confirmed (acquired before the SO POST; released after a
 * confirmed cancel, or mirrored into `availableStock` when the SO is
 * confirmed and the provider takes over the liability).
 *
 * Fail closed: a NULL `availableStock` (row never synced, or an unusable
 * observation) exposes ZERO sellable units — never the on-hand mirror.
 *
 * Legacy note: `reservedStock` is a record of retired adjustment-era
 * movements and is deliberately NOT part of this formula (subtracting it
 * again would double-count the same deduction).
 */
export type SellableStockRow = {
  /** Jubelio on-hand mirror (informational in the SO flow). */
  stock: number;
  /** Local SO holds not yet confirmed remotely. */
  pendingRemoteStock: number;
  /** Provider `available` snapshot; NULL = never synced / unusable → 0. */
  availableStock: number | null;
};

// Historical/diagnostic snapshot-age helper: checkout no longer relies on a
// cached 15-minute window; it reads the provider live before each new SO.
// A local hold cannot refresh this provider-only timestamp.
export const MAX_PROVIDER_STOCK_AGE_MS = 15 * 60_000;

export function isFreshStockSnapshot(syncedAt: Date | null, now = new Date()): boolean {
  if (!(syncedAt instanceof Date)) return false;
  const age = now.getTime() - syncedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age <= MAX_PROVIDER_STOCK_AGE_MS;
}

/** Sellable units for one (branch, variant) row; never negative. */
export function sellableUnits(row: {
  availableStock: number | null;
  pendingRemoteStock: number;
}): number {
  const available = row.availableStock;
  if (available == null || !Number.isFinite(available) || available <= 0) {
    return 0;
  }
  return Math.max(0, available - row.pendingRemoteStock);
}

/**
 * True when at least one branch has at least one sellable unit
 * (provider `available` minus local unconfirmed SO holds). Returns false when
 * stock rows exist but no branch has a sellable unit, and — fail closed —
 * when no row has ever captured a provider `available` snapshot.
 */
export function hasAvailableStock(
  branchStocks: {
    stock: number;
    pendingRemoteStock: number;
    availableStock: number | null;
  }[]
): boolean {
  return branchStocks.some((s) => sellableUnits(s) > 0);
}