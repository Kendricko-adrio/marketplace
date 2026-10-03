import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
const { db, branchStocks, branches, clients, jubelioSalesOperations, orderItems, orders, products, productVariants } = await import("@/db");
const { reconcileConfirmedSalesOrderHolds, dispatchJubelioSalesCancel, dispatchJubelioSalesCreate, ensureJubelioInvoice, ensureJubelioPayment } = await import("./jubelio-sales-lifecycle");

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

  it('recovers known manual-review delivery settlement through GET only, using goods not website total', async () => {
    const id = `${prefix}-delivery-review`; let posts = 0; const gets: string[] = [];
    await db.insert(orders).values({ id, userId: clientId, branchId, jubelioSalesOrderId: 345678, jubelioInvoiceId: 45934,
      fulfillmentMethod: 'delivery', status: 'processing', paymentStatus: 'paid', fulfillmentBlockedReason: 'invoice verification blocked',
      contactEmail: `${clientId}@example.test`, contactPhone: '08123456789', subtotal: '1000', shippingCost: '200', ppnAmount: '132', total: '1332' });
    await db.insert(orderItems).values({ id: `${id}-item`, orderId: id, variantId, productName: 'Recovery Fixture', quantity: 1, price: '1000' });
    await db.insert(jubelioSalesOperations).values([
      { id: `${id}-create`, orderId: id, type: 'create', status: 'confirmed', reference: `${id}-create`, salesOrderId: 345678, holdAccountedAt: new Date(),
        payload: { type: 'create', create: { contactId: -1, customerName: 'Recovery', locationId: 15, note: `${id}-create`, items: [{ itemId: 101187, quantity: 1, price: 1000, discAmount: 0, taxAmount: 0, unit: 'Buah', taxId: 1 }] } } },
      { id: `${id}-invoice`, orderId: id, type: 'invoice', status: 'manual_review', reference: `${id}-invoice`, salesOrderId: 345678, invoiceId: 45934, payload: { type: 'invoice', invoice: { salesOrderId: 345678 } } },
      { id: `${id}-payment`, orderId: id, type: 'payment', status: 'manual_review', reference: `${id}-payment`, salesOrderId: 345678, invoiceId: 45934, paymentId: 888001,
        payload: { type: 'payment', payment: { invoiceId: 45934, accountId: 1, amount: 1000, contactId: -1, paymentType: 0, note: `${id}-payment` } } },
    ]);
    const gateway = {
      getSalesOrder: async () => { gets.push('so'); return { salesorderId: 345678, invoiceId: 45934, isCanceled: false }; },
      getInvoice: async () => { gets.push('invoice'); return { invoiceId: 45934, salesorderId: null, contactId: -1, locationId: 15, subTotal: 1000, totalDisc: 0, totalTax: 0, grandTotal: 1000, isCanceled: false, items: [{ itemId: 101187, quantity: 1, price: 1000, amount: 1000 }] }; },
      getPayment: async () => { gets.push('payment'); return { paymentId: 888001, amount: 1000, isCanceled: false, invoices: [{ invoiceId: 45934, paymentAmount: 1000, salesorderId: 345678 }] }; },
      createInvoice: async () => { posts++; throw new Error('No recovery POST'); },
      associatePayment: async () => { posts++; throw new Error('No recovery POST'); },
    } as unknown as NonNullable<Parameters<typeof ensureJubelioInvoice>[0]['gateway']>;
    expect((await ensureJubelioInvoice({ orderId: id, gateway, readOnlyRecovery: true })).status).toBe('confirmed');
    expect((await ensureJubelioPayment({ orderId: id, gateway, readOnlyRecovery: true })).status).toBe('confirmed');
    const { settleJubelioSalesOrder } = await import('./jubelio-sales-settlement');
    await settleJubelioSalesOrder(id);
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    expect(row.fulfillmentBlockedReason).toBeNull(); expect(row.paymentStatus).toBe('paid'); expect(row.status).toBe('processing'); expect(row.pickupCode).toBeNull();
    expect(gets).toContain('invoice'); expect(gets).toContain('payment'); expect(posts).toBe(0);
  });

  it('holds delivery recovery without known operation identifiers and never records an intent or POST', async () => {
    const id = `${prefix}-delivery-unknown`; let posts = 0;
    await db.insert(orders).values({ id, userId: clientId, branchId, fulfillmentMethod: 'delivery', status: 'processing', paymentStatus: 'paid', fulfillmentBlockedReason: 'Missing settlement evidence', jubelioSalesOrderId: 345678, jubelioInvoiceId: 45934,
      contactEmail: `${clientId}@example.test`, contactPhone: '08123456789', subtotal: '1000', total: '1332', shippingCost: '200', ppnAmount: '132' });
    const gateway = { createInvoice: async () => { posts++; throw new Error('No recovery POST'); }, associatePayment: async () => { posts++; throw new Error('No recovery POST'); } } as unknown as NonNullable<Parameters<typeof ensureJubelioInvoice>[0]['gateway']>;
    expect((await ensureJubelioInvoice({ orderId: id, gateway, readOnlyRecovery: true })).status).toBe('in_flight');
    expect((await ensureJubelioPayment({ orderId: id, gateway, readOnlyRecovery: true })).status).toBe('in_flight');
    expect(posts).toBe(0);
    expect(await db.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.orderId, id))).toEqual([]);
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    expect(row.fulfillmentBlockedReason).toBe('Missing settlement evidence'); expect(row.paymentStatus).toBe('paid'); expect(row.pickupCode).toBeNull();
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
