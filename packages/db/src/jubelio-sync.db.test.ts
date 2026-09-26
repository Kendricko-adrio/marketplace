import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { keyId, upsertJubelioStock } from "./jubelio-sync";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const itemId = 9_998_879;
const locationId = 9_998_879;
const prefix = "jubelio-import-upsert-test-";
const branchId = keyId("jubelio:branch:", String(locationId));

describe("Jubelio stock import against PostgreSQL", () => {
  it("inserts and refreshes all provider stock series without changing local holds", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO product (id, name, slug, base_price, status) VALUES ($1, 'Import test', $2, 1000, 'aktif')",
        [prefix + "product", prefix + "product"]
      );
      await client.query(
        "INSERT INTO product_variant (id, product_id, sku, price, jubelio_item_id) VALUES ($1, $2, $3, 1000, $4)",
        [prefix + "variant", prefix + "product", prefix + "sku", itemId]
      );
      await client.query(
        "INSERT INTO branch (id, name, code, city, address, jubelio_location_id) VALUES ($1, 'Import test', $2, 'Test', 'Test', $3)",
        [branchId, prefix + "branch", locationId]
      );
      const db = drizzle(client, { schema });
      const row = (onHand: number, onOrder: number, reserved: number, available: number) =>
        [{ itemId, locationId, onHand, onOrder, reserved, available }];
      const stock = async () => (await client.query(
        "SELECT stock, on_order_stock, provider_reserved_stock, available_stock, pending_remote_stock, reserved_stock, provider_stock_synced_at FROM branch_stock WHERE branch_id = $1 AND product_variant_id = $2",
        [branchId, prefix + "variant"]
      )).rows[0];

      expect(await upsertJubelioStock(db, row(8, 2, 1, 5))).toBe(1);
      expect(await stock()).toMatchObject({
        stock: 8, on_order_stock: 2, provider_reserved_stock: 1, available_stock: 5,
      });
      expect((await stock()).provider_stock_synced_at).toBeInstanceOf(Date);

      await client.query(
        "UPDATE branch_stock SET pending_remote_stock = 2, reserved_stock = 1 WHERE branch_id = $1 AND product_variant_id = $2",
        [branchId, prefix + "variant"]
      );
      expect(await upsertJubelioStock(db, row(7, 3, 2, 2))).toBe(1);
      expect(await stock()).toMatchObject({
        stock: 7, on_order_stock: 3, provider_reserved_stock: 2, available_stock: 2,
        pending_remote_stock: 2, reserved_stock: 1,
      });
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  });
});

afterAll(async () => { await pool.end(); });
