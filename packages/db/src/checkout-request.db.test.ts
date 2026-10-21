import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.DATABASE_URL ?? "";
const enabled = !!url && /^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(new URL(url).pathname.slice(1));
if (url && !enabled) throw new Error("Checkout request SQL tests menolak database non-disposable.");
const pool = new Pool({ connectionString: url });
afterAll(async () => { await pool.end(); });

describe.skipIf(!enabled)("retention dan invariant SQL checkout accepted result", () => {
  it("menolak result NULL-semantics, duplicate owner key dan deletion order yang masih memiliki result", async () => {
    const connection = await pool.connect();
    const clientId = "checkout02-schema-client";
    const orderId = "checkout02-schema-order";
    const key = "b1200000-0000-4000-8000-000000000099";
    try {
      await connection.query("BEGIN");
      await connection.query("INSERT INTO client (id,name,email) VALUES ($1,'Checkout SQL Fixture','checkout02-schema@example.test')", [clientId]);
      await connection.query("INSERT INTO orders (id,user_id,subtotal,total,contact_phone,contact_email) VALUES ($1,$2,100,111,'081234567890','checkout02-schema@example.test')", [orderId, clientId]);
      const insert = "INSERT INTO checkout_request (id,client_id,request_key,fingerprint,order_id,result) VALUES ($1,$2,$3,$4,$5,$6)";
      async function denied(sql: string, params: unknown[], code: string) {
        await connection.query("SAVEPOINT rejected_write");
        try {
          await expect(connection.query(sql, params)).rejects.toMatchObject({ code });
        } finally { await connection.query("ROLLBACK TO SAVEPOINT rejected_write"); }
      }
      for (const invalid of [{}, { version: null, orderId }, { version: "1", orderId }, { version: 1, orderId: "wrong-order" }]) {
        await denied(insert, ["checkout02-invalid-result", clientId, key, "1".repeat(64), orderId, JSON.stringify(invalid)], "23514");
      }
      await connection.query(insert, ["checkout02-valid-result", clientId, key, "1".repeat(64), orderId, JSON.stringify({ version: 1, orderId })]);
      await denied("DELETE FROM orders WHERE id=$1", [orderId], "23503");
      await connection.query("INSERT INTO orders (id,user_id,subtotal,total,contact_phone,contact_email) VALUES ('checkout02-schema-order2',$1,100,111,'081234567890','checkout02-schema@example.test')", [clientId]);
      await denied(insert, ["checkout02-duplicate-key", clientId, key, "2".repeat(64), "checkout02-schema-order2",
        JSON.stringify({ version: 1, orderId: "checkout02-schema-order2" })], "23505");
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
  });
});
