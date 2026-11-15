// Read-only investigation. Never repeat an ambiguous invoice conversion POST.
import dotenv from "dotenv";
dotenv.config({ path: "../../.env", quiet: true });
import { createJubelioSalesGateway } from "../lib/jubelio-sales-client";

async function main() {
  if (process.env.JUBELIO_SALES_TEST_ACCOUNT_ENABLED !== "true" || process.env.JUBELIO_API_BASE_URL !== "https://api2.jubelio.com") {
    throw new Error("isolated sandbox account not configured");
  }
  const order = await createJubelioSalesGateway().getSalesOrder(68388);
  console.log(JSON.stringify({ salesOrderId: order.salesorderId, invoiceId: order.invoiceId, isCanceled: order.isCanceled, locationId: order.locationId, itemIds: order.items.map((item) => item.itemId) }));
  const login = await fetch("https://api2.jubelio.com/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.JUBELIO_EMAIL, password: process.env.JUBELIO_PASSWORD }) });
  if (!login.ok) throw new Error(`login status ${login.status}`);
  const { token } = await login.json();
  const invoices = await fetch("https://api2.jubelio.com/sales/invoices/?page=1&pageSize=100&q=Sandbox%20Integration", { headers: { Authorization: token } });
  if (!invoices.ok) throw new Error(`invoice list status ${invoices.status}`);
  const body = await invoices.json();
  console.log(JSON.stringify({ invoiceListShape: Array.isArray(body) ? "array" : Object.keys(body), totalCount: body.totalCount, invoices: (Array.isArray(body) ? body : body.data ?? []).map((row: Record<string, unknown>) => ({ id: row.invoice_id ?? row.id, salesorderId: row.salesorder_id, invoiceNo: row.invoice_no, refNo: row.ref_no })).slice(0, 100) }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
