import { and, eq, lt, or, sql } from "drizzle-orm";
import { branchStocks } from "./schema";
import { fetchStocks, type Db, type JubelioStockResponse } from "./jubelio-sync";
import { selectObservedStock } from "./jubelio-stock-refresh";

export type CheckoutStockSelection = {
  branchId: string;
  variantId: string;
  itemId: number;
  locationId: number;
  quantity: number;
  productName: string;
};

export type CheckoutStockResult =
  | { ok: true; observedAt: Date }
  | { ok: false; reason: "insufficient" | "unavailable"; productName: string; detail?: string };

/**
 * Reconcile selected items with a fresh provider observation before any SO
 * intent/POST. External reads stay outside the order transaction; the local
 * hold is still acquired atomically afterwards, against this observation.
 * Never overwrite a concurrent hold, SO accounting update, or newer webhook.
 */
export async function verifyCheckoutStock(
  db: Db,
  selections: CheckoutStockSelection[],
  read: (itemIds: number[]) => Promise<JubelioStockResponse> = fetchStocks
): Promise<CheckoutStockResult> {
  if (!selections.length) return { ok: false, reason: "unavailable", productName: "produk" };
  const snapshots = [];
  for (const item of selections) {
    const [row] = await db.select({
      available: branchStocks.availableStock,
      pending: branchStocks.pendingRemoteStock,
      onOrder: branchStocks.onOrderStock,
    }).from(branchStocks).where(and(
      eq(branchStocks.branchId, item.branchId),
      eq(branchStocks.productVariantId, item.variantId)
    )).limit(1);
    if (!row) return { ok: false, reason: "unavailable", detail: "local_mapping_missing", productName: item.productName };
    snapshots.push(row);
  }

  // Capture BEFORE the network read so an older read cannot replace a newer
  // webhook/checkout observation. Never trust a response missing any pair.
  const observedAt = new Date();
  const ids = [...new Set(selections.map((item) => item.itemId))];
  let response: JubelioStockResponse;
  try {
    response = await read(ids);
  } catch {
    return { ok: false, reason: "unavailable", detail: "provider_read_failed", productName: selections[0].productName };
  }
  const mapped = new Set(selections.map((item) => `${item.itemId}:${item.locationId}`));
  const observed = selectObservedStock(response, new Set(ids), mapped);
  const byPair = new Map(observed.map((row) => [`${row.itemId}:${row.locationId}`, row]));
  if (byPair.size !== mapped.size) return { ok: false, reason: "unavailable", detail: "observation_missing_or_invalid", productName: selections[0].productName };

  for (const [index, item] of selections.entries()) {
    const remote = byPair.get(`${item.itemId}:${item.locationId}`)!;
    const before = snapshots[index];
    const updated = await db.update(branchStocks).set({
      stock: remote.onHand,
      onOrderStock: remote.onOrder,
      providerReservedStock: remote.reserved,
      availableStock: remote.available,
      providerStockSyncedAt: observedAt,
      updatedAt: observedAt,
    }).where(and(
      eq(branchStocks.branchId, item.branchId),
      eq(branchStocks.productVariantId, item.variantId),
      eq(branchStocks.pendingRemoteStock, before.pending),
      sql`${branchStocks.availableStock} IS NOT DISTINCT FROM ${before.available}`,
      eq(branchStocks.onOrderStock, before.onOrder),
      or(sql`${branchStocks.providerStockSyncedAt} is null`, lt(branchStocks.providerStockSyncedAt, observedAt))
    )).returning({ pending: branchStocks.pendingRemoteStock });
    if (!updated.length) return { ok: false, reason: "unavailable", detail: "concurrent_local_change", productName: item.productName };
    if (remote.available - updated[0].pending < item.quantity) {
      return { ok: false, reason: "insufficient", productName: item.productName };
    }
  }
  return { ok: true, observedAt };
}
