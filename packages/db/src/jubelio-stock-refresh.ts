import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { branches, branchStocks, productVariants, systemConfig } from "./schema";
import type { Db, JubelioStockResponse } from "./jubelio-sync";
import { fetchStocks } from "./jubelio-sync";

const CURSOR_KEY = "jubelio.stockRefreshCursor";
const PAGE_SIZE = 100;
// 20k items per invocation, with a 5-minute cadence. Scan coverage and age
// are reported so operators can increase capacity before enabling checkout.
const MAX_PAGES = 200;

type Observation = { itemId: number; locationId: number; onHand: number; onOrder: number; reserved: number; available: number };

/** Only complete, self-consistent provider observations may refresh a row. */
export function selectObservedStock(resp: unknown, requested: ReadonlySet<number>, mapped: ReadonlySet<string>): Observation[] {
  if (!resp || typeof resp !== "object") return [];
  const body = resp as Partial<JubelioStockResponse>;
  if (!Array.isArray(body.locations) || !Array.isArray(body.data)) return [];
  const locations = new Set(body.locations.filter((l) => l && typeof l.location_name === "string" && l.location_name.trim()).map((l) => l.location_id));
  const seen = new Map<string, Observation | null>();
  for (const item of body.data) {
    if (!item || !requested.has(item.item_id) || !Array.isArray(item.location_stocks)) continue;
    for (const row of item.location_stocks) {
      if (!row || !locations.has(row.location_id)) continue;
      const key = `${item.item_id}:${row.location_id}`;
      if (!mapped.has(key)) continue;
      if (seen.has(key)) { seen.set(key, null); continue; }
      const [onHand, onOrder, available] = [row.on_hand, row.on_order, row.available];
      // The sandbox omits `reserved` when zero. Infer zero ONLY when the
      // explicit available and both other series prove it; do not mask a
      // positive unreported provider liability.
      const reserved = row.reserved ?? (onHand === undefined || onOrder === undefined || available === undefined || onHand - onOrder !== available ? NaN : 0);
      const good = [onHand, onOrder, reserved, available].every((n) => Number.isSafeInteger(n) && n! >= 0);
      if (!good || onHand! - onOrder! - reserved !== available) { seen.set(key, null); continue; }
      seen.set(key, { itemId: item.item_id, locationId: row.location_id, onHand: onHand!, onOrder: onOrder!, reserved, available: available! });
    }
  }
  return [...seen.values()].filter((row): row is Observation => row !== null);
}

/** Claim the next keyset page before making any external reads (CAS cursor). */
async function claimPage(db: Db) {
  await db.insert(systemConfig).values({ key: CURSOR_KEY, value: "0", description: "Stock-only sync keyset cursor; not app configuration" }).onConflictDoNothing();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [cursor] = await db.select({ value: systemConfig.value }).from(systemConfig).where(eq(systemConfig.key, CURSOR_KEY));
    const last = Number(cursor.value);
    if (!Number.isSafeInteger(last) || last < 0) throw new Error("stock refresh cursor invalid");
    const query = (after: number) => db.selectDistinct({ itemId: productVariants.jubelioItemId })
      .from(productVariants).innerJoin(branchStocks, eq(branchStocks.productVariantId, productVariants.id))
      .innerJoin(branches, and(eq(branches.id, branchStocks.branchId), sql`${branches.jubelioLocationId} is not null`))
      .where(and(sql`${productVariants.jubelioItemId} is not null`, gt(productVariants.jubelioItemId, after)))
      .orderBy(productVariants.jubelioItemId).limit(PAGE_SIZE);
    let page = await query(last);
    if (!page.length && last !== 0) page = await query(0);
    if (!page.length) return [];
    const ids = page.map((r) => r.itemId!).filter((n) => Number.isSafeInteger(n) && n > 0);
    if (!ids.length) throw new Error("stock refresh mapped item ids invalid");
    const won = await db.update(systemConfig).set({ value: String(ids.at(-1)), updatedAt: new Date() })
      .where(and(eq(systemConfig.key, CURSOR_KEY), eq(systemConfig.value, cursor.value))).returning({ key: systemConfig.key });
    if (won.length) return ids;
  }
  throw new Error("stock refresh cursor contention");
}

export async function refreshMappedJubelioStock(db: Db, opts: { maxPages?: number; fetch?: typeof fetchStocks } = {}) {
  const maxPages = Math.min(MAX_PAGES, Math.max(1, opts.maxPages ?? MAX_PAGES));
  const read = opts.fetch ?? fetchStocks;
  const summary = { pages: 0, items: 0, observed: 0, missing: 0, failed: 0 };
  for (let page = 0; page < maxPages; page++) {
    const ids = await claimPage(db);
    if (!ids.length) break;
    summary.pages++;
    summary.items += ids.length;
    const mappings = await db.select({ itemId: productVariants.jubelioItemId, variantId: productVariants.id, branchId: branches.id, locationId: branches.jubelioLocationId, pending: branchStocks.pendingRemoteStock, available: branchStocks.availableStock, onOrder: branchStocks.onOrderStock })
      .from(productVariants).innerJoin(branchStocks, eq(branchStocks.productVariantId, productVariants.id))
      .innerJoin(branches, eq(branches.id, branchStocks.branchId))
      .where(inArray(productVariants.jubelioItemId, ids));
    const byPair = new Map(mappings.filter((r) => r.locationId != null).map((r) => [`${r.itemId}:${r.locationId}`, r]));
    // Capture before the read; older overlapping reads must not overwrite newer snapshots.
    const observedAt = new Date();
    try {
      const resp = await read(ids);
      const observations = selectObservedStock(resp, new Set(ids), new Set(byPair.keys()));
      summary.missing += byPair.size - observations.length;
      // One set-based UPDATE per 250 pairs, rather than one database roundtrip
      // per branch. The expected local counters are captured before the read:
      // an in-flight checkout or SO accounting change cannot be overwritten.
      for (let start = 0; start < observations.length; start += 250) {
        const values = observations.slice(start, start + 250).map((row) => {
          const match = byPair.get(`${row.itemId}:${row.locationId}`)!;
          return sql`(${match.branchId}::text, ${match.variantId}::text, ${row.onHand}::integer, ${row.onOrder}::integer, ${row.reserved}::integer, ${row.available}::integer, ${match.pending}::integer, ${match.available}::integer, ${match.onOrder}::integer)`;
        });
        const updated = await db.execute(sql`
          UPDATE branch_stock AS bs
          SET stock = v.on_hand, on_order_stock = v.on_order,
              provider_reserved_stock = v.reserved, available_stock = v.available,
              provider_stock_synced_at = ${observedAt}, updated_at = ${observedAt}
          FROM (VALUES ${sql.join(values, sql`, `)}) AS v
            (branch_id, product_variant_id, on_hand, on_order, reserved, available,
             prior_pending, prior_available, prior_on_order)
          WHERE bs.branch_id = v.branch_id AND bs.product_variant_id = v.product_variant_id
            AND (bs.provider_stock_synced_at IS NULL OR bs.provider_stock_synced_at < ${observedAt})
            AND bs.pending_remote_stock = v.prior_pending
            AND bs.available_stock IS NOT DISTINCT FROM v.prior_available
            AND bs.on_order_stock = v.prior_on_order
          RETURNING bs.branch_id
        `);
        summary.observed += updated.rowCount ?? 0;
      }
    } catch (error) {
      summary.failed++;
      // No timestamp is touched when the read fails; advance to other items.
      // The next full keyset cycle revisits this page.
      if (opts.maxPages === 1) throw error;
    }
    if (ids.length < PAGE_SIZE) break;
  }
  return summary;
}
