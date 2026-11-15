import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { refreshMappedJubelioStock } from "./jubelio-stock-refresh";
import { sellableUnits, isFreshStockSnapshot } from "../../../apps/store/src/lib/stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
let reachable = false;
try { const c = await pool.connect(); c.release(); reachable = true; } catch { console.warn("stock refresh DB tests skipped: PostgreSQL unavailable (not a pass)"); }
const db = drizzle(pool, { schema });
const prefix = "refresh-test-";
const id = 9_998_877;
let previousCursor: string | undefined;

async function fixture() {
  await pool.query("DELETE FROM product WHERE id = $1", [prefix + "product"]);
  await pool.query("DELETE FROM branch WHERE id = $1", [prefix + "branch"]);
  await pool.query("INSERT INTO product (id,name,slug,base_price,status) VALUES ($1,'Stock refresh','refresh-test-product',1000,'aktif')", [prefix + "product"]);
  await pool.query("INSERT INTO product_variant (id,product_id,sku,price,jubelio_item_id) VALUES ($1,$2,$3,1000,$4)", [prefix + "variant", prefix + "product", prefix + "sku", id]);
  await pool.query("INSERT INTO branch (id,name,code,city,address,jubelio_location_id) VALUES ($1,'Stock refresh','REFRESH-TEST','Test','Test',$2)", [prefix + "branch", id]);
  await pool.query("INSERT INTO branch_stock (branch_id,product_variant_id,stock,available_stock,pending_remote_stock,provider_stock_synced_at) VALUES ($1,$2,5,5,1,NOW() - INTERVAL '16 minutes')", [prefix + "branch", prefix + "variant"]);
  const cursor = await pool.query("SELECT value FROM system_config WHERE key = 'jubelio.stockRefreshCursor'");
  previousCursor = cursor.rows[0]?.value;
  await pool.query("INSERT INTO system_config (key,value) VALUES ('jubelio.stockRefreshCursor',$1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [String(id - 1)]);
}
const getRow = async () => (await pool.query("SELECT * FROM branch_stock WHERE branch_id = $1", [prefix + "branch"])).rows[0];
const good = () => ({ locations: [{ location_id: id, location_name: "Test" }], data: [{ item_id: id, location_stocks: [{ location_id: id, on_hand: 4, on_order: 1, reserved: 0, available: 3 }] }] });

describe("stock-only refresh against PostgreSQL", () => {
  it.skipIf(!reachable)("restores freshness while preserving a concurrent local hold and does not double-subtract", async () => {
    await fixture();
    expect(isFreshStockSnapshot((await getRow()).provider_stock_synced_at)).toBe(false);
    const result = await refreshMappedJubelioStock(db, { maxPages: 1, fetch: async () => {
      await pool.query("UPDATE branch_stock SET pending_remote_stock = pending_remote_stock + 1, updated_at = NOW() WHERE branch_id = $1", [prefix + "branch"]);
      return good();
    } });
    // The local hold changed while the provider read was in flight: an old
    // provider response must not overwrite the newer local accounting.
    expect(result.observed).toBe(0);
    const row = await getRow();
    expect(isFreshStockSnapshot(row.provider_stock_synced_at)).toBe(false);
    expect(row.pending_remote_stock).toBe(2);
    await pool.query("UPDATE system_config SET value = $1 WHERE key = 'jubelio.stockRefreshCursor'", [String(id - 1)]);
    const replay = await refreshMappedJubelioStock(db, { maxPages: 1, fetch: async () => good() });
    expect(replay.observed).toBe(1);
    const refreshed = await getRow();
    expect(refreshed.available_stock).toBe(3);
    expect(refreshed.pending_remote_stock).toBe(2);
    expect(sellableUnits({ availableStock: refreshed.available_stock, pendingRemoteStock: refreshed.pending_remote_stock })).toBe(1);
  });

  it.skipIf(!reachable)("missing, failed and repeat reads never freshen unavailable rows or reset holds", async () => {
    await pool.query("UPDATE system_config SET value = $1 WHERE key = 'jubelio.stockRefreshCursor'", [String(id - 1)]);
    const before = await getRow();
    const missing = await refreshMappedJubelioStock(db, { maxPages: 1, fetch: async () => ({ locations: [], data: [] }) });
    expect(missing.missing).toBe(1);
    expect((await getRow()).provider_stock_synced_at.getTime()).toBe(before.provider_stock_synced_at.getTime());
    await pool.query("UPDATE system_config SET value = $1 WHERE key = 'jubelio.stockRefreshCursor'", [String(id - 1)]);
    await expect(refreshMappedJubelioStock(db, { maxPages: 1, fetch: async () => { throw new Error("provider offline"); } })).rejects.toThrow("provider offline");
    expect((await getRow()).pending_remote_stock).toBe(2);
    await pool.query("UPDATE system_config SET value = $1 WHERE key = 'jubelio.stockRefreshCursor'", [String(id - 1)]);
    const again = await refreshMappedJubelioStock(db, { maxPages: 1, fetch: async () => good() });
    expect(again.observed).toBe(1);
    expect((await getRow()).pending_remote_stock).toBe(2);
  });
});

afterAll(async () => {
  if (reachable) {
    await pool.query("DELETE FROM product WHERE id = $1", [prefix + "product"]);
    await pool.query("DELETE FROM branch WHERE id = $1", [prefix + "branch"]);
    if (previousCursor === undefined) await pool.query("DELETE FROM system_config WHERE key = 'jubelio.stockRefreshCursor'");
    else await pool.query("UPDATE system_config SET value = $1 WHERE key = 'jubelio.stockRefreshCursor'", [previousCursor]);
  }
  await pool.end();
});
