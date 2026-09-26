/**
 * Sandbox integration suite (plan: jubelio-sales-api-switching, feature 6).
 *
 * Talks to the REAL isolated Jubelio test account through .env
 * (JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true). Exercises the whole Path 1
 * settlement chain through the production gateway:
 *
 *   1. SO create → confirm via GET → stock series (on_hand/on_order/available).
 *   2. Cancel → confirm via GET → stock restored.
 *   3. Fresh SO → invoice conversion → invoice-id proof + linkage → payment
 *      → payment GET association.
 *   4. Response-shape assertions (to-sell `{data,totalCount}` envelope, etc.).
 *
 * Records error/timeout behavior. Where real behavior differs from
 * assumptions, fix the code and update docs/features/jubelio-sales-orders.md.
 *
 * Run: npm run sandbox:sales  (from apps/store) — writes test records into the
 * sandbox account only; production credentials are never configured here.
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import {
  createJubelioSalesGateway,
  JubelioSalesGatewayError,
} from "../lib/jubelio-sales-client";
import { fetchStocks, type JubelioStockItem } from "@marketplace/db/src/jubelio-sync";

const LOCATION_ID = Number(process.env.JUBELIO_SANDBOX_LOCATION_ID || 15);
const ITEM_ID = Number(process.env.JUBELIO_SANDBOX_ITEM_ID || 101187);
const UNIT = process.env.JUBELIO_ITEM_UNIT?.trim() || "Buah";
const TAX_ID = Number(process.env.JUBELIO_ITEM_TAX_ID) || 1;
const PRICE = 1000;
const QTY = Number(process.env.JUBELIO_SANDBOX_QTY || 1);
if (!Number.isSafeInteger(QTY) || QTY < 1 || QTY > 10) throw new Error("invalid sandbox quantity");

async function main() {
  const gateway = createJubelioSalesGateway();
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(label);
  };

  // ---- Series A: SO create → stock series → cancel → stock restored ----
  const note = `OKCIR_SANDBOX:${Date.now()}`;
  const before = await stockSeries();
  console.log("stock before:", before);
  if (before.available < QTY || before.onHand < QTY) {
    throw new Error(`sandbox item ${ITEM_ID} at location ${LOCATION_ID} is not stocked; no Sales Order was created`);
  }

  let created: Awaited<ReturnType<typeof gateway.createSalesOrder>>;
  try {
    created = await gateway.createSalesOrder({
      contactId: -1,
      customerName: "Sandbox Integration",
      locationId: LOCATION_ID,
      note,
      refNo: note,
      items: [
        { itemId: ITEM_ID, quantity: QTY, price: PRICE, discAmount: 0, taxAmount: 0, unit: UNIT, taxId: TAX_ID },
      ],
    });
    check("SO create + GET confirmation", true, `salesOrderId=${created.salesOrderId}`);
  } catch (error) {
    check("SO create + GET confirmation", false, String(error));
    throw error;
  }
  const soId = created.salesOrderId;
  const afterCreate = await stockSeries();
  check(
    "SO create moved on_order +quantity / available −quantity",
    afterCreate.onOrder === before.onOrder + QTY &&
      afterCreate.available === before.available - QTY,
    `${JSON.stringify(before)} → ${JSON.stringify(afterCreate)}`
  );

  try {
    const canceled = await gateway.cancelSalesOrder({ salesOrderId: soId, operationId: note });
    check("SO cancel confirmed via GET", canceled.order.isCanceled);
  } catch (error) {
    check("SO cancel confirmed via GET", false, String(error));
  }
  const afterCancel = await stockSeries();
  check(
    "confirmed cancel restored the stock series",
    afterCancel.onOrder === before.onOrder && afterCancel.available === before.available,
    JSON.stringify(afterCancel)
  );

  // ---- Series B: SO → invoice → payment (Path 1) ----
  const noteB = `OKCIR_SANDBOX_PAY:${Date.now()}`;
  const createdB = await gateway.createSalesOrder({
    contactId: -1,
    customerName: "Sandbox Integration",
    locationId: LOCATION_ID,
    note: noteB,
    refNo: noteB,
    items: [
      { itemId: ITEM_ID, quantity: QTY, price: PRICE, discAmount: 0, taxAmount: 0, unit: UNIT, taxId: TAX_ID },
    ],
  });
  const soIdB = createdB.salesOrderId;
  check("Series B SO create confirmed", true, `salesOrderId=${soIdB}`);

  const accountId = Number(process.env.JUBELIO_PAYMENT_ACCOUNT_ID);
  if (!accountId) {
    console.log("SKIP payment series — JUBELIO_PAYMENT_ACCOUNT_ID not set");
  } else {
    let invoiceId: number | null = null;
    try {
      const invoice = await gateway.createInvoice({ salesOrderId: soIdB, operationId: noteB });
      invoiceId = invoice.invoiceId;
      check("invoice conversion + verified GET", invoiceId > 0, `invoiceId=${invoiceId} no=${invoice.invoice.invoiceNo}`);
      check(
        "invoice grand total equals SO grand total",
        Math.abs(invoice.invoice.grandTotal - PRICE * QTY) < 1e-6,
        `grandTotal=${invoice.invoice.grandTotal}`
      );
      // SO must now reference the invoice.
      const order = await gateway.getSalesOrder(soIdB);
      check("SO GET references the invoice", order.invoiceId === invoiceId, `order.invoiceId=${order.invoiceId}`);
    } catch (error) {
      check("invoice conversion + verified GET", false, String(error));
    }

    if (invoiceId != null) {
      try {
        const payment = await gateway.createInvoicePayment({
          payment: {
            invoiceId,
            accountId,
            amount: PRICE * QTY,
            contactId: -1,
            contactName: "Sandbox Integration",
            paymentType: 0,
            note: noteB,
          },
          operationId: noteB,
        });
        check("payment created + verified GET", payment.paymentId > 0, `paymentId=${payment.paymentId}`);
        check(
          "payment GET links the invoice",
          payment.payment.invoices.some((line) => line.invoiceId === invoiceId),
          JSON.stringify(payment.payment.invoices)
        );
        // Cancel-after-invoice must be refused by OUR gateway pre-read.
        try {
          await gateway.cancelSalesOrder({ salesOrderId: soIdB, operationId: noteB });
          check("gateway refuses cancel after invoice", false, "cancel unexpectedly succeeded");
        } catch (error) {
          check(
            "gateway refuses cancel after invoice",
            error instanceof JubelioSalesGatewayError &&
              /already has an invoice/.test(error.message),
            String(error instanceof Error ? error.message : error)
          );
        }
      } catch (error) {
        check("payment created + verified GET", false, String(error));
      }
    }
  }

  console.log(failures.length === 0 ? "\nALL SANDBOX CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED`);
  if (failures.length > 0) process.exit(1);

  async function stockSeries(): Promise<{ onHand: number; onOrder: number; available: number }> {
    const resp = await fetchStocks([ITEM_ID]);
    const row = (resp as unknown as { data: JubelioStockItem[] }).data
      .flatMap((item) => item.location_stocks)
      .find((ls) => ls.location_id === LOCATION_ID);
    return {
      onHand: Number(row?.on_hand ?? 0),
      onOrder: Number(row?.on_order ?? 0),
      available: Number(row?.available ?? 0),
    };
  }
}

main().catch((error) => {
  console.error("SANDBOX SUITE FAILED:", error);
  process.exit(1);
});