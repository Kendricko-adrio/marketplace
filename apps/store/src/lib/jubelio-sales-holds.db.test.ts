import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { describe, expect, it, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import {
  branchStocks,
  branches,
  productVariants,
  products,
  clients,
  orders,
} from "@marketplace/db/src/schema";
import { sellableUnits } from "./stock";

// =========================================================
// DB concurrency seam for the Sales-Order local hold (plan:
// jubelio-sales-api-switching, feature 1). The no-oversell guarantee is a
// DATABASE property of ONE conditional UPDATE; it can only be proven against
// PostgreSQL. A sync-style refresh (stock/upsert semantics) must never clear
// or double-subtract a pending hold.
//
// Requires the dev database with the 0021 schema applied (db:push). Skipped
// when PostgreSQL is unreachable — a skip is NOT a pass.
//
// The dev database is SHARED: rows are keyed by the "jso-hold-dbtest" prefix
// and deleted in afterAll.
// =========================================================

const PREFIX = "jso-hold-dbtest-";
const ITEM_ID = 9_999_901;
const LOCATION_ID = 9_999_901;

const url = process.env.DATABASE_URL;

async function dbReachable(): Promise<boolean> {
  if (!url) return false;
  try {
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("select 1");
    await pool.end();
    return true;
  } catch (error) {
    console.warn(
      `[jubelio-sales-holds.db] NOT run — PostgreSQL unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

const reachable = await dbReachable();
const pool = url ? new Pool({ connectionString: url, max: 5 }) : null;
const db = pool ? drizzle(pool, {}) : null;

let branchId: string;
let variantId: string;
let clientId: string;
let orderId: string;

async function setupFixtures(): Promise<void> {
  if (!db) return;
  branchId = `${PREFIX}branch`;
  variantId = `${PREFIX}variant`;
  clientId = `${PREFIX}client`;
  orderId = `${PREFIX}order`;
  const productId = `${PREFIX}product`;
  await db.delete(clients).where(eq(clients.id, clientId));
  await pool!.query(`DELETE FROM product WHERE id LIKE '${PREFIX}%'`);
  await pool!.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}%'`);
  await db
    .insert(products)
    .values({ id: productId, name: "Hold DB Test", slug: `${PREFIX}product`, basePrice: "10000", status: "aktif" });
  await db.insert(productVariants).values({
    id: variantId,
    productId,
    sku: `${PREFIX}sku`,
    price: "10000",
    jubelioItemId: ITEM_ID,
  });
  await db
    .insert(branches)
    .values({
      id: branchId,
      name: "Hold DB Test Branch",
      code: `${PREFIX}BR`,
      jubelioLocationId: LOCATION_ID,
      city: "Test",
      address: "Test",
      status: "aktif",
    })
    .onConflictDoNothing();
  // Provider snapshot: available 2, on_order 0. The on-hand mirror is
  // deliberately different (5) to prove sellable never uses `stock`.
  await db
    .insert(branchStocks)
    .values({
      branchId,
      productVariantId: variantId,
      stock: 5,
      onOrderStock: 0,
      providerReservedStock: 0,
      availableStock: 2,
    });
  await db.insert(clients).values({
    id: clientId,
    name: "Hold DB Test",
    email: "hold-dbtest@example.test",
    emailVerified: true,
  });
  await db.insert(orders).values({
    id: orderId,
    userId: clientId,
    branchId,
    status: "pending_payment",
    paymentStatus: "pending",
    contactPhone: "0000000000",
    contactEmail: "hold-dbtest@example.test",
    subtotal: "20000",
    total: "20000",
  });
}

describe("SO local hold concurrency (PostgreSQL)", () => {
  it.skipIf(!reachable || !db)(
    "parallel holds cannot oversell the provider available snapshot",
    async () => {
      await setupFixtures();
      // Four concurrent one-unit holds against available = 2 → exactly two
      // winners, two losers (0 rows), and no oversell.
      const attempt = () =>
        db!
          .update(branchStocks)
          .set({
            pendingRemoteStock: sqlPlus(1),
            updatedAt: new Date(),
          })
          .where(
            eq(branchStocks.branchId, branchId),
          )
          .returning({ pending: branchStocks.pendingRemoteStock });
      void attempt;
      const single = async () => {
        const rows = await db!
          .update(branchStocks)
          .set({
            pendingRemoteStock: sqlPlus(1),
            updatedAt: new Date(),
          })
          .where(holdGuard(1))
          .returning({ pending: branchStocks.pendingRemoteStock });
        return rows.length;
      };
      const results = await Promise.all([single(), single(), single(), single()]);
      const wins = results.filter((r) => r === 1).length;
      expect(wins).toBe(2);

      const row = await db!
        .select()
        .from(branchStocks)
        .where(eq(branchStocks.branchId, branchId))
        .limit(1);
      expect(row[0].pendingRemoteStock).toBe(2);
      expect(row[0].availableStock).toBe(2); // sync never touched
      expect(sellableUnits(row[0])).toBe(0); // sold out while held
    }
  );

  it.skipIf(!reachable || !db)(
    "a sync-style refresh never clears or double-subtracts a pending hold",
    async () => {
      await setupFixtures();
      // Acquire one hold.
      const held = await db!
        .update(branchStocks)
        .set({ pendingRemoteStock: sqlPlus(1), updatedAt: new Date() })
        .where(singleHoldGuard(1))
        .returning({ pending: branchStocks.pendingRemoteStock });
      expect(held.length).toBe(1);

      // Simulate the sync upsert (jubelio-sync.upsertJubelioStock writes the
      // same SET clause): stock/on_order/reserved/available are overwritten,
      // pending_remote_stock is NOT in the SET list — the hold survives and
      // the provider figure (which already nets the SO) lands as-is.
      await db!
        .insert(branchStocks)
        .values({
          branchId,
          productVariantId: variantId,
          stock: 1,
          onOrderStock: 1,
          providerReservedStock: 0,
          availableStock: 0,
        })
        .onConflictDoUpdate({
          target: [branchStocks.branchId, branchStocks.productVariantId],
          set: {
            stock: sqlExcluded("stock"),
            onOrderStock: sqlExcluded("on_order_stock"),
            providerReservedStock: sqlExcluded("provider_reserved_stock"),
            availableStock: sqlExcluded("available_stock"),
            updatedAt: new Date(),
          },
        });

      const row = await db!
        .select()
        .from(branchStocks)
        .where(eq(branchStocks.branchId, branchId))
        .limit(1);
      // The SO was created remotely between the hold and the refresh, so the
      // refreshed provider snapshot already nets it out (on_order 1). The
      // confirmed-create mirror then clears the hold and decrements
      // available — both converge to the same sellable figure.
      expect(row[0].pendingRemoteStock).toBe(1);
      expect(row[0].availableStock).toBe(0);
      expect(sellableUnits(row[0])).toBe(0);
    }
  );

  it.skipIf(!reachable || !db)(
    "confirmed-create mirror clears the hold and decrements available exactly once",
    async () => {
      await setupFixtures();
      await db!
        .update(branchStocks)
        .set({ pendingRemoteStock: sqlPlus(1), updatedAt: new Date() })
        .where(singleHoldGuard(1));
      // Mirror (lifecycle): pending −1 AND available −1.
      await db!
        .update(branchStocks)
        .set({
          pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - 1)`,
          availableStock: sql`GREATEST(COALESCE(${branchStocks.availableStock}, 0) - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(branchStocks.branchId, branchId));
      const row = await db!
        .select()
        .from(branchStocks)
        .where(eq(branchStocks.branchId, branchId))
        .limit(1);
      expect(row[0].pendingRemoteStock).toBe(0);
      expect(row[0].availableStock).toBe(1);
      expect(sellableUnits(row[0])).toBe(1);
    }
  );
});

afterAll(async () => {
  if (!pool) return;
  // Client deletion cascades to orders; branch_stock rows are removed first.
  await pool.query(`DELETE FROM branch_stock WHERE branch_id LIKE '${PREFIX}%'`);
  await pool.query(`DELETE FROM product WHERE id LIKE '${PREFIX}%'`);
  await pool.query(`DELETE FROM "client" WHERE id LIKE '${PREFIX}%'`);
  await pool.query(`DELETE FROM branch WHERE id LIKE '${PREFIX}%'`);
  await pool.end();
});

// --- small SQL helpers (drizzle sql template) ---
import { sql } from "drizzle-orm";
import { and } from "drizzle-orm";

function sqlPlus(n: number) {
  return sql`${branchStocks.pendingRemoteStock} + ${n}`;
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/** Hold guard with the concurrent-race predicate used by place-order. */
function holdGuard(qty: number) {
  return and(
    eq(branchStocks.branchId, branchId),
    eq(branchStocks.productVariantId, variantId),
    sql`${branchStocks.availableStock} is not null`,
    sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} >= ${qty}`
  )!;
}

function singleHoldGuard(qty: number) {
  return holdGuard(qty);
}