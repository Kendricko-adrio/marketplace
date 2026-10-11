// One interpretation of the existing settlement ledger for reads and packing.
type SettlementOrder = {
  jubelioSalesOrderId: number | null;
  jubelioInvoiceId: number | null;
  jubelioPaymentId: number | null;
};
type SettlementOperation = {
  type: string;
  status: string;
  salesOrderId: number | null;
  invoiceId: number | null;
  paymentId: number | null;
};
export function deliverySettlementBlocker(order: SettlementOrder, operations: SettlementOperation[]): string | null {
  if (operations.some((op) => op.type === "cancel" && ["intent", "dispatched_unknown", "confirmed", "manual_review"].includes(op.status))) {
    return "Pembatalan Sales Order aktif — penanganan manual diperlukan.";
  }
  const invoice = operations.find((op) => op.type === "invoice");
  if (!invoice || invoice.status !== "confirmed" || invoice.invoiceId === null || invoice.invoiceId !== order.jubelioInvoiceId || invoice.salesOrderId !== order.jubelioSalesOrderId) {
    return "Invoice Jubelio belum terverifikasi.";
  }
  const payment = operations.find((op) => op.type === "payment");
  if (!payment || payment.status !== "confirmed" || payment.paymentId === null || payment.paymentId !== order.jubelioPaymentId || payment.invoiceId !== order.jubelioInvoiceId || payment.salesOrderId !== order.jubelioSalesOrderId || order.jubelioSalesOrderId === null) {
    return "Pembayaran Jubelio belum terverifikasi.";
  }
  return null;
}
export function deliverySettlementVerified(order: SettlementOrder, operations: SettlementOperation[]): boolean {
  return deliverySettlementBlocker(order, operations) === null;
}
