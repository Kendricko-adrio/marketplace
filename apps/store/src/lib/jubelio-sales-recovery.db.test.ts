import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
const { db, branchStocks, branches, clients, jubelioSalesOperations, orderItems, orders, products, productVariants } = await import("@/db");
const { reconcileConfirmedSalesOrderHolds, dispatchJubelioSalesCancel, dispatchJubelioSalesCreate, ensureJubelioInvoice } = await import("./jubelio-sales-lifecycle");

const prefix = `sales-recovery-${crypto.randomUUID()}`;
const clientId = `${prefix}-client`;
const branchId = `${prefix}-branch`;
const variantId = `${prefix}-variant`;
const productId = `${prefix}-product`;
const orderA = `${prefix}-a`;
const orderB = `${prefix}-b`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixture() {
  await db.insert(clients).values({ id: clientId, name: "Recovery Fixture", email: `${clientId}@example.test`, emailVerified: true });
  await db.insert(branches).values({ id: branchId, code: prefix, name: "Recovery Fixture", city: "Test", address: "Test" });
  await db.insert(products).values({ id: productId, slug: prefix, name: "Recovery Fixture", basePrice: "1000" });
  await db.insert(productVariants).values({ id: variantId, productId, sku: prefix, price: "1000" });
  await db.insert(branchStocks).values({ branchId, productVariantId: variantId, availableStock: 5, pendingRemoteStock: 2 });
  for (const id of [orderA, orderB]) {
    await db.insert(orders).values({ id, userId: clientId, branchId, contactEmail: `${clientId}@example.test`, contactPhone: "00000000", subtotal: "1000", total: "1000" });
    await db.insert(orderItems).values({ id: `${id}-item`, orderId: id, variantId, productName: "Recovery Fixture", quantity: 1, price: "1000" });
  }
  await db.insert(jubelioSalesOperations).values([
    { id: `${prefix}-create`, orderId: orderA, type: "create", status: "confirmed", reference: `${prefix}-create`, payload: { type: "create", create: { contactId: -1, customerName: "Recovery", locationId: 15, note: `${prefix}-create`, items: [] } }, salesOrderId: 123456 },
    { id: `${prefix}-cancel`, orderId: orderB, type: "cancel", status: "confirmed", reference: `${prefix}-cancel`, payload: { type: "cancel", cancel: { salesOrderId: 789012 } }, salesOrderId: 789012 },
  ]);
}

describe("confirmed SO accounting crash recovery (PostgreSQL)", () => {
  it("replays missing create/cancel accounting once and never consumes another order's hold", async () => {
    await fixture();
    await reconcileConfirmedSalesOrderHolds();
    await reconcileConfirmedSalesOrderHolds();
    const [stock] = await db.select().from(branchStocks).where(eq(branchStocks.branchId, branchId));
    expect(stock.pendingRemoteStock).toBe(1); // the other pending order's hold survives cancel
    expect(stock.availableStock).toBe(4);
    const [created] = await db.select().from(orders).where(eq(orders.id, orderA));
    expect(created.jubelioSalesOrderId).toBe(123456);
    const ops = await db.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.orderId, orderB));
    expect(ops[0].holdAccountedAt).toBeInstanceOf(Date);
    let cancelPosts = 0;
    const gateway = { cancelSalesOrder: async () => {
      cancelPosts++;
      return { salesOrderId: 123456, alreadyCanceled: false, order: {} };
    } } as unknown as NonNullable<Parameters<typeof dispatchJubelioSalesCancel>[0]["gateway"]>;
    expect((await dispatchJubelioSalesCancel({ orderId: orderA, reason: "expiry", gateway })).status).toBe("confirmed");
    expect((await dispatchJubelioSalesCancel({ orderId: orderA, reason: "expiry", gateway })).status).toBe("confirmed");
    expect(cancelPosts).toBe(1);
    const [afterCancel] = await db.select().from(branchStocks).where(eq(branchStocks.branchId, branchId));
    expect(afterCancel.pendingRemoteStock).toBe(1);
  });

  it("never classifies a confirmed remote create as rejected when local accounting fails", async () => {
    const id = `${prefix}-accounting-error`;
    const create = { contactId: -1, customerName: "Recovery", locationId: 15, note: `${id}-create`,
      items: [{ itemId: 101187, quantity: 1, price: 1000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] };
    await db.insert(orders).values({ id, userId: clientId, branchId: null,
      contactEmail: `${clientId}@example.test`, contactPhone: "00000000", subtotal: "1000", total: "1000" });
    await db.insert(orderItems).values({ id: `${id}-item`, orderId: id, variantId,
      productName: "Recovery Fixture", quantity: 1, price: "1000" });
    const gateway = { createSalesOrder: async () => ({ salesOrderId: 567890, order: {} }) } as unknown as
      NonNullable<Parameters<typeof dispatchJubelioSalesCreate>[0]["gateway"]>;
    await expect(dispatchJubelioSalesCreate({ orderId: id, create, gateway })).rejects.toThrow(/missing branch/);
    const [op] = await db.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.orderId, id));
    expect(op.status).toBe("confirmed");
    expect(op.holdAccountedAt).toBeNull();
  });

  it("blocks a recovered invoice with the right total but wrong items", async () => {
    const id = `${prefix}-invoice`;
    await db.insert(orders).values({ id, userId: clientId, branchId, jubelioSalesOrderId: 345678,
      contactEmail: `${clientId}@example.test`, contactPhone: "00000000", subtotal: "1000", total: "1000" });
    await db.insert(orderItems).values({ id: `${id}-item`, orderId: id, variantId,
      productName: "Recovery Fixture", quantity: 1, price: "1000" });
    await db.insert(jubelioSalesOperations).values([
      { id: `${id}-create`, orderId: id, type: "create", status: "confirmed", reference: `${id}-create`,
        payload: { type: "create", create: { contactId: -1, customerName: "Recovery", locationId: 15,
          note: `${id}-create`, items: [{ itemId: 101187, quantity: 1, price: 1000, discAmount: 0,
            taxAmount: 0, unit: "Buah", taxId: 1 }] } }, salesOrderId: 345678, holdAccountedAt: new Date() },
      { id: `${id}-op`, orderId: id, type: "invoice", status: "dispatched_unknown",
        reference: `${id}-op`, payload: { type: "invoice", invoice: { salesOrderId: 345678 } },
        salesOrderId: 345678, invoiceId: 45934 },
    ]);
    const gateway = {
      getSalesOrder: async () => ({ salesorderId: 345678, invoiceId: 45934, isCanceled: false }),
      getInvoice: async () => ({ invoiceId: 45934, salesorderId: null, contactId: -1, locationId: 15,
        subTotal: 1000, totalDisc: 0, totalTax: 0, grandTotal: 1000, isCanceled: false,
        items: [{ itemId: 99999, quantity: 1, price: 1000, amount: 1000 }] }),
    } as unknown as NonNullable<Parameters<typeof ensureJubelioInvoice>[0]["gateway"]>;
    const result = await ensureJubelioInvoice({ orderId: id, gateway });
    expect(result.status).toBe("manual_review");
    const [invoiceOp] = await db.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.id, `${id}-op`));
    expect(invoiceOp.status).toBe("manual_review");
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM "client" WHERE id = $1', [clientId]);
  await pool.query('DELETE FROM product WHERE id = $1', [productId]);
  await pool.query('DELETE FROM branch WHERE id = $1', [branchId]);
  await pool.end();
});
