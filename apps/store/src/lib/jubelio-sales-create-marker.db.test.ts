import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import type { JubelioSalesGateway } from "./jubelio-sales-client";
// The app DB module reads DATABASE_URL at import time; load .env first.
const { db, branchStocks, branches, clients, orderItems, orders, products, productVariants } = await import("@/db");
const { dispatchJubelioSalesCreate } = await import("./jubelio-sales-lifecycle");
const { getJubelioSalesOperation } = await import("./jubelio-sales-operations");

// The provider boundary is deliberately a stub: no login or real Jubelio POST.
// This is the approved per-order DB seam, not a fake in-memory claim.
const prefix = `create-marker-${crypto.randomUUID()}`;
const clientId = `${prefix}-client`;
const branchId = `${prefix}-branch`;
const productId = `${prefix}-product`;
const variantId = `${prefix}-variant`;
const orderId = `${prefix}-order`;
const remoteId = 9_880_301; // local stub id, never fetched from Jubelio
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

it("records marker-only divergence on a confirmed create without stopping the local pending order or repeating POST", async () => {
  await db.insert(clients).values({ id: clientId, name: "Marker Test", email: `${clientId}@example.test`, emailVerified: true });
  await db.insert(branches).values({ id: branchId, code: prefix, name: "Marker Test", city: "Test", address: "Test" });
  await db.insert(products).values({ id: productId, slug: prefix, name: "Marker Test", basePrice: "1000" });
  await db.insert(productVariants).values({ id: variantId, productId, sku: prefix, price: "1000" });
  await db.insert(branchStocks).values({ branchId, productVariantId: variantId, availableStock: 5, pendingRemoteStock: 1 });
  await db.insert(orders).values({
    id: orderId, userId: clientId, branchId, status: "pending_payment", paymentStatus: "pending",
    contactEmail: `${clientId}@example.test`, contactPhone: "00000000", subtotal: "1000", total: "1000",
  });
  await db.insert(orderItems).values({
    id: `${prefix}-line`, orderId, variantId, productName: "Marker Test", quantity: 1, price: "1000",
  });

  const create = {
    contactId: -1, customerName: "Marker Test", locationId: 7,
    note: `OKCIR_SO_CREATE:${orderId}`, refNo: orderId, channelStatus: "Belum Bayar" as const,
    items: [{ itemId: 43842, quantity: 1, price: 1000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }],
  };
  let posts = 0;
  const gateway = {
    createSalesOrder: async () => {
      posts++;
      const intent = await getJubelioSalesOperation(db, { orderId, type: "create" });
      expect(intent?.status).toBe("dispatched_unknown");
      expect(intent?.payload).toMatchObject({ type: "create", create: { channelStatus: "Belum Bayar" } });
      return { salesOrderId: remoteId, order: { channelStatus: "Operator changed marker" } };
    },
  } as unknown as JubelioSalesGateway;

  const first = await dispatchJubelioSalesCreate({ orderId, create, gateway });
  expect(first).toEqual({ status: "confirmed", salesOrderId: remoteId });
  expect(await dispatchJubelioSalesCreate({ orderId, create, gateway })).toEqual(first);
  expect(posts).toBe(1);
  const record = await getJubelioSalesOperation(db, { orderId, type: "create" });
  expect(record).toMatchObject({
    status: "confirmed", salesOrderId: remoteId,
    channelStatusMismatchReason: "CREATE_MARKER_MISMATCH",
  });
  expect(record?.channelStatusMismatchAt).toBeInstanceOf(Date);
  const [local] = await db.select({ status: orders.status, paymentStatus: orders.paymentStatus, salesOrderId: orders.jubelioSalesOrderId })
    .from(orders).where(eq(orders.id, orderId));
  expect(local).toEqual({ status: "pending_payment", paymentStatus: "pending", salesOrderId: remoteId });
});

afterAll(async () => {
  await pool.query('DELETE FROM "client" WHERE id = $1', [clientId]);
  await pool.query('DELETE FROM product WHERE id = $1', [productId]);
  await pool.query('DELETE FROM branch WHERE id = $1', [branchId]);
  await pool.end();
});
