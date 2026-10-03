import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

type Scenario =
  | "success"
  | "insufficient-stock"
  | "server-error"
  | "rate-limit-once"
  | "unauthorized-once"
  | "timeout-before-apply"
  | "timeout-after-apply"
  | "malformed-success"
  | "malformed-success-after-apply";

type MockStock = {
  locationId: number;
  itemId: number;
  onHand: number;
  description: string;
  cost: number;
  unit: string;
  sellPrice: number;
  taxRate: number;
  onOrder: number;
  reserved: number;
};

type Adjustment = {
  id: number;
  number: string;
  note: string;
  locationId: number;
  transactionDate: string;
  items: Array<Record<string, unknown>>;
};

type SalesOrderItem = {
  salesorder_detail_id: number;
  item_id: number;
  qty_in_base: number;
  price: number;
  disc_amount: number;
  tax_amount: number;
  amount: number;
  unit: string;
  tax_id: number;
  location_id: number;
};

type SalesOrder = {
  salesorder_id: number;
  salesorder_no: string;
  contact_id: number;
  customer_name: string;
  transaction_date: string;
  location_id: number;
  source: number;
  sub_total: number;
  total_disc: number;
  total_tax: number;
  grand_total: number;
  note: string;
  ref_no: string;
  is_canceled: boolean;
  invoice_id: number | null;
  invoice_no: string | null;
  items: SalesOrderItem[];
};

type Invoice = {
  invoice_id: number;
  invoice_no: string;
  salesorder_id: number;
  contact_id: number;
  customer_name: string;
  transaction_date: string;
  location_id: number;
  sub_total: number;
  total_disc: number;
  total_tax: number;
  grand_total: number;
  payment_amount: number;
  items: SalesOrderItem[];
};

type InvoicePayment = {
  payment_id: number;
  payment_no: string;
  payment_type: number;
  contact_id: number;
  transaction_date: string;
  account_id: number;
  note: string;
  amount: number;
  invoices: Array<{
    payment_detail_id: number;
    payment_id: number;
    trx_date: string;
    invoice_id: number;
    payment_amount: number;
  }>;
};

type MockContact = {
  contact_id: number;
  contact_name: string;
  contact_type: number;
  primary_contact: string;
};

const stocks = new Map<string, MockStock>();
const adjustments = new Map<number, Adjustment>();
const midtransStatuses = new Map<
  string,
  {
    transactionStatus: string;
    grossAmount: string;
    fraudStatus?: string;
    paymentType?: string;
    transactionId?: string;
  }
>();
const requests: Array<{ method: string; path: string; body: unknown }> = [];
let nextAdjustmentId = 1;
let shipmentSequence = 6000;
const shipmentRecords = new Map<number, Record<string, unknown>>();
let shipmentRates = 20000;
let shipmentScenario = "rate-normal";
let scenario: Scenario = "success";
let scenarioHits = 0;

function stockKey(locationId: number, itemId: number): string {
  return `${locationId}:${itemId}`;
}

// Generic "Pelanggan Umum" walk-in customer, contact_id -1 per canary preflight.
const genericCustomer: MockContact = {
  contact_id: -1,
  contact_name: "Pelanggan Umum",
  contact_type: 0,
  primary_contact: "Pelanggan Umum",
};
const contacts: MockContact[] = [genericCustomer];
const salesOrders = new Map<number, SalesOrder>();
const invoices = new Map<number, Invoice>();
const payments = new Map<number, InvoicePayment>();
let nextSalesOrderId = 68378;
let nextInvoiceId = 222;
let nextPaymentId = 17;

function availableStock(stock: MockStock): number {
  // Documented Jubelio formula: available = on_hand - on_order - reserved.
  return stock.onHand - stock.onOrder - stock.reserved;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function badRequest(response: ServerResponse, message: string): void {
  json(response, 400, {
    statusCode: "400",
    error: "Bad Request",
    code: "E000003",
    message,
  });
}

function unknownRef(response: ServerResponse, message: string): void {
  json(response, 404, {
    statusCode: "404",
    error: "Not Found",
    code: "E000001",
    message,
  });
}

function conflict(response: ServerResponse, message: string): void {
  json(response, 409, { statusCode: "409", error: "Conflict", message });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function resetMockState(): void {
  stocks.clear();
  adjustments.clear();
  salesOrders.clear();
  invoices.clear();
  payments.clear();
  midtransStatuses.clear();
  requests.length = 0;
  contacts.length = 0;
  contacts.push(genericCustomer);
  nextAdjustmentId = 1;
  nextSalesOrderId = 68378;
  nextInvoiceId = 222;
  nextPaymentId = 17;
  scenario = "success";
  scenarioHits = 0;
}

function authorized(request: IncomingMessage): boolean {
  return request.headers.authorization === "mock-token";
}

export const jubelioMockServer = createServer(async (request, response) => {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const body = method === "POST" || method === "PUT" ? await readJson(request) : {};
  requests.push({ method, path: url.pathname, body });

  if (method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (method === "POST" && url.pathname === "/__control/reset") {
    resetMockState();
    return json(response, 200, { status: "ok" });
  }
  if (method === "PUT" && url.pathname === "/__control/scenario") {
    scenario = String(body.scenario || "success") as Scenario;
    scenarioHits = 0;
    return json(response, 200, { status: "ok", scenario });
  }
  if (method === "GET" && url.pathname === "/__control/requests") {
    return json(response, 200, { data: requests });
  }
  if (method === "PUT" && url.pathname === "/__control/midtrans-status") {
    const orderId = String(body.orderId || "");
    if (!orderId) return json(response, 400, { error: "orderId is required" });
    midtransStatuses.set(orderId, {
      transactionStatus: String(body.transactionStatus || "pending"),
      grossAmount: String(body.grossAmount || "0.00"),
      fraudStatus:
        typeof body.fraudStatus === "string" ? body.fraudStatus : undefined,
      paymentType:
        typeof body.paymentType === "string" ? body.paymentType : undefined,
      transactionId:
        typeof body.transactionId === "string" ? body.transactionId : undefined,
    });
    return json(response, 200, { status: "ok" });
  }
  const midtransStatus = url.pathname.match(/^\/v2\/([^/]+)\/status$/);
  if (method === "GET" && midtransStatus) {
    const orderId = decodeURIComponent(midtransStatus[1]);
    const configured = midtransStatuses.get(orderId);
    if (!configured) return json(response, 404, { status_code: "404" });
    return json(response, 200, {
      order_id: orderId,
      transaction_status: configured.transactionStatus,
      gross_amount: configured.grossAmount,
      fraud_status: configured.fraudStatus,
      payment_type: configured.paymentType,
      transaction_id: configured.transactionId,
      status_code: "200",
      status_message: "Success, transaction found",
    });
  }
  if (method === "POST" && url.pathname === "/__control/contacts/ensure") {
    const contactId = Number(body.contact_id);
    if (!Number.isInteger(contactId) || typeof body.contact_name !== "string") {
      return json(response, 400, { error: "contact_id and contact_name are required" });
    }
    if (!contacts.some((contact) => contact.contact_id === contactId)) {
      contacts.push({
        contact_id: contactId,
        contact_name: body.contact_name,
        contact_type: 0,
        primary_contact: body.contact_name,
      });
    }
    return json(response, 200, { status: "ok" });
  }

  if (method === "POST" && url.pathname === "/__control/stocks/ensure") {
    const locationId = Number(body.locationId);
    const itemId = Number(body.itemId);
    const key = stockKey(locationId, itemId);
    if (!stocks.has(key)) {
      stocks.set(key, {
        locationId,
        itemId,
        onHand: Number(body.onHand),
        description: String(body.description || `Item ${itemId}`),
        cost: Number(body.cost || 100_000),
        unit: String(body.unit || "Buah"),
        sellPrice: Number(body.sellPrice || 1_300_000),
        taxRate: Number(body.taxRate || 0),
        onOrder: 0,
        reserved: 0,
      });
    }
    return json(response, 200, { status: "ok" });
  }

  if (method === "PUT" && url.pathname === "/__control/shipment") {
    shipmentScenario = String(body.scenario);
    if (body.shipment && typeof body.shipment === "object" && !Array.isArray(body.shipment)) {
      const fixture = body.shipment as Record<string, unknown>;
      if (Number.isSafeInteger(fixture.shipment_id) && Number(fixture.shipment_id) > 0) shipmentRecords.set(Number(fixture.shipment_id), { ...fixture });
    }
    shipmentRates = typeof body.rates === "number" ? body.rates : 20000;
    return json(response, 200, { status: "ok" });
  }
  if (method === "POST" && url.pathname === "/auth/generate-token") {
    return json(response, 200, { token: "mock-token", expires_in: 86400 });
  }
  if (method === "POST" && url.pathname === "/rates/all") {
    if (request.headers.authorization !== "Bearer mock-token") return json(response, 401, { error: "Unauthorized" });
    if (shipmentScenario === "rate-failure") return json(response, 500, { error: "Fixture rate failure" });
    return json(response, 200, shipmentScenario === "rate-empty" ? [] : [{ courier_id: 13, courier_name: "JNE", courier_service_id: 1327, courier_service_code: "REG", courier_service_name: "JNE REG Fixture", rates: shipmentRates, final_rates: 10000, shipping_insurance: null, is_cod_supported: false }]);
  }

  if (method === "GET" && url.pathname.startsWith("/shipments/awb/")) {
    if (request.headers.authorization !== "Bearer mock-token") return json(response, 401, { error: "Unauthorized" });
    const awb = decodeURIComponent(url.pathname.slice("/shipments/awb/".length));
    const fixture = [...shipmentRecords.values()].find((record) => record.awb === awb);
    return fixture ? json(response, 200, fixture) : json(response, 404, { error: "Unknown AWB" });
  }

  if (method === "POST" && url.pathname === "/shipments/create") {
    if (request.headers.authorization !== "Bearer mock-token") return json(response, 401, { error: "Unauthorized" });
    const shipment_id = ++shipmentSequence;
    const booked = { shipment_id, awb: `MOCKAWB${shipment_id}`, tracking_url: `http://127.0.0.1:${process.env.JUBELIO_MOCK_PORT ?? "3112"}/tracking/${shipment_id}`, price: 25000, price_bill: 30000 };
    shipmentRecords.set(shipment_id, { ...booked, ref_no: body.ref_no });
    if (shipmentScenario === "booking-timeout-after-apply") await new Promise((resolve) => setTimeout(resolve, 1000));
    return json(response, 200, booked);
  }

  const fixtureRegions: Record<string, unknown[]> = {
    "/region/provinces": [{ province_id: "01", name: "Fixture Province" }],
    "/region/cities/01": [{ city_id: "0101", province_id: "01", name: "Fixture City" }],
    "/region/districts/0101": [{ district_id: "010101", city_id: "0101", name: "Fixture District" }],
    "/region/areas/010101": [{ area_id: "01010101", district_id: "010101", name: "Fixture Area", zipcode: "01234" }],
  };
  if (method === "GET" && url.pathname.startsWith("/region/")) {
    return json(response, 200, fixtureRegions[url.pathname] ?? []);
  }

  if (method === "POST" && url.pathname === "/login") {
    return json(response, 200, { token: "mock-token" });
  }

  if (!authorized(request)) {
    return json(response, 401, { statusCode: "401", error: "Unauthorized" });
  }

  if (method === "GET" && url.pathname === "/contacts/customers/") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const data = contacts.filter((contact) =>
      contact.contact_name.toLowerCase().includes(q),
    );
    return json(response, 200, { data });
  }

  if (method === "GET" && url.pathname === "/inventory/") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const locationIds = [
      ...new Set([...stocks.values()].map((stock) => stock.locationId)),
    ].sort((a, b) => a - b);
    const data = [...stocks.values()]
      .filter(
        (stock) =>
          stock.description.toLowerCase().includes(q) ||
          String(stock.itemId).includes(q),
      )
      .map((stock) => {
        const locationStock = {
          item_id: String(stock.itemId),
          location_id: String(stock.locationId),
          on_hand: stock.onHand,
          on_order: stock.onOrder,
          reserved: stock.reserved,
          available: availableStock(stock),
        };
        return {
          item_id: String(stock.itemId),
          item_code: `MOCK-${stock.itemId}`,
          item_name: stock.description,
          item_group_id: String(Math.floor(stock.itemId / 10)),
          is_bundle: false,
          location_stocks: [locationStock],
          total_stocks: {
            on_hand: locationStock.on_hand,
            on_order: locationStock.on_order,
            reserved: locationStock.reserved,
            available: locationStock.available,
          },
        };
      });
    return json(response, 200, {
      channels: [],
      locations: locationIds.map((locationId) => ({
        location_id: String(locationId),
        location_name: `Mock location ${locationId}`,
      })),
      data,
      totalCount: data.length,
    });
  }

  if (method === "POST" && url.pathname === "/sales/orders/") {
    if (body.salesorder_id !== 0 || body.salesorder_no !== "[auto]") {
      return badRequest(
        response,
        "Mock supports creation only: salesorder_id 0 and salesorder_no \"[auto]\" are required",
      );
    }
    const contact = contacts.find(
      (candidate) => candidate.contact_id === body.contact_id,
    );
    if (!contact) {
      return unknownRef(response, "Unknown contact_id");
    }
    if (typeof body.customer_name !== "string" || !body.customer_name.trim()) {
      return badRequest(response, "customer_name is required");
    }
    if (
      typeof body.transaction_date !== "string" ||
      !body.transaction_date
    ) {
      return badRequest(response, "transaction_date is required");
    }
    if (
      !isNonNegativeNumber(body.sub_total) ||
      !isNonNegativeNumber(body.total_disc) ||
      !isNonNegativeNumber(body.total_tax) ||
      !isNonNegativeNumber(body.grand_total) ||
      !isNonNegativeNumber(body.add_fee) ||
      !isNonNegativeNumber(body.add_disc) ||
      !isNonNegativeNumber(body.service_fee)
    ) {
      return badRequest(response, "Amounts must be finite non-negative numbers");
    }
    // Amounts are validated as finite non-negative numbers only. The mock does
    // NOT derive or verify remote totals (grand_total vs sub_total/disc/tax,
    // item amount derivation under tax/fees) — that remote behavior is unverified.
    const locationId = Number(body.location_id);
    // Conservative rollout rule: fulfillment/pickup happens at the header
    // location, so every item line must target the same location.
    if (!Number.isInteger(locationId)) {
      return badRequest(response, "location_id must be an integer");
    }
    // Schema documents source 1 = Internal; other values are unverified for
    // this rollout and are rejected.
    if (Number(body.source) !== 1) {
      return badRequest(response, "source must be 1 (Internal)");
    }
    const hasLocation = [...stocks.values()].some(
      (stock) => stock.locationId === locationId,
    );
    if (!hasLocation) {
      return unknownRef(response, "Unknown location_id");
    }
    const rawItems = Array.isArray(body.items) ? body.items : null;
    if (!rawItems || rawItems.length < 1) {
      return badRequest(response, "items must be a non-empty array");
    }
    const items: SalesOrderItem[] = [];
    const demand = new Map<string, number>();
    for (const raw of rawItems) {
      const item = raw as Record<string, unknown>;
      const itemId = Number(item.item_id);
      const qty = Number(item.qty_in_base);
      const price = item.price;
      const discAmount = item.disc_amount;
      const taxAmount = item.tax_amount;
      const amount = item.amount;
      if (
        !Number.isInteger(itemId) ||
        typeof item.salesorder_detail_id !== "number" ||
        typeof item.unit !== "string" ||
        !Number.isInteger(Number(item.tax_id)) ||
        !isNonNegativeNumber(price) ||
        !isNonNegativeNumber(discAmount) ||
        !isNonNegativeNumber(taxAmount) ||
        !isNonNegativeNumber(amount) ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isInteger(Number(item.location_id))
      ) {
        return badRequest(response, "Invalid sales order item fields");
      }
      const stock = stocks.get(stockKey(Number(item.location_id), itemId));
      if (!stock) {
        return unknownRef(
          response,
          `Unknown item_id ${itemId} at location ${item.location_id}`,
        );
      }
      if (Number(item.location_id) !== locationId) {
        return badRequest(
          response,
          "Item location_id must match the sales order header location",
        );
      }
      // Duplicate lines of the same item are aggregated: combined demand is
      // checked against available stock before anything is written.
      const demandKey = stockKey(Number(item.location_id), itemId);
      demand.set(demandKey, (demand.get(demandKey) || 0) + qty);
      items.push({
        salesorder_detail_id: Number(item.salesorder_detail_id),
        item_id: itemId,
        qty_in_base: qty,
        price: Number(price),
        disc_amount: Number(discAmount),
        tax_amount: Number(taxAmount),
        amount: Number(amount),
        unit: item.unit,
        tax_id: Number(item.tax_id),
        location_id: Number(item.location_id),
      });
    }
    for (const [key, totalQty] of demand) {
      const stock = stocks.get(key)!;
      if (availableStock(stock) < totalQty) {
        // Conservative mock rule; real SO create behavior on insufficient stock is unverified.
        return json(response, 500, {
          statusCode: "500",
          error: "Internal Server Error",
          code: "23100",
          message: "error_inventory: transaction would make the inventory minus",
        });
      }
    }
    for (const item of items) {
      const stock = stocks.get(stockKey(item.location_id, item.item_id))!;
      stock.onOrder += item.qty_in_base;
    }
    const salesorderId = nextSalesOrderId++;
    salesOrders.set(salesorderId, {
      salesorder_id: salesorderId,
      salesorder_no: `SO-${String(salesorderId).padStart(9, "0")}`,
      contact_id: contact.contact_id,
      customer_name: body.customer_name,
      transaction_date: body.transaction_date,
      location_id: locationId,
      source: Number(body.source),
      sub_total: Number(body.sub_total),
      total_disc: Number(body.total_disc),
      total_tax: Number(body.total_tax),
      grand_total: Number(body.grand_total),
      note: typeof body.note === "string" ? body.note : "",
      ref_no: typeof body.ref_no === "string" ? body.ref_no : "",
      is_canceled: false,
      invoice_id: null,
      invoice_no: null,
      items,
    });
    // Ambiguous outcome hooks: the write has already been applied in both
    // branches — the client reconciles via GET, it does not retry the POST.
    if (scenario === "timeout-after-apply") {
      const timer = setTimeout(() => {
        try {
          json(response, 200, { id: salesorderId });
        } catch {
          // client already gone
        }
      }, 1_000);
      timer.unref();
      return;
    }
    if (scenario === "malformed-success-after-apply") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, { id: salesorderId });
  }

  const salesOrderDetail = url.pathname.match(/^\/sales\/orders\/(\d+)$/);
  if (method === "GET" && salesOrderDetail) {
    const order = salesOrders.get(Number(salesOrderDetail[1]));
    if (!order) {
      return unknownRef(response, "Unknown sales order id");
    }
    return json(response, 200, {
      salesorder_id: order.salesorder_id,
      salesorder_no: order.salesorder_no,
      contact_id: order.contact_id,
      customer_name: order.customer_name,
      transaction_date: order.transaction_date,
      location_id: order.location_id,
      source: order.source,
      sub_total: order.sub_total,
      total_disc: order.total_disc,
      total_tax: order.total_tax,
      grand_total: order.grand_total,
      note: order.note,
      ref_no: order.ref_no,
      is_canceled: order.is_canceled,
      invoice_id: order.invoice_id,
      invoice_no: order.invoice_no,
      items: order.items.map((item) => ({
        salesorder_detail_id: item.salesorder_detail_id,
        item_id: item.item_id,
        qty_in_base: item.qty_in_base,
        price: item.price,
        unit: item.unit,
        tax_id: item.tax_id,
        amount: item.amount,
        location_id: item.location_id,
      })),
    });
  }

  if (method === "POST" && url.pathname === "/sales/packlists/create-invoice") {
    const salesorderId = body.salesorder_id;
    if (!Number.isInteger(salesorderId) || (salesorderId as number) < 0) {
      return badRequest(response, "salesorder_id must be a non-negative integer");
    }
    const order = salesOrders.get(salesorderId as number);
    if (!order) {
      return unknownRef(response, `Unknown salesorder_id ${String(salesorderId)}`);
    }
    if (order.is_canceled) {
      return conflict(response, "Cannot invoice a canceled sales order");
    }
    if (order.invoice_id !== null) {
      // At most one invoice per SO: a repeat POST never writes a second invoice.
      // HYPOTHETICAL — invented rollout contract; live duplicate create-invoice
      // behavior is unverified. A gateway must not map this 409 to
      // "already invoiced" until sandbox evidence exists.
      return conflict(
        response,
        `Sales order ${String(salesorderId)} already has an invoice`,
      );
    }
    const invoiceId = nextInvoiceId++;
    invoices.set(invoiceId, {
      invoice_id: invoiceId,
      invoice_no: `INV-${String(invoiceId).padStart(9, "0")}`,
      salesorder_id: order.salesorder_id,
      contact_id: order.contact_id,
      customer_name: order.customer_name,
      transaction_date: order.transaction_date,
      location_id: order.location_id,
      sub_total: order.sub_total,
      total_disc: order.total_disc,
      total_tax: order.total_tax,
      grand_total: order.grand_total,
      payment_amount: 0,
      items: order.items,
    });
    order.invoice_id = invoiceId;
    order.invoice_no = `INV-${String(invoiceId).padStart(9, "0")}`;
    // HYPOTHETICAL, no live evidence: whether GET /sales/orders/{id} surfaces
    // invoice_id/invoice_no after create-invoice is unverified (the canary only
    // observed invoice_id: null PRE-invoice). Gateway reconciliation must treat
    // missing SO linkage as manual_review, never as proof of failure or
    // success. The mock links them so reconciliation can be exercised locally.
    // HYPOTHETICAL, no live invoice evidence: the mock leaves on_order/on_hand/
    // available untouched when invoicing. The real stock effect of invoicing
    // is unverified pending evidence; do not treat this as a proven transition.
    if (scenario === "timeout-after-apply") {
      const timer = setTimeout(() => {
        try {
          json(response, 200, { status: "ok", id: invoiceId });
        } catch {
          // client already gone
        }
      }, 1_000);
      timer.unref();
      return;
    }
    if (scenario === "malformed-success-after-apply") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, { status: "ok", id: invoiceId });
  }

  const invoiceDetail = url.pathname.match(/^\/sales\/invoices\/(\d+)$/);
  if (method === "GET" && invoiceDetail) {
    const invoice = invoices.get(Number(invoiceDetail[1]));
    if (!invoice) {
      return unknownRef(response, "Unknown invoice id");
    }
    return json(response, 200, {
      invoice_id: invoice.invoice_id,
      invoice_no: invoice.invoice_no,
      salesorder_id: invoice.salesorder_id,
      contact_id: invoice.contact_id,
      customer_name: invoice.customer_name,
      transaction_date: invoice.transaction_date,
      location_id: invoice.location_id,
      sub_total: String(invoice.sub_total),
      total_disc: String(invoice.total_disc),
      total_tax: String(invoice.total_tax),
      // Documented getInvoiceResponse types grand_total as a string.
      grand_total: String(invoice.grand_total),
      payment_amount: invoice.payment_amount,
      items: invoice.items.map((item, index) => ({
        invoice_detail_id: index,
        item_id: item.item_id,
        item_code: `MOCK-${item.item_id}`,
        item_name: `Item ${item.item_id}`,
        description: `Item ${item.item_id}`,
        tax_id: item.tax_id,
        price: item.price,
        unit: item.unit,
        qty: item.qty_in_base,
        qty_in_base: item.qty_in_base,
        disc: item.disc_amount,
        disc_amount: item.disc_amount,
        tax_amount: item.tax_amount,
        amount: item.amount,
        location_id: item.location_id,
      })),
    });
  }

  if (method === "POST" && url.pathname === "/sales/payments/") {
    if (body.payment_id !== 0 || body.payment_no !== "[auto]") {
      return badRequest(
        response,
        'Mock supports creation only: payment_id 0 and payment_no "[auto]" are required',
      );
    }
    if (
      !Number.isInteger(Number(body.account_id)) ||
      Number(body.account_id) < 0 ||
      !Number.isInteger(Number(body.payment_type)) ||
      typeof body.transaction_date !== "string" ||
      !body.transaction_date
    ) {
      return badRequest(response, "Invalid payment header fields");
    }
    const contact = contacts.find(
      (candidate) => candidate.contact_id === body.contact_id,
    );
    if (!contact) {
      return unknownRef(response, "Unknown contact_id");
    }
    if (!isNonNegativeNumber(body.amount)) {
      return badRequest(response, "amount must be a finite non-negative number");
    }
    const rawItems = Array.isArray(body.items) ? body.items : null;
    if (!rawItems || rawItems.length < 1) {
      return badRequest(response, "items must be a non-empty array");
    }
    // Multi-line atomicity: repeated invoice_id lines in ONE request are
    // rejected before any write, and per-invoice demand is accumulated here so
    // the overpay guard below sees the combined amount of the pending request,
    // not just the stored payment_amount (which is only mutated after the
    // validation loop). Without this, two lines against the same invoice each
    // validate against the same base and both writes land — minting an
    // overpaid invoice inside a single request.
    const seenInvoiceIds = new Set<number>();
    const pendingByInvoice = new Map<number, number>();
    let detailSum = 0;
    for (const raw of rawItems) {
      const item = raw as Record<string, unknown>;
      if (
        item.payment_detail_id !== 0 ||
        !Number.isInteger(Number(item.invoice_id))
      ) {
        return badRequest(response, "Invalid payment item fields");
      }
      if (!isNonNegativeNumber(item.payment_amount)) {
        return badRequest(
          response,
          "payment_amount must be a finite non-negative number",
        );
      }
      const invoice = invoices.get(Number(item.invoice_id));
      if (!invoice) {
        return unknownRef(
          response,
          `Unknown invoice_id ${String(item.invoice_id)}`,
        );
      }
      // Duplicate detail line within one request: reject the whole request
      // before any write (the per-line checks cannot see combined demand).
      if (seenInvoiceIds.has(invoice.invoice_id)) {
        return badRequest(
          response,
          `Repeated invoice_id ${String(item.invoice_id)} in one payment`,
        );
      }
      seenInvoiceIds.add(invoice.invoice_id);
      // Association rule: the payment must target the invoice's own contact.
      if (Number(body.contact_id) !== invoice.contact_id) {
        return badRequest(
          response,
          "contact_id does not match the invoiced contact",
        );
      }
      // Duplicate prevention: at most one payment per invoice in this rollout.
      // HYPOTHETICAL — the real API may accept partial payments; the mock
      // refuses a second payment write for an already-paid invoice.
      if (invoice.payment_amount > 0) {
        return conflict(
          response,
          `Invoice ${String(item.invoice_id)} already has a payment recorded`,
        );
      }
      // No overpay: documented error 23108 — payment exceeds invoice value.
      // The check includes this request's pending demand for the invoice, so
      // validation is against combined demand, not per-line amounts.
      if (
        invoice.payment_amount +
          (pendingByInvoice.get(invoice.invoice_id) || 0) +
          Number(item.payment_amount) >
        invoice.grand_total
      ) {
        return json(response, 500, {
          statusCode: "500",
          error: "Internal Server Error",
          code: "23108",
          message: "error_transaction: payment exceeds the value of this invoice",
        });
      }
      pendingByInvoice.set(
        invoice.invoice_id,
        (pendingByInvoice.get(invoice.invoice_id) || 0) + Number(item.payment_amount),
      );
      detailSum += Number(item.payment_amount);
    }
    // CONSERVATIVE MOCK INVARIANT, remote rule unverified: the header amount
    // must equal the sum of the payment detail lines. The live saveSalesPayment
    // behavior for a header/detail mismatch has never been observed; the mock
    // refuses to store a settlement record whose header and details disagree.
    if (Number(body.amount) !== detailSum) {
      return badRequest(
        response,
        "amount must equal the sum of items[].payment_amount",
      );
    }
    const paymentId = nextPaymentId++;
    const detail = (rawItems as Array<Record<string, unknown>>).map(
      (item) => ({
        payment_detail_id: Number(item.payment_detail_id),
        payment_id: paymentId,
        trx_date: String(body.transaction_date),
        invoice_id: Number(item.invoice_id),
        payment_amount: Number(item.payment_amount),
      }),
    );
    payments.set(paymentId, {
      payment_id: paymentId,
      payment_no: `PAY-${String(paymentId).padStart(9, "0")}`,
      payment_type: Number(body.payment_type),
      contact_id: Number(body.contact_id),
      transaction_date: String(body.transaction_date),
      account_id: Number(body.account_id),
      note: typeof body.note === "string" ? body.note : "",
      amount: Number(body.amount),
      invoices: detail,
    });
    for (const entry of detail) {
      const invoice = invoices.get(entry.invoice_id)!;
      invoice.payment_amount += entry.payment_amount;
    }
    // No stock effect is modeled for payments; any remote stock/accounting
    // side effect is unverified pending evidence.
    if (scenario === "timeout-after-apply") {
      const timer = setTimeout(() => {
        try {
          json(response, 200, { status: "ok", id: paymentId });
        } catch {
          // client already gone
        }
      }, 1_000);
      timer.unref();
      return;
    }
    if (scenario === "malformed-success-after-apply") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, { status: "ok", id: paymentId });
  }

  const paymentDetail = url.pathname.match(/^\/sales\/payments\/(\d+)$/);
  if (method === "GET" && paymentDetail) {
    const payment = payments.get(Number(paymentDetail[1]));
    if (!payment) {
      return unknownRef(response, "Unknown payment id");
    }
    return json(response, 200, {
      payment_id: payment.payment_id,
      payment_no: payment.payment_no,
      payment_type: payment.payment_type,
      contact_id: payment.contact_id,
      transaction_date: payment.transaction_date,
      account_id: payment.account_id,
      note: payment.note,
      // Documented getSalesPaymentResponse types amount as a string.
      amount: String(payment.amount),
      invoices: payment.invoices,
    });
  }

  if (method === "POST" && url.pathname === "/sales/orders/cancel/") {
    const ids = body.ids;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 200 ||
      !ids.every(
        (id) => typeof id === "number" && Number.isInteger(id) && id >= 0,
      ) ||
      // Duplicate ids in one request would restore the same hold twice;
      // reject the whole request before any state changes.
      new Set(ids).size !== ids.length
    ) {
      return badRequest(response, "ids must be a non-empty array of distinct SO IDs");
    }
    const selected: SalesOrder[] = [];
    for (const id of ids) {
      const order = salesOrders.get(id as number);
      if (!order) {
        return unknownRef(response, `Unknown sales order id ${id}`);
      }
      if (order.is_canceled) {
        return conflict(response, `Sales order ${id} is already canceled`);
      }
      if (order.invoice_id !== null) {
        // Pre-invoice cancellation only; invoiced SOs are out of scope for cancel.
        // HYPOTHETICAL — invented rollout contract; live cancel-after-invoice
        // behavior is unverified pending sandbox evidence.
        return conflict(
          response,
          `Sales order ${id} already has an invoice and cannot be canceled`,
        );
      }
      selected.push(order);
    }
    for (const order of selected) {
      order.is_canceled = true;
      for (const item of order.items) {
        const stock = stocks.get(stockKey(item.location_id, item.item_id));
        if (stock) stock.onOrder = Math.max(0, stock.onOrder - item.qty_in_base);
      }
    }
    // Ambiguous outcome hooks: the cancellation has already been applied in
    // both branches — the client reconciles via GET, it does not retry.
    if (scenario === "timeout-after-apply") {
      const timer = setTimeout(() => {
        try {
          json(response, 200, { status: "ok" });
        } catch {
          // client already gone
        }
      }, 1_000);
      timer.unref();
      return;
    }
    if (scenario === "malformed-success-after-apply") {
      return json(response, 200, {});
    }
    return json(response, 200, { status: "ok" });
  }

  if (method === "GET" && url.pathname === "/systemsetting/account-mapping") {
    return json(response, 200, {
      adjp_acct_id: 75,
      adjm_acct_id: 72,
      adjp_account_name: "7-7004 - Penyesuaian Persediaan Barang",
      adjm_account_name: "8-8004 - Penyesuaian Persediaan Barang",
    });
  }

  const defaultBin = url.pathname.match(/^\/wms\/default-bin\/(\d+)$/);
  if (method === "GET" && defaultBin) {
    const locationId = Number(defaultBin[1]);
    return json(response, 200, {
      bin_id: locationId * 10 + 1,
      location_id: locationId,
      bin_final_code: `MOCK-${locationId}`,
      acknowledge_stock: true,
    });
  }

  const toSell = url.pathname.match(/^\/inventory\/items\/to-sell\/(\d+)$/);
  if (method === "GET" && toSell) {
    const locationId = Number(toSell[1]);
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const data = [...stocks.values()]
      .filter(
        (stock) =>
          stock.locationId === locationId &&
          (stock.description.toLowerCase().includes(q) ||
            String(stock.itemId).includes(q)),
      )
      .map((stock) => ({
        item_group_id: Math.floor(stock.itemId / 10),
        item_id: stock.itemId,
        item_name: stock.description,
        item_code: `MOCK-${stock.itemId}`,
        sell_price: stock.sellPrice,
        sell_unit: stock.unit,
        sell_tax_id: 1,
        rate: stock.taxRate,
        tax_name: stock.taxRate === 0 ? "PPN 0%" : `PPN ${stock.taxRate}%`,
        account_code: "4-4000",
        account_name: "4-4000 - Penjualan",
      }));
    // Verified runtime canary: {data, totalCount} wrapper, unlike the OpenAPI array schema.
    return json(response, 200, { data, totalCount: data.length });
  }

  if (method === "POST" && url.pathname === "/inventory/items/to-adjust/") {
    const locationId = Number(body.location_id);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map(Number)) : new Set<number>();
    const data = [...stocks.values()]
      .filter((stock) => stock.locationId === locationId && ids.has(stock.itemId))
      .map((stock) => ({
        item_id: stock.itemId,
        item_name: stock.description,
        item_full_name: `${stock.itemId} - ${stock.description}`,
        unit: stock.unit,
        account_id: 4,
        account_code: "1-1200",
        account_name: "1-1200 - Persediaan Barang",
        cost: stock.cost,
        end_qty: stock.onHand,
        resulting_qty: stock.onHand,
      }));
    return json(response, 200, data);
  }

  const toStock = url.pathname.match(/^\/inventory\/items\/to-stock\/(\d+)$/);
  if (method === "GET" && toStock) {
    const locationId = Number(toStock[1]);
    const data = [...stocks.values()]
      .filter((stock) => stock.locationId === locationId)
      .map((stock) => ({
        item_id: stock.itemId,
        item_group_id: Math.floor(stock.itemId / 10),
        item_code: `MOCK-${stock.itemId}`,
        item_name: stock.description,
        item_full_name: `${stock.itemId} - ${stock.description}`,
        buy_price: stock.cost.toFixed(4),
        buy_unit: stock.unit,
        average_cost: stock.cost.toFixed(12),
        invt_acct_id: 4,
        end_qty: stock.onHand,
        available_qty: stock.onHand,
      }));
    return json(response, 200, { data, totalCount: data.length });
  }

  if (method === "POST" && url.pathname === "/inventory/adjustments/") {
    scenarioHits++;
    if (scenario === "unauthorized-once" && scenarioHits === 1) {
      return json(response, 401, { statusCode: "401", error: "Unauthorized" });
    }
    if (scenario === "rate-limit-once" && scenarioHits === 1) {
      response.setHeader("retry-after", "0");
      return json(response, 429, { statusCode: "429", error: "Too Many Requests" });
    }
    if (scenario === "server-error") {
      return json(response, 500, {
        statusCode: "500",
        error: "Internal Server Error",
        message: "Mock server error",
        code: "MOCK_500",
      });
    }
    if (scenario === "timeout-before-apply") {
      return setTimeout(() => json(response, 504, { error: "late timeout" }), 30_000);
    }

    const locationId = Number(body.location_id);
    const items = Array.isArray(body.items)
      ? (body.items as Array<Record<string, unknown>>)
      : [];
    const invalid = items.find((item) => {
      const stock = stocks.get(stockKey(locationId, Number(item.item_id)));
      return !stock || stock.onHand + Number(item.qty_in_base) < 0;
    });
    if (scenario === "insufficient-stock" || invalid) {
      return json(response, 500, {
        statusCode: "500",
        error: "Internal Server Error",
        message: "This transaction will cause the inventory Qty on the shelf to be minus.",
        code: "P9005",
      });
    }

    for (const item of items) {
      const stock = stocks.get(stockKey(locationId, Number(item.item_id)))!;
      stock.onHand += Number(item.qty_in_base);
    }
    const id = nextAdjustmentId++;
    adjustments.set(id, {
      id,
      number: `ADJ-${String(id).padStart(9, "0")}`,
      note: String(body.note || ""),
      locationId,
      transactionDate: String(body.transaction_date || new Date().toISOString()),
      items,
    });

    if (scenario === "timeout-after-apply") {
      return setTimeout(() => json(response, 200, { status: "ok", id }), 30_000);
    }
    if (scenario === "malformed-success") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, { status: "ok", id });
  }

  if (method === "GET" && url.pathname === "/inventory/adjustments/") {
    const data = [...adjustments.values()].reverse().map((adjustment) => ({
      item_adj_id: adjustment.id,
      item_adj_no: adjustment.number,
      transaction_date: adjustment.transactionDate,
      created_date: adjustment.transactionDate,
      note: adjustment.note,
      location_id: adjustment.locationId,
      location_name: `Mock location ${adjustment.locationId}`,
      is_opening_balance: false,
      is_warehouse: true,
      is_from_opname: false,
      adjustment_type: null,
      created_by: "mock@jubelio.local",
    }));
    return json(response, 200, { data, totalCount: data.length });
  }

  const adjustmentDetail = url.pathname.match(/^\/inventory\/adjustments\/(\d+)$/);
  if (method === "GET" && adjustmentDetail) {
    const adjustment = adjustments.get(Number(adjustmentDetail[1]));
    if (!adjustment) return json(response, 404, { error: "Not Found" });
    return json(response, 200, {
      item_adj_id: adjustment.id,
      item_adj_no: adjustment.number,
      transaction_date: adjustment.transactionDate,
      note: adjustment.note,
      location_id: adjustment.locationId,
      items: adjustment.items,
    });
  }

  if (method === "POST" && url.pathname === "/inventory/items/all-stocks/") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    const data = ids.map((itemId) => ({
      item_id: itemId,
      item_code: `MOCK-${itemId}`,
      item_group_id: Math.floor(itemId / 10),
      location_stocks: [...stocks.values()]
        .filter((stock) => stock.itemId === itemId)
        .map((stock) => ({
          location_id: stock.locationId,
          on_hand: stock.onHand,
          on_order: stock.onOrder,
          reserved: stock.reserved,
          available: availableStock(stock),
        })),
    }));
    const locations = [...new Set([...stocks.values()].filter((stock) => ids.includes(stock.itemId)).map((stock) => stock.locationId))]
      .map((locationId) => ({ location_id: locationId, location_name: `Mock location ${locationId}` }));
    return json(response, 200, { locations, data });
  }

  return json(response, 404, { error: "Not Found", path: url.pathname });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.JUBELIO_MOCK_PORT || 3002);
  const host = process.env.JUBELIO_MOCK_HOST || "127.0.0.1";
  jubelioMockServer.listen(port, host, () => {
    console.log(`jubelio-mock listening on http://${host}:${port}`);
  });
}
