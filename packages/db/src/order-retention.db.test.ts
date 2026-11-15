import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { deleteRetainedOrderFixtures } from "./testing/retained-order-fixtures";

// Public seam: PostgreSQL DELETE constraints, not application recovery logic.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 2000 });
let reachable = false;
try { const client = await pool.connect(); client.release(); reachable = true; }
catch { console.warn("order retention DB tests skipped: PostgreSQL unavailable"); }
const prefix = "discounts-retention-test-";
const id = (name: string) => prefix + name;

async function cleanup() {
  await deleteRetainedOrderFixtures(pool, [id("order")]);
  await pool.query("DELETE FROM address WHERE id=$1", [id("address")]);
  await pool.query("DELETE FROM product_variant WHERE id=$1", [id("variant")]);
  await pool.query("DELETE FROM product WHERE id=$1", [id("product")]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [id("admin")]);
  await pool.query("DELETE FROM admin_role WHERE id=$1", [id("role")]);
  await pool.query("DELETE FROM client WHERE id=$1", [id("client")]);
}

beforeEach(async () => {
  if (!reachable) return;
  await cleanup();
  await pool.query("INSERT INTO client(id,name,email) VALUES($1,'Retention test',$2)", [id("client"), id("client") + "@example.test"]);
  await pool.query("INSERT INTO admin_role(id,name) VALUES($1,$2)", [id("role"), id("role")]);
  await pool.query('INSERT INTO "user"(id,name,email,role_id) VALUES($1,\'Retention admin\',$2,$3)', [id("admin"), id("admin") + "@example.test", id("role")]);
  await pool.query("INSERT INTO product(id,name,slug,base_price) VALUES($1,'Retention product',$1,1000)", [id("product")]);
  await pool.query("INSERT INTO product_variant(id,product_id,sku,price) VALUES($1,$2,$1,1000)", [id("variant"), id("product")]);
  await pool.query("INSERT INTO orders(id,user_id,contact_phone,contact_email,subtotal,total) VALUES($1,$2,'0800000000','retention@example.test',1000,1000)", [id("order"), id("client")]);
});
afterEach(async () => { if (reachable) await cleanup(); });
afterAll(async () => { await pool.end(); });

async function item() {
  await pool.query("INSERT INTO order_item(id,order_id,variant_id,product_name,price,quantity) VALUES($1,$2,$3,'Frozen product',1000,1)", [id("item"), id("order"), id("variant")]);
}
async function shipment() {
  await pool.query("INSERT INTO delivery_shipment(id,order_id,stored_request,packed_by,quote_rates) VALUES($1,$2,'{}'::jsonb,$3,0)", [id("shipment"), id("order"), id("admin")]);
}
async function review() {
  await shipment();
  await pool.query("INSERT INTO delivery_booking_reviews(id,order_id,shipment_id,attempt_number,archived_request,proof_source,proof_reference,proof_reason,absence_confirmed,operation_closed,released_by) VALUES($1,$2,$3,1,'{}'::jsonb,'jubelio_confirmation','fixture-proof','fixture evidence',true,true,$4)", [id("review"), id("order"), id("shipment"), id("admin")]);
}

const cases = [
  { name: "client with an order", prepare: async () => {}, table: "client", parent: "client" },
  { name: "order with frozen items", prepare: item, table: "orders", parent: "order" },
  { name: "variant referenced by a frozen item", prepare: item, table: "product_variant", parent: "variant" },
  { name: "catalog referenced by a frozen item", prepare: item, table: "product", parent: "product" },
  { name: "order with provider operation evidence", prepare: async () => {
    await pool.query("INSERT INTO jubelio_sales_operation(id,order_id,type,reference,payload) VALUES($1,$2,'create',$1,'{\"type\":\"create\",\"create\":{}}'::jsonb)", [id("operation"), id("order")]);
  }, table: "orders", parent: "order" },
  { name: "order with channel evidence", prepare: async () => {
    await pool.query("INSERT INTO jubelio_channel_status_intent(id,order_id,sales_order_id,target_version,target_status) VALUES($1,$2,998877,1,'Belum Bayar')", [id("channel"), id("order")]);
  }, table: "orders", parent: "order" },
  { name: "order with shipment evidence", prepare: shipment, table: "orders", parent: "order" },
  { name: "shipment with tracking evidence", prepare: async () => {
    await shipment();
    await pool.query("INSERT INTO delivery_tracking_event(id,shipment_id,awb,fingerprint) VALUES($1,$2,$3,$1)", [id("event"), id("shipment"), id("awb")]);
  }, table: "delivery_shipment", parent: "shipment" },
  { name: "shipment with booking review evidence", prepare: review, table: "delivery_shipment", parent: "shipment" },
  { name: "order with booking review evidence", prepare: review, table: "orders", parent: "order" },
];

describe("retained order and provider evidence (SQL constraints)", () => {
  for (const fixture of cases) {
    it.skipIf(!reachable)(`rejects deletion of ${fixture.name} with SQLSTATE 23503`, async () => {
      await fixture.prepare();
      // Identifiers are the fixed allowlist above; only fixture values are parameters.
      await expect(pool.query(`DELETE FROM ${fixture.table} WHERE id=$1`, [id(fixture.parent)]))
        .rejects.toMatchObject({ code: "23503" });
    });
  }

  it.skipIf(!reachable)("allows address-book deletion without losing the order", async () => {
    await pool.query("INSERT INTO address(id,user_id,first_name,last_name,phone,full_address,city,district,postal_code) VALUES($1,$2,'Test','Client','0800000000','Fixture address','Test','Test','00100')", [id("address"), id("client")]);
    await pool.query("UPDATE orders SET address_id=$1 WHERE id=$2", [id("address"), id("order")]);
    await pool.query("DELETE FROM address WHERE id=$1", [id("address")]);
    const result = await pool.query("SELECT address_id FROM orders WHERE id=$1", [id("order")]);
    expect(result.rows).toEqual([{ address_id: null }]);
  });
});
