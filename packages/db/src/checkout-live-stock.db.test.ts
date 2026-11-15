import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { verifyCheckoutStock } from "./checkout-live-stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 2000 });
let reachable = false;
try { const client = await pool.connect(); client.release(); reachable = true; } catch { console.warn("checkout live-stock DB tests skipped: PostgreSQL unavailable"); }
const db = drizzle(pool, { schema });
const prefix = "checkout-live-test-";
const itemId = 9988771;
const locationId = 9988772;
const selection = [{ branchId: prefix + "branch", variantId: prefix + "variant", itemId, locationId, quantity: 1, productName: "Test product" }];
const response = (available: number) => ({
  locations: [{ location_id: locationId, location_name: "Test" }],
  data: [{ item_id: itemId, location_stocks: [{ location_id: locationId, on_hand: available, on_order: 0, reserved: 0, available }] }],
});

beforeEach(async () => {
  if (!reachable) return;
  await pool.query("DELETE FROM product WHERE id = $1", [prefix + "product"]);
  await pool.query("DELETE FROM branch WHERE id = $1", [prefix + "branch"]);
  await pool.query("INSERT INTO product (id,name,slug,base_price,status) VALUES ($1,'Live checkout','checkout-live-test-product',1000,'aktif')", [prefix + "product"]);
  await pool.query("INSERT INTO product_variant (id,product_id,sku,price,jubelio_item_id) VALUES ($1,$2,$3,1000,$4)", [prefix + "variant", prefix + "product", prefix + "sku", itemId]);
  await pool.query("INSERT INTO branch (id,name,code,city,address,jubelio_location_id) VALUES ($1,'Live checkout','LIVE-TEST','Test','Test',$2)", [prefix + "branch", locationId]);
  await pool.query("INSERT INTO branch_stock (branch_id,product_variant_id,stock,available_stock,pending_remote_stock,provider_stock_synced_at) VALUES ($1,$2,0,0,0,NOW() - INTERVAL '1 day')", [prefix + "branch", prefix + "variant"]);
});
afterEach(async () => {
  if (!reachable) return;
  await pool.query("DELETE FROM product WHERE id = $1", [prefix + "product"]);
  await pool.query("DELETE FROM branch WHERE id = $1", [prefix + "branch"]);
});
afterAll(async () => { await pool.end(); });

const row = async () => (await pool.query("SELECT available_stock,pending_remote_stock,provider_stock_synced_at FROM branch_stock WHERE branch_id=$1", [selection[0].branchId])).rows[0];

describe("checkout provider verification (DB + external provider seam)", () => {
  it.skipIf(!reachable)("recovers a stale local zero from a sufficient live observation without clearing a hold", async () => {
    await pool.query("UPDATE branch_stock SET pending_remote_stock=1 WHERE branch_id=$1", [selection[0].branchId]);
    const result = await verifyCheckoutStock(db, selection, async () => response(3));
    expect(result).toMatchObject({ ok: true, observedAt: expect.any(Date) });
    expect((await row()).available_stock).toBe(3);
    expect((await row()).pending_remote_stock).toBe(1);
  });

  it.skipIf(!reachable)("rejects insufficient provider available and preserves local holds", async () => {
    await pool.query("UPDATE branch_stock SET available_stock=5,pending_remote_stock=1 WHERE branch_id=$1", [selection[0].branchId]);
    expect(await verifyCheckoutStock(db, selection, async () => response(1))).toMatchObject({ ok: false, reason: "insufficient" });
    expect((await row()).pending_remote_stock).toBe(1);
    expect((await row()).available_stock).toBe(1);
  });

  it.skipIf(!reachable)("fails closed when Jubelio is unavailable or omits the requested location", async () => {
    const before = (await row()).provider_stock_synced_at.getTime();
    expect(await verifyCheckoutStock(db, selection, async () => { throw new Error("network error"); })).toMatchObject({ ok: false, reason: "unavailable", detail: "provider_read_failed" });
    expect(await verifyCheckoutStock(db, selection, async () => ({ locations: [], data: [] }))).toMatchObject({ ok: false, reason: "unavailable" });
    expect((await row()).provider_stock_synced_at.getTime()).toBe(before);
  });

  it.skipIf(!reachable)("rejects inconsistent provider stock series without making the local cache look fresh", async () => {
    const before = (await row()).provider_stock_synced_at.getTime();
    const inconsistent = response(2);
    inconsistent.data[0].location_stocks[0].available = 0;
    expect(await verifyCheckoutStock(db, selection, async () => inconsistent)).toMatchObject({ ok: false, reason: "unavailable", detail: "observation_missing_or_invalid" });
    expect((await row()).provider_stock_synced_at.getTime()).toBe(before);
  });

  it.skipIf(!reachable)("does not overwrite accounting changed while the provider read was in flight", async () => {
    const result = await verifyCheckoutStock(db, selection, async () => {
      await pool.query("UPDATE branch_stock SET pending_remote_stock=1 WHERE branch_id=$1", [selection[0].branchId]);
      return response(3);
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect((await row()).available_stock).toBe(0);
    expect((await row()).pending_remote_stock).toBe(1);
  });
});
