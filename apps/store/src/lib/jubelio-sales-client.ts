import {
  JubelioRequestQueueError,
  getSharedJubelioRequestScheduler,
  type JubelioRequestScheduler,
} from "./jubelio-request-scheduler";
import { createLogger, serializeError, type Logger } from "./logger";

/**
 * Jubelio Sales Order HTTP gateway (create / read / cancel only).
 *
 * Safety contract (plan: jubelio-sales-api-switching, canary 2026-09-23):
 * - Every POST runs exactly once. The gateway never automatically repeats a
 *   POST, including on 401/429 responses or token expiry.
 * - A 500 response, a timeout/network failure, or a malformed create id is
 *   reported as AMBIGUOUS: the write may still have been applied remotely.
 *   Pre-send failures (missing credentials, login failure, queue rejection,
 *   invalid input) never reach the POST, so they are always NON-ambiguous.
 * - Create input is validated before anything is sent: items non-empty,
 *   integer positive quantity/item id/location, finite nonnegative money
 *   fields. Nonzero discount/tax is fail-closed (rejected) until the money
 *   formula is evidenced: the live canary (2026-09-23) evidences only the
 *   zero-disc/zero-tax envelope.
 * - The create id is only trusted after an independent
 *   `GET /sales/orders/{id}` confirms the requested location, contact,
 *   items, item prices/amounts and header totals. There is no
 *   `GET /sales/orders/?q=note` fallback — it is not
 *   documented and would be an unverified recovery path.
 * - Cancel is pre-invoice only, confirmed by a GET of `is_canceled`.
 * - Invoice/payment operations are out of scope for this module.
 * - Runtime selection (`resolveJubelioSalesRuntime`): an explicit E2E-only
 *   loopback seam supports mock tests. Otherwise disabled outside production and fails
 *   closed at construction; real Jubelio traffic requires either the
 *   production write gate or the explicit, default-OFF
 *   `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true` opt-in with a pinned
 *   `https://api2.jubelio.com` base URL and real test-account credentials.
 */

export type JubelioSalesEnvironment = Partial<
  Record<
    | "NODE_ENV"
    | "APP_ENV"
    | "JUBELIO_API_BASE_URL"
    | "E2E_PROVIDER_MOCKS"
    | "JUBELIO_SALES_MOCK_API_BASE_URL"
    | "JUBELIO_STOCK_WRITES_ENABLED"
    | "JUBELIO_SALES_TEST_ACCOUNT_ENABLED"
    | "JUBELIO_EMAIL"
    | "JUBELIO_PASSWORD"
    | "JUBELIO_STOCK_TIMEOUT_MS"
    | "JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE"
    | "JUBELIO_STOCK_CONCURRENCY"
    | "JUBELIO_STOCK_MAX_QUEUED"
    | "JUBELIO_STOCK_QUEUE_TIMEOUT_MS",
    string
  >
>;

export type JubelioSalesRuntime = {
  /** Mock is restricted to an explicit non-production loopback E2E seam. */
  mode: "live" | "mock";
  baseUrl: string;
  /**
   * How live mode was authorized: the unchanged production write gate, or
   * the explicit default-OFF test-account opt-in.
   */
  liveSource: "production" | "test-account" | "e2e-mock";
};

export type JubelioSalesOrderItemInput = {
  itemId: number;
  quantity: number;
  price: number;
  discAmount: number;
  taxAmount: number;
  unit: string;
  taxId: number;
};

export type JubelioSalesOrderCreateInput = {
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  refNo?: string;
  channelStatus?: "Belum Bayar";
  transactionDate?: Date;
  items: JubelioSalesOrderItemInput[];
};

export type JubelioSalesOrderItem = {
  itemId: number;
  quantity: number;
  price: number;
  amount: number;
  unit: string;
};

/** One SO item line as needed for a full-payload edit (detail id REQUIRED). */
export type JubelioSalesOrderEditLine = {
  salesorderDetailId: number;
  itemId: number;
  quantity: number;
  price: number;
  disc: number;
  discAmount: number;
  taxAmount: number;
  amount: number;
  unit: string;
  taxId: number;
  locationId: number;
};

/**
 * Strict pre-edit read of `GET /sales/orders/{id}`: every field the documented
 * `saveSalesOrderRequest` requires (and the store's evidenced zero-disc/zero-tax
 * envelope) parsed and validated. A snapshot that fails these invariants must
 * NEVER be turned into an edit POST — the caller records an investigation case
 * instead.
 */
export type JubelioSalesOrderEditSnapshot = {
  salesorderId: number;
  salesorderNo: string;
  source: number;
  refNo: string;
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  transactionDate: string;
  isTaxIncluded: boolean;
  isCanceled: boolean;
  invoiceId: number | null;
  channelStatus: string | null;
  subTotal: number;
  totalDisc: number;
  totalTax: number;
  grandTotal: number;
  addFee: number;
  addDisc: number;
  serviceFee: number;
  items: JubelioSalesOrderEditLine[];
};

export type JubelioSalesEditResult = {
  salesOrderId: number;
  /** Independent post-edit GET confirmation. */
  order: JubelioSalesOrderEditSnapshot;
};

export type JubelioSalesOrderSnapshot = {
  salesorderId: number;
  salesorderNo: string;
  source: number;
  refNo: string;
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  isCanceled: boolean;
  invoiceId: number | null;
  channelStatus: string | null;
  subTotal: number;
  totalDisc: number;
  totalTax: number;
  grandTotal: number;
  items: JubelioSalesOrderItem[];
};

export type JubelioSalesCreateResult = {
  salesOrderId: number;
  order: JubelioSalesOrderSnapshot;
};

export type JubelioSalesCancelResult = {
  salesOrderId: number;
  alreadyCanceled: boolean;
  order: JubelioSalesOrderSnapshot;
};

export type JubelioInvoiceItem = {
  itemId: number;
  quantity: number;
  price: number;
  amount: number;
  unit: string;
};

/**
 * Normalized `GET /sales/invoices/{id}` snapshot. Field presence varies by
 * runtime shape; every field the settlement depends on is parsed strictly
 * (malformed → error) while optional identifiers degrade to null.
 */
export type JubelioInvoiceSnapshot = {
  invoiceId: number;
  invoiceNo: string;
  salesorderId: number | null;
  contactId: number | null;
  locationId: number | null;
  subTotal: number;
  totalDisc: number;
  totalTax: number;
  grandTotal: number;
  isCanceled: boolean;
  items: JubelioInvoiceItem[];
};

export type JubelioPaymentSnapshot = {
  paymentId: number;
  invoiceId: number | null;
  contactId: number | null;
  amount: number;
  invoices: { invoiceId: number; paymentAmount: number; salesorderId: number | null }[];
};

export type JubelioInvoiceCreateResult = {
  invoiceId: number;
  invoice: JubelioInvoiceSnapshot;
};

export type JubelioPaymentCreateResult = {
  paymentId: number;
  payment: JubelioPaymentSnapshot;
};

export class JubelioSalesGatewayError extends Error {
  constructor(
    message: string,
    public readonly options: {
      code?: string;
      httpStatus?: number;
      ambiguous: boolean;
      retryable: boolean;
    }
  ) {
    super(message);
    this.name = "JubelioSalesGatewayError";
  }
}

const JUBELIO_LIVE_ORIGIN = "https://api2.jubelio.com";

function pinLiveSalesBaseUrl(configuredUrl: string): string {
  const baseUrl = configuredUrl.replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      "Live Jubelio sales traffic requires the bare origin https://api2.jubelio.com (no credentials, port, path, query or hash)"
    );
  }
  if (
    url.origin !== JUBELIO_LIVE_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Live Jubelio sales traffic requires the bare origin https://api2.jubelio.com (no credentials, port, path, query or hash)"
    );
  }
  return baseUrl;
}

/**
 * Sales-specific runtime resolution with an explicit loopback-only E2E seam.
 * Without that seam, outside production the
 * gateway is disabled by default and fails closed at construction: real
 * Jubelio traffic requires either the unchanged production write gate or the
 * explicit, exact, default-OFF `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true`
 * opt-in with a pinned `https://api2.jubelio.com` base URL. The gateway never
 * falls back to the local mock or picks a live host implicitly.
 */
export function resolveJubelioSalesRuntime(
  env: JubelioSalesEnvironment
): JubelioSalesRuntime {
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? "development";
  if (env.E2E_PROVIDER_MOCKS === "true") {
    if (appEnv === "production" || env.NODE_ENV === "production") {
      throw new Error("E2E provider mocks are forbidden in production");
    }
    let url: URL;
    try {
      url = new URL(env.JUBELIO_SALES_MOCK_API_BASE_URL ?? "");
    } catch {
      throw new Error("E2E sales mock requires a bare HTTP loopback origin");
    }
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("E2E sales mock requires a bare HTTP loopback origin");
    }
    return { mode: "mock", baseUrl: url.origin, liveSource: "e2e-mock" };
  }
  if (appEnv === "production" && env.NODE_ENV === "production") {
    if (env.JUBELIO_STOCK_WRITES_ENABLED !== "true") {
      throw new Error(
        "Production Jubelio sales writes require JUBELIO_STOCK_WRITES_ENABLED=true"
      );
    }
    if (!env.JUBELIO_API_BASE_URL?.trim()) {
      throw new Error(
        "Production Jubelio sales writes require an explicit JUBELIO_API_BASE_URL (https://api2.jubelio.com)"
      );
    }
    return {
      mode: "live",
      baseUrl: pinLiveSalesBaseUrl(env.JUBELIO_API_BASE_URL),
      liveSource: "production",
    };
  }
  if (env.JUBELIO_SALES_TEST_ACCOUNT_ENABLED !== "true") {
    throw new Error(
      "Jubelio sales gateway is disabled by default: live sales traffic outside production requires JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true with a pinned JUBELIO_API_BASE_URL (https://api2.jubelio.com); the local mock is not supported"
    );
  }
  if (!env.JUBELIO_API_BASE_URL?.trim()) {
    throw new Error(
      "Jubelio sales test-account opt-in requires JUBELIO_API_BASE_URL (https://api2.jubelio.com)"
    );
  }
  return {
    mode: "live",
    baseUrl: pinLiveSalesBaseUrl(env.JUBELIO_API_BASE_URL),
    liveSource: "test-account",
  };
}

/**
 * Runtime validation applied before anything is serialized or sent.
 * NaN/Infinity would serialize to JSON `null` and empty item lists would
 * silently create an empty order — all of it after a live POST — so every
 * create input is rejected here, unambiguously, before the POST.
 *
 * MONEY SAFETY: the only evidenced money shape is `discAmount = 0 ∧
 * taxAmount = 0` (canary T0–T2: `amount = price × quantity`). The ±disc/±tax
 * formula is NOT proven; any nonzero tax/discount fails closed until
 * sandbox evidence exists. This is not a claim that the formula is proven.
 */
function assertValidCreateInput(input: {
  contactId: number;
  customerName: string;
  note: string;
  locationId: number;
  items: JubelioSalesOrderItemInput[];
}): void {
  // The verified generic customer has contact_id -1; zero and unsafe IDs are invalid.
  if (!Number.isSafeInteger(input.contactId) || input.contactId === 0) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order input is invalid: contact id must be a nonzero integer",
      { ambiguous: false, retryable: false }
    );
  }
  if (typeof input.customerName !== "string" || !input.customerName.trim()) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order input is invalid: customer name is required",
      { ambiguous: false, retryable: false }
    );
  }
  if (typeof input.note !== "string" || !input.note.trim()) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order input is invalid: a unique operation note is required",
      { ambiguous: false, retryable: false }
    );
  }
  if (!Number.isInteger(input.locationId) || input.locationId <= 0) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order input is invalid: location id must be a positive integer",
      { ambiguous: false, retryable: false }
    );
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order input is invalid: at least one item is required",
      { ambiguous: false, retryable: false }
    );
  }
  const itemIds = new Set<number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.itemId) || item.itemId <= 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item id must be a positive integer",
        { ambiguous: false, retryable: false }
      );
    }
    if (itemIds.has(item.itemId)) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: duplicate item id",
        { ambiguous: false, retryable: false }
      );
    }
    itemIds.add(item.itemId);
    if (!Number.isInteger(item.taxId) || item.taxId < 1) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: tax id must reference a real tax record (a zero id fails the provider FK)",
        { ambiguous: false, retryable: false }
      );
    }
    if (typeof item.unit !== "string" || !item.unit.trim()) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item unit is required",
        { ambiguous: false, retryable: false }
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item quantity must be a positive integer",
        { ambiguous: false, retryable: false }
      );
    }
    if (!Number.isFinite(item.price) || item.price < 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item price must be a finite nonnegative number",
        { ambiguous: false, retryable: false }
      );
    }
    if (!Number.isFinite(item.discAmount) || item.discAmount < 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item discount amount must be a finite nonnegative number",
        { ambiguous: false, retryable: false }
      );
    }
    if (!Number.isFinite(item.taxAmount) || item.taxAmount < 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: item tax amount must be a finite nonnegative number",
        { ambiguous: false, retryable: false }
      );
    }
    if (item.discAmount !== 0 || item.taxAmount !== 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order with nonzero discount or tax amount is rejected: the money formula is not yet evidenced (the live canary evidences only zero tax and zero discount)",
        { ambiguous: false, retryable: false }
      );
    }
  }
}

/**
 * Pure payload builder for `POST /sales/orders/` (`saveSalesOrderRequest`).
 * Rejects invalid input (including any nonzero tax/discount — see
 * `assertValidCreateInput`) before producing anything serializable.
 * Creation only: `salesorder_id` 0 and `salesorder_no` "[auto]" per the
 * documented schema and the canary. `source` 1 = Internal. `disc` (the
 * percentage field) is left at 0. Within the evidenced envelope
 * (disc = 0, tax = 0) the item `amount` and header totals reduce to
 * `price × quantity`, which is what the canary verified.
 */
export function buildSalesOrderPayload(input: {
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  refNo?: string;
  channelStatus?: "Belum Bayar";
  transactionDate?: Date;
  items: JubelioSalesOrderItemInput[];
}): Record<string, unknown> {
  assertValidCreateInput(input);
  const lines = input.items.map((item) => {
    const gross = item.price * item.quantity;
    const amount = gross - item.discAmount + item.taxAmount;
    return {
      salesorder_detail_id: 0,
      item_id: item.itemId,
      qty_in_base: item.quantity,
      price: item.price,
      disc: 0,
      disc_amount: item.discAmount,
      tax_amount: item.taxAmount,
      amount,
      unit: item.unit,
      tax_id: item.taxId,
      location_id: input.locationId,
    };
  });
  const subTotal = input.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const totalDisc = input.items.reduce((sum, item) => sum + item.discAmount, 0);
  const totalTax = input.items.reduce((sum, item) => sum + item.taxAmount, 0);
  return {
    salesorder_id: 0,
    salesorder_no: "[auto]",
    contact_id: input.contactId,
    customer_name: input.customerName,
    transaction_date: (input.transactionDate ?? new Date()).toISOString(),
    is_tax_included: false,
    note: input.note,
    ref_no: input.refNo ?? "",
    location_id: input.locationId,
    source: 1,
    ...(input.channelStatus ? { channel_status: input.channelStatus } : {}),
    sub_total: subTotal,
    total_disc: totalDisc,
    total_tax: totalTax,
    grand_total: subTotal - totalDisc + totalTax,
    add_fee: 0,
    add_disc: 0,
    service_fee: 0,
    items: lines,
  };
}

/**
 * Full-payload edit builder for `POST /sales/orders/` with
 * `salesorder_id` != 0 (ticket #03). Built ONLY from the verified pre-edit
 * GET snapshot: the SO id, SO number, detail ids, identity, source, location,
 * items and money are preserved verbatim; the ONLY intended change is
 * `channel_status`. Every fail-closed rule is re-asserted here so an unsafe
 * snapshot can never reach the wire:
 * - the SO must be active and INTERNAL (`source` 1) with a real SO number,
 * - every item line must carry a positive `salesorder_detail_id` (no `[auto]`/0
 *   rewrite of detail identities),
 * - the evidenced money envelope is zero discount/zero tax/zero fees with
 *   `amount = price × qty` (the one-shot edit evidence, SO 68399); anything
 *   else risks rewriting financial attributes → zero POST.
 */
export function buildSalesOrderEditPayload(
  edit: JubelioSalesOrderEditSnapshot,
  targetChannelStatus: string
): Record<string, unknown> {
  if (
    !Number.isSafeInteger(edit.salesorderId) ||
    edit.salesorderId <= 0 ||
    typeof edit.salesorderNo !== "string" ||
    !edit.salesorderNo.trim() ||
    edit.salesorderNo === "[auto]"
  ) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order edit requires a confirmed order with a real sales order number",
      { code: "EDIT_SHAPE_INCOMPLETE", ambiguous: false, retryable: false }
    );
  }
  if (edit.isCanceled) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order edit refused: the order is canceled",
      { code: "EDIT_SO_CANCELED", ambiguous: false, retryable: false }
    );
  }
  if (edit.source !== 1) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order edit refused: source ${edit.source} is not INTERNAL`,
      { code: "EDIT_SOURCE_NOT_INTERNAL", ambiguous: false, retryable: false }
    );
  }
  if (
    typeof targetChannelStatus !== "string" ||
    !targetChannelStatus.trim()
  ) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order edit requires a target channel status marker",
      { code: "EDIT_TARGET_INVALID", ambiguous: false, retryable: false }
    );
  }
  if (!Array.isArray(edit.items) || edit.items.length === 0) {
    throw new JubelioSalesGatewayError(
      "Jubelio sales order edit requires at least one item line",
      { code: "EDIT_SHAPE_INCOMPLETE", ambiguous: false, retryable: false }
    );
  }
  for (const line of edit.items) {
    if (
      !Number.isSafeInteger(line.salesorderDetailId) ||
      line.salesorderDetailId <= 0
    ) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order edit requires a positive sales order detail id for every item line (rewriting detail ids is forbidden)",
        { code: "EDIT_SHAPE_INCOMPLETE", ambiguous: false, retryable: false }
      );
    }
  }
  assertEditableMoneyEnvelope(edit);
  return {
    salesorder_id: edit.salesorderId,
    salesorder_no: edit.salesorderNo,
    contact_id: edit.contactId,
    customer_name: edit.customerName,
    transaction_date: edit.transactionDate,
    is_tax_included: edit.isTaxIncluded,
    note: edit.note,
    ref_no: edit.refNo,
    location_id: edit.locationId,
    source: edit.source,
    channel_status: targetChannelStatus,
    sub_total: edit.subTotal,
    total_disc: edit.totalDisc,
    total_tax: edit.totalTax,
    grand_total: edit.grandTotal,
    add_fee: edit.addFee,
    add_disc: edit.addDisc,
    service_fee: edit.serviceFee,
    items: edit.items.map((line) => ({
      salesorder_detail_id: line.salesorderDetailId,
      item_id: line.itemId,
      qty_in_base: line.quantity,
      price: line.price,
      disc: line.disc,
      disc_amount: line.discAmount,
      tax_amount: line.taxAmount,
      amount: line.amount,
      unit: line.unit,
      tax_id: line.taxId,
      location_id: line.locationId,
    })),
  };
}

/**
 * MONEY SAFETY for edits: only the zero-disc/zero-tax/zero-fee envelope is
 * evidenced (one-shot edit evidence, SO 68399, 2026-09-26). Anything else
 * could silently rewrite financial attributes — refuse before serializing.
 */
function assertEditableMoneyEnvelope(edit: {
  subTotal: number;
  totalDisc: number;
  totalTax: number;
  grandTotal: number;
  addFee: number;
  addDisc: number;
  serviceFee: number;
  items: Array<{
    quantity: number;
    price: number;
    disc: number;
    discAmount: number;
    taxAmount: number;
    amount: number;
    itemId: number;
  }>;
}): void {
  const envelopeViolations: string[] = [];
  for (const line of edit.items) {
    if (line.disc !== 0 || line.discAmount !== 0 || line.taxAmount !== 0) {
      envelopeViolations.push(`item ${line.itemId} carries a nonzero discount or tax amount`);
    }
    const expected = line.price * line.quantity;
    if (!moneyEqualsSafe(line.amount, expected)) {
      envelopeViolations.push(
        `item ${line.itemId} amount ${line.amount} does not equal price × quantity (${expected})`
      );
    }
  }
  const expectedSubTotal = edit.items.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0
  );
  if (edit.totalDisc !== 0 || edit.totalTax !== 0) {
    envelopeViolations.push("header carries a nonzero discount or tax total");
  }
  if (edit.addFee !== 0 || edit.addDisc !== 0 || edit.serviceFee !== 0) {
    envelopeViolations.push("header carries a nonzero fee/discount field");
  }
  if (!moneyEqualsSafe(edit.subTotal, expectedSubTotal)) {
    envelopeViolations.push(
      `sub_total ${edit.subTotal} does not equal the item lines (${expectedSubTotal})`
    );
  }
  if (!moneyEqualsSafe(edit.grandTotal, expectedSubTotal)) {
    envelopeViolations.push(
      `grand_total ${edit.grandTotal} does not equal sub_total ${expectedSubTotal}`
    );
  }
  if (envelopeViolations.length > 0) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order edit refused: the money envelope is not evidenced (zero disc/tax only) — ${envelopeViolations.join("; ")}`,
      { code: "EDIT_ENVELOPE_UNEVIDENCED", ambiguous: false, retryable: false }
    );
  }
}

/**
 * Module-level money comparison (closure `moneyEquals` is inside the
 * factory). Shared with the mirror pre-read cross-check so every money
 * comparison uses the exact same safe epsilon (serialization noise tolerated,
 * material changes never).
 */
export function moneyEqualsSafe(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.min(0.0001, 1e-6 * scale);
}

export type JubelioSalesGateway = {
  createSalesOrder(
    input: JubelioSalesOrderCreateInput & { operationId?: string }
  ): Promise<JubelioSalesCreateResult>;
  getSalesOrder(salesOrderId: number): Promise<JubelioSalesOrderSnapshot>;
  /**
   * Strict edit pre-read (ticket #03): parses every documented
   * `saveSalesOrderRequest` field plus the item detail ids and fee fields,
   * fail-closed on any shape that must never become an edit POST.
   */
  getSalesOrderForEdit(
    salesOrderId: number
  ): Promise<JubelioSalesOrderEditSnapshot>;
  /**
   * Full-payload channel-status edit (at most one POST). Built ONLY from the
   * verified pre-edit snapshot; confirmed by an independent GET. Never
   * re-POSTed on any ambiguous outcome.
   */
  editSalesOrder(input: {
    edit: JubelioSalesOrderEditSnapshot;
    targetChannelStatus: string;
    operationId?: string;
  }): Promise<JubelioSalesEditResult>;
  cancelSalesOrder(input: {
    salesOrderId: number;
    operationId?: string;
  }): Promise<JubelioSalesCancelResult>;
  /** Path 1 only: convert a confirmed SO to an invoice, then verify it. */
  createInvoice(input: {
    salesOrderId: number;
    operationId?: string;
  }): Promise<JubelioInvoiceCreateResult>;
  getInvoice(invoiceId: number): Promise<JubelioInvoiceSnapshot>;
  /**
   * At-most-once invoice payment. Only callable with a VERIFIED invoice id;
   * the payment is confirmed via an independent GET of the returned id.
   */
  createInvoicePayment(input: {
    payment: {
      invoiceId: number;
      accountId: number;
      amount: number;
      contactId: number;
      contactName?: string;
      /** Runtime: a NUMBER (sandbox 2026-09-24, 0 = cash/other). */
      paymentType: number;
      note?: string;
    };
    operationId?: string;
  }): Promise<JubelioPaymentCreateResult>;
  getPayment(paymentId: number): Promise<JubelioPaymentSnapshot>;
};

/**
 * These knobs are the shared, provider-level Jubelio backpressure settings
 * already used by the stock gateway. Sharing them (and the shared scheduler
 * keyed by base URL) keeps one backpressure profile for all Jubelio traffic.
 */
export function createJubelioSalesGateway(options: {
  env?: JubelioSalesEnvironment;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  scheduler?: JubelioRequestScheduler;
} = {}): JubelioSalesGateway {
  const env = options.env ?? process.env;
  const runtime: JubelioSalesRuntime = resolveJubelioSalesRuntime(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const positiveNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const timeoutMs = Math.max(100, positiveNumber(env.JUBELIO_STOCK_TIMEOUT_MS, 8_000));
  const maxRequestsPerMinute = Math.min(
    600,
    positiveNumber(env.JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE, 450)
  );
  const maxConcurrent = positiveNumber(env.JUBELIO_STOCK_CONCURRENCY, 10);
  const maxQueued = positiveNumber(env.JUBELIO_STOCK_MAX_QUEUED, 1_000);
  const configuredQueueTimeoutMs = Math.max(
    1,
    positiveNumber(env.JUBELIO_STOCK_QUEUE_TIMEOUT_MS, 5_000)
  );
  // Queue expiry must happen before the HTTP timeout starts classifying a
  // potentially-sent write as ambiguous.
  const queueTimeoutMs = Math.min(
    configuredQueueTimeoutMs,
    Math.max(1, timeoutMs - 100)
  );
  const scheduler =
    options.scheduler ??
    (options.fetchImpl
      ? {
          schedule: <T>(task: () => Promise<T>) => task(),
          activeCount: 0,
          queuedCount: 0,
        }
      : getSharedJubelioRequestScheduler({
          key: runtime.baseUrl,
          maxConcurrent,
          maxRequestsPerMinute,
          maxQueued,
          queueTimeoutMs,
        }));
  const log = (options.logger ?? createLogger({ module: "jubelio-sales" })).child({
    service: "jubelio",
    runtime: `${runtime.mode}:${runtime.liveSource}`,
  });
  let token: string | null = null;
  let loginPromise: Promise<string> | null = null;

  async function parseBody(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { message: text };
    }
  }

  async function login(priority = 0): Promise<string> {
    // Live modes require real credentials. The E2E loopback mock accepts
    // placeholders, but credentials must still be supplied explicitly.
    const email = env.JUBELIO_EMAIL;
    const password = env.JUBELIO_PASSWORD;
    if (!email || !password) {
      throw new JubelioSalesGatewayError(
        "Jubelio credentials are not configured",
        { ambiguous: false, retryable: false }
      );
    }
    const path = "/login";
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(timeoutMs),
    };
    log.info("Jubelio HTTP request started", {
      method: "POST",
      path,
      credentialsConfigured: true,
    });
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, init),
        { priority }
      );
    } catch (error) {
      log.error("Jubelio HTTP request failed", {
        method: "POST",
        path,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
      throw error;
    }
    const body = await parseBody(response);
    log.info("Jubelio HTTP response received", {
      method: "POST",
      path,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      authResponse: true,
    });
    if (!response.ok || typeof body.token !== "string") {
      throw new JubelioSalesGatewayError("Jubelio login failed", {
        httpStatus: response.status,
        ambiguous: false,
        retryable: response.status >= 500,
      });
    }
    token = body.token;
    return token;
  }

  async function getAuthToken(priority = 0): Promise<string> {
    if (token) return token;
    if (!loginPromise) {
      loginPromise = login(priority).finally(() => {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  async function authenticatedFetch(
    path: string,
    init: RequestInit,
    priority: number,
    reloginOn401: boolean
  ): Promise<Response> {
    const authToken = await getAuthToken(priority);
    const requestInit: RequestInit = {
      ...init,
      headers: {
        authorization: authToken,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    };
    log.info("Jubelio HTTP request started", {
      method: requestInit.method ?? "GET",
      path,
    });
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, requestInit),
        { priority }
      );
    } catch (error) {
      log.error("Jubelio HTTP request failed", {
        method: requestInit.method ?? "GET",
        path,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
      throw error;
    }
    log.info("Jubelio HTTP response received", {
      method: requestInit.method ?? "GET",
      path,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    });
    if (response.status === 401 && reloginOn401) {
      if (token === authToken) token = null;
      await getAuthToken(priority);
      return authenticatedFetch(path, init, priority, false);
    }
    return response;
  }

  /** Single GET request; reads may safely re-authenticate and repeat on 401. */
  async function readJson(
    path: string,
    priority: number
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await authenticatedFetch(path, { method: "GET" }, priority, true);
    } catch (error) {
      throw new JubelioSalesGatewayError(
        error instanceof Error ? error.message : "Jubelio request failed",
        { ambiguous: false, retryable: true }
      );
    }
    const body = await parseBody(response);
    log.info("Jubelio HTTP response output", {
      method: "GET",
      path,
      status: response.status,
      // Never log provider bodies: they contain customer PII.
    });
    if (!response.ok) {
      throw new JubelioSalesGatewayError(
        `Jubelio request failed (${response.status})`,
        {
          code: typeof body.code === "string" ? body.code : undefined,
          httpStatus: response.status,
          ambiguous: false,
          retryable: response.status === 429 || response.status >= 500,
        }
      );
    }
    return body;
  }

  /**
   * Executes exactly one authenticated POST. Never re-authenticates into a
   * repeat: a 401 mid-write is surfaced instead of retried.
   */
  async function postOnce(input: {
    path: string;
    body: unknown;
    priority: number;
    context?: Record<string, unknown>;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    // Pre-send authentication happens OUTSIDE the ambiguity-wrapped request:
    // an auth/config/login failure means the write was never attempted, so
    // it must never be classified as ambiguous.
    try {
      await getAuthToken(input.priority);
    } catch (error) {
      const context = {
        method: "POST" as const,
        path: input.path,
        error: serializeError(error),
        ...input.context,
      };
      if (error instanceof JubelioSalesGatewayError) {
        log.error("Jubelio sales write not attempted", context);
        throw error;
      }
      if (error instanceof JubelioRequestQueueError) {
        // The request never left the process boundary — not ambiguous.
        log.error("Jubelio sales write not attempted", context);
        throw new JubelioSalesGatewayError(error.message, {
          code: error.code,
          ambiguous: false,
          retryable: true,
        });
      }
      log.error("Jubelio sales write not attempted", context);
      throw new JubelioSalesGatewayError(
        error instanceof Error ? error.message : "Jubelio write not attempted",
        { ambiguous: false, retryable: true }
      );
    }
    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify(input.body),
    };
    log.info("Jubelio HTTP request started", {
      method: "POST",
      path: input.path,
      // Never log request payloads: Sales Orders include customer PII.
      ...input.context,
    });
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await authenticatedFetch(input.path, init, input.priority, false);
    } catch (error) {
      if (error instanceof JubelioRequestQueueError) {
        // The request never left the process boundary — not ambiguous.
        throw new JubelioSalesGatewayError(error.message, {
          code: error.code,
          ambiguous: false,
          retryable: true,
        });
      }
      log.error("Jubelio sales write outcome unknown", {
        method: "POST",
        path: input.path,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
        ...input.context,
      });
      throw new JubelioSalesGatewayError(
        error instanceof Error ? error.message : "Jubelio write timed out",
        { ambiguous: true, retryable: false }
      );
    }
    // P1-A: the response has already been delivered, so the write may have
    // been applied; a failing body read of that response must stay ambiguous
    // (never retried) instead of surfacing as a non-ambiguous network error.
    let body: Record<string, unknown>;
    try {
      body = await parseBody(response);
    } catch (error) {
      log.error("Jubelio sales write outcome unknown", {
        method: "POST",
        path: input.path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
        ...input.context,
      });
      throw new JubelioSalesGatewayError(
        "Jubelio sales write response body could not be read; the write outcome is unknown",
        { ambiguous: true, retryable: false }
      );
    }
    log.info("Jubelio HTTP response output", {
      method: "POST",
      path: input.path,
      status: response.status,
      ...input.context,
    });
    return { status: response.status, body };
  }

  function writeRejection(input: {
    path: string;
    status: number;
    body: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): JubelioSalesGatewayError {
    // 500+: the write may or may not have been applied → ambiguous.
    // 429: throttled before processing; deliberately retryable later, but the
    // gateway itself never repeats a POST.
    // 400/401/403/404/409: the provider rejected the request before applying.
    const ambiguous = input.status >= 500;
    if (ambiguous) {
      log.error("Jubelio sales write outcome unknown", {
        method: "POST",
        path: input.path,
        status: input.status,
        ...input.context,
      });
    }
    return new JubelioSalesGatewayError(
      `Jubelio sales write failed (${input.status})`,
      // Provider error text may contain customer PII; expose only code/status.
      {
        code: typeof input.body.code === "string" ? input.body.code : undefined,
        httpStatus: input.status,
        ambiguous,
        retryable: input.status === 429,
      }
    );
  }

  function parsePositiveId(body: Record<string, unknown>): number {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order response has no positive id",
        { httpStatus: 200, ambiguous: true, retryable: false }
      );
    }
    return id;
  }

  function parseSnapshot(
    id: number,
    body: Record<string, unknown>
  ): JubelioSalesOrderSnapshot {
    const salesorderId = Number(body.salesorder_id);
    const contactId = Number(body.contact_id);
    const locationId = Number(body.location_id);
    const source = Number(body.source);
    const rawItems = Array.isArray(body.items) ? body.items : null;
    if (
      !Number.isInteger(salesorderId) ||
      salesorderId !== id ||
      !Number.isInteger(contactId) ||
      !Number.isInteger(locationId) ||
      !Number.isInteger(source) ||
      !rawItems
    ) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order response is invalid",
        { httpStatus: 200, ambiguous: false, retryable: true }
      );
    }
    // Runtime shape (sandbox 2026-09-24): `is_canceled` is null (not false)
    // for active orders; only `true` means canceled.
    const isCanceled = body.is_canceled === true;
    const invoiceId =
      body.invoice_id === null || body.invoice_id === undefined
        ? null
        : Number(body.invoice_id);
    const subTotal = Number(body.sub_total);
    const totalDisc = Number(body.total_disc);
    const totalTax = Number(body.total_tax);
    const grandTotal = Number(body.grand_total);
    if (
      !Number.isFinite(subTotal) ||
      !Number.isFinite(totalDisc) ||
      !Number.isFinite(totalTax) ||
      !Number.isFinite(grandTotal)
    ) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order response is invalid: header totals are missing or not numeric",
        { httpStatus: 200, ambiguous: false, retryable: true }
      );
    }
    const items: JubelioSalesOrderItem[] = [];
    for (const raw of rawItems) {
      const row = raw as Record<string, unknown>;
      const itemId = Number(row.item_id);
      const quantity = Number(row.qty_in_base);
      const price = Number(row.price);
      const amount = Number(row.amount);
      const unit = typeof row.unit === "string" ? row.unit : "";
      if (
        !Number.isInteger(itemId) ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price) ||
        !Number.isFinite(amount) ||
        !unit
      ) {
        throw new JubelioSalesGatewayError(
          "Jubelio sales order item response is invalid",
          { httpStatus: 200, ambiguous: false, retryable: true }
        );
      }
      items.push({ itemId, quantity, price, amount, unit });
    }
    return {
      salesorderId,
      salesorderNo: typeof body.salesorder_no === "string" ? body.salesorder_no : "",
      source,
      refNo: typeof body.ref_no === "string" ? body.ref_no : "",
      contactId,
      customerName:
        typeof body.customer_name === "string" ? body.customer_name : "",
      locationId,
      note: typeof body.note === "string" ? body.note : "",
      isCanceled,
      invoiceId: invoiceId !== null && Number.isInteger(invoiceId) ? invoiceId : null,
      channelStatus: typeof body.channel_status === "string" ? body.channel_status : null,
      subTotal,
      totalDisc,
      totalTax,
      grandTotal,
      items,
    };
  }

  async function readSalesOrderSnapshot(
    salesOrderId: number,
    priority: number
  ): Promise<JubelioSalesOrderSnapshot> {
    const body = await readJson(`/sales/orders/${salesOrderId}`, priority);
    return parseSnapshot(salesOrderId, body);
  }

  /**
   * Strict edit pre-read parser (ticket #03). Fails closed — before any
   * edit POST can exist — when the response shape cannot rebuild the
   * documented full-payload edit envelope safely.
   */
  function parseSalesOrderEditSnapshot(
    id: number,
    body: Record<string, unknown>
  ): JubelioSalesOrderEditSnapshot {
    const salesorderId = Number(body.salesorder_id);
    const contactId = Number(body.contact_id);
    const locationId = Number(body.location_id);
    const source = Number(body.source);
    const rawItems = Array.isArray(body.items) ? body.items : null;
    const salesorderNo =
      typeof body.salesorder_no === "string" ? body.salesorder_no : "";
    const note = typeof body.note === "string" ? body.note : "";
    const transactionDate =
      typeof body.transaction_date === "string" ? body.transaction_date : "";
    const subTotal = optionalNumber(body, ["sub_total"]);
    const totalDisc = optionalNumber(body, ["total_disc"]);
    const totalTax = optionalNumber(body, ["total_tax"]);
    const grandTotal = optionalNumber(body, ["grand_total"]);
    const addFee = optionalNumber(body, ["add_fee"]);
    const addDisc = optionalNumber(body, ["add_disc"]);
    const serviceFee = optionalNumber(body, ["service_fee"]);
    if (
      !Number.isInteger(salesorderId) ||
      salesorderId !== id ||
      !salesorderNo.trim() ||
      salesorderNo === "[auto]" ||
      !Number.isInteger(contactId) ||
      !Number.isInteger(locationId) ||
      !Number.isInteger(source) ||
      source !== 1 ||
      !transactionDate.trim() ||
      subTotal === null ||
      totalDisc === null ||
      totalTax === null ||
      grandTotal === null ||
      addFee === null ||
      addDisc === null ||
      serviceFee === null ||
      !rawItems ||
      rawItems.length === 0
    ) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order edit pre-read is incomplete: the documented saveSalesOrderRequest fields are missing or the source is not INTERNAL",
        { code: "EDIT_SHAPE_INCOMPLETE", httpStatus: 200, ambiguous: false, retryable: false }
      );
    }
    if (body.is_canceled === true) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order edit pre-read refused: the order is canceled",
        { code: "EDIT_SO_CANCELED", httpStatus: 200, ambiguous: false, retryable: false }
      );
    }
    if (!note.trim()) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order edit pre-read is incomplete: the order note is required",
        { code: "EDIT_SHAPE_INCOMPLETE", httpStatus: 200, ambiguous: false, retryable: false }
      );
    }
    const items: JubelioSalesOrderEditLine[] = [];
    for (const raw of rawItems) {
      const row = raw as Record<string, unknown>;
      const salesorderDetailId = optionalNumber(row, ["salesorder_detail_id"]);
      const itemId = optionalNumber(row, ["item_id"]);
      const quantity = optionalNumber(row, ["qty_in_base"]);
      const price = optionalNumber(row, ["price"]);
      const amount = optionalNumber(row, ["amount"]);
      const disc = optionalNumber(row, ["disc"]);
      const discAmount = optionalNumber(row, ["disc_amount"]);
      const taxAmount = optionalNumber(row, ["tax_amount"]);
      const taxId = optionalNumber(row, ["tax_id"]);
      // Jubelio's sales-order GET returns item locations as `loc_id` (e.g.
      // SO 68400), while older fixtures/contracts may use `location_id`.
      const itemLocationId = optionalNumber(row, ["location_id", "loc_id"]);
      const unit = typeof row.unit === "string" ? row.unit : "";
      if (
        salesorderDetailId === null ||
        !Number.isSafeInteger(salesorderDetailId) ||
        salesorderDetailId <= 0 ||
        itemId === null ||
        !Number.isInteger(itemId) ||
        quantity === null ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        price === null ||
        !Number.isFinite(price) ||
        amount === null ||
        !Number.isFinite(amount) ||
        disc === null ||
        !Number.isFinite(disc) ||
        discAmount === null ||
        !Number.isFinite(discAmount) ||
        taxAmount === null ||
        !Number.isFinite(taxAmount) ||
        taxId === null ||
        !Number.isInteger(taxId) ||
        itemLocationId === null ||
        !Number.isInteger(itemLocationId) ||
        !unit
      ) {
        throw new JubelioSalesGatewayError(
          "Jubelio sales order edit pre-read is incomplete: an item line lacks its positive sales order detail id or usable item/price fields",
          { code: "EDIT_SHAPE_INCOMPLETE", httpStatus: 200, ambiguous: false, retryable: false }
        );
      }
      items.push({
        salesorderDetailId,
        itemId,
        quantity,
        price,
        disc,
        discAmount,
        taxAmount,
        amount,
        unit,
        taxId,
        locationId: itemLocationId,
      });
    }
    const snapshot: JubelioSalesOrderEditSnapshot = {
      salesorderId,
      salesorderNo,
      source,
      refNo: typeof body.ref_no === "string" ? body.ref_no : "",
      contactId,
      customerName:
        typeof body.customer_name === "string" ? body.customer_name : "",
      locationId,
      note,
      transactionDate,
      isTaxIncluded: body.is_tax_included === true,
      isCanceled: body.is_canceled === true,
      invoiceId:
        body.invoice_id === null || body.invoice_id === undefined
          ? null
          : Number(body.invoice_id),
      channelStatus: typeof body.channel_status === "string" ? body.channel_status : null,
      subTotal,
      totalDisc,
      totalTax,
      grandTotal,
      addFee,
      addDisc,
      serviceFee,
      items,
    };
    // Reuse the shared envelope rule so a GET showing nonzero disc/tax/fee
    // money fails closed exactly like the payload builder would.
    assertEditableMoneyEnvelope(snapshot);
    return snapshot;
  }

  /**
   * Post-edit confirmation: the target marker AND every core attribute must
   * be observable; any divergence is an ambiguous outcome (never success).
   */
  function editConfirmationMismatch(input: {
    requested: JubelioSalesOrderEditSnapshot;
    confirmed: JubelioSalesOrderEditSnapshot;
    targetChannelStatus: string;
  }): string | null {
    const confirmed = input.confirmed;
    if (confirmed.channelStatus !== input.targetChannelStatus) {
      return `confirmed channel status ${String(confirmed.channelStatus)} does not match the target ${input.targetChannelStatus}`;
    }
    if (confirmed.isCanceled || confirmed.salesorderNo !== input.requested.salesorderNo) {
      return "confirmed order number or cancel state differs from the requested edit";
    }
    if (
      confirmed.contactId !== input.requested.contactId ||
      confirmed.customerName !== input.requested.customerName ||
      confirmed.locationId !== input.requested.locationId ||
      confirmed.source !== input.requested.source ||
      confirmed.note !== input.requested.note ||
      confirmed.refNo !== input.requested.refNo ||
      confirmed.transactionDate !== input.requested.transactionDate ||
      confirmed.isTaxIncluded !== input.requested.isTaxIncluded
    ) {
      return "confirmed identity, location, note or transaction date differs from the requested edit";
    }
    if (
      (confirmed.invoiceId ?? null) !== (input.requested.invoiceId ?? null) ||
      !moneyEquals(confirmed.subTotal, input.requested.subTotal) ||
      !moneyEquals(confirmed.totalDisc, input.requested.totalDisc) ||
      !moneyEquals(confirmed.totalTax, input.requested.totalTax) ||
      !moneyEquals(confirmed.grandTotal, input.requested.grandTotal)
    ) {
      return "confirmed invoice link or money differs from the requested edit";
    }
    const requestedLines = [...input.requested.items].sort(
      (left, right) => left.itemId - right.itemId
    );
    const confirmedLines = [...confirmed.items].sort(
      (left, right) => left.itemId - right.itemId
    );
    if (confirmedLines.length !== requestedLines.length) {
      return "confirmed item lines differ from the requested edit";
    }
    for (let index = 0; index < requestedLines.length; index++) {
      const requested = requestedLines[index];
      const line = confirmedLines[index];
      if (
        line.salesorderDetailId !== requested.salesorderDetailId ||
        line.itemId !== requested.itemId ||
        line.quantity !== requested.quantity ||
        !moneyEquals(line.price, requested.price) ||
        !moneyEquals(line.amount, requested.amount) ||
        line.unit !== requested.unit
      ) {
        return "confirmed item lines differ from the requested edit";
      }
    }
    return null;
  }

  function confirmationMismatch(input: {
    requested: JubelioSalesOrderCreateInput;
    snapshot: JubelioSalesOrderSnapshot;
    salesOrderId: number;
  }): string | null {
    const snapshot = input.snapshot;
    if (snapshot.locationId !== input.requested.locationId) {
      return `confirmed location ${snapshot.locationId} does not match requested location ${input.requested.locationId}`;
    }
    if (snapshot.source !== 1 || snapshot.note !== input.requested.note || snapshot.refNo !== (input.requested.refNo ?? "")) {
      return "confirmed source or order reference differs from requested INTERNAL order";
    }
    if (snapshot.contactId !== input.requested.contactId) {
      return `confirmed contact ${snapshot.contactId} does not match requested contact ${input.requested.contactId}`;
    }
    if (snapshot.isCanceled || snapshot.invoiceId !== null) {
      return "confirmed order is already canceled or invoiced";
    }
    const requestedLines = [...input.requested.items].sort(
      (left, right) => left.itemId - right.itemId
    );
    const confirmedLines = [...snapshot.items].sort(
      (left, right) => left.itemId - right.itemId
    );
    if (confirmedLines.length !== requestedLines.length) {
      return `confirmed order has ${confirmedLines.length} item line(s), requested ${requestedLines.length}`;
    }
    for (let index = 0; index < requestedLines.length; index++) {
      const requested = requestedLines[index];
      const confirmed = confirmedLines[index];
      if (
        confirmed.itemId !== requested.itemId ||
        confirmed.quantity !== requested.quantity
      ) {
        return `confirmed item line (item ${confirmed.itemId} × ${confirmed.quantity}) does not match requested item ${requested.itemId} × ${requested.quantity}`;
      }
      // Money verification per line: the provider may have recalculated;
      // a diverging price or amount is never silently accepted as success.
      const requestedAmount =
        requested.price * requested.quantity -
        requested.discAmount +
        requested.taxAmount;
      if (confirmed.price !== requested.price) {
        return `confirmed item price ${confirmed.price} does not match requested price ${requested.price} for item ${requested.itemId}`;
      }
      if (confirmed.amount !== requestedAmount) {
        return `confirmed item amount ${confirmed.amount} does not match requested amount ${requestedAmount} for item ${requested.itemId}`;
      }
    }
    const requestedSubTotal = input.requested.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const requestedTotalDisc = input.requested.items.reduce(
      (sum, item) => sum + item.discAmount,
      0
    );
    const requestedTotalTax = input.requested.items.reduce(
      (sum, item) => sum + item.taxAmount,
      0
    );
    const requestedGrandTotal =
      requestedSubTotal - requestedTotalDisc + requestedTotalTax;
    if (snapshot.subTotal !== requestedSubTotal) {
      return `confirmed sub total ${snapshot.subTotal} does not match requested sub total ${requestedSubTotal}`;
    }
    if (snapshot.totalDisc !== requestedTotalDisc) {
      return `confirmed total discount ${snapshot.totalDisc} does not match requested total discount ${requestedTotalDisc}`;
    }
    if (snapshot.totalTax !== requestedTotalTax) {
      return `confirmed total tax ${snapshot.totalTax} does not match requested total tax ${requestedTotalTax}`;
    }
    if (snapshot.grandTotal !== requestedGrandTotal) {
      return `confirmed grand total ${snapshot.grandTotal} does not match requested grand total ${requestedGrandTotal}`;
    }
    return null;
  }

  /**
   * Tolerant money normalization: provider money may arrive as number or
   * decimal string. Comparison allows a tiny float epsilon (serialization
   * noise) but any real mismatch fails closed (returns false).
   */
  function moneyEquals(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= Math.min(0.0001, 1e-6 * scale);
  }

  function optionalNumber(
    body: Record<string, unknown>,
    keys: string[]
  ): number | null {
    for (const key of keys) {
      const raw = body[key];
      if (raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function parseInvoiceSnapshot(
    invoiceId: number,
    body: Record<string, unknown>
  ): JubelioInvoiceSnapshot {
    // Runtime field spellings vary (the schema documents less than the API
    // returns); accept the documented and observed aliases, fail closed on
    // anything unusable.
    const parsedId = optionalNumber(body, ["invoice_id", "id"]);
    const salesorderId = optionalNumber(body, ["salesorder_id", "sales_order_id"]);
    const contactId = optionalNumber(body, ["contact_id"]);
    const locationId = optionalNumber(body, ["location_id"]);
    const subTotal = optionalNumber(body, ["sub_total"]);
    const totalDisc = optionalNumber(body, ["total_disc"]);
    const totalTax = optionalNumber(body, ["total_tax"]);
    const grandTotal = optionalNumber(body, ["grand_total", "total"]);
    if (
      parsedId === null ||
      parsedId !== invoiceId ||
      subTotal === null ||
      totalDisc === null ||
      totalTax === null ||
      grandTotal === null
    ) {
      throw new JubelioSalesGatewayError(
        `Jubelio invoice ${invoiceId} response is invalid or identifies a different invoice`,
        { code: "INVOICE_VERIFY_FAILED", httpStatus: 200, ambiguous: false, retryable: false }
      );
    }
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: JubelioInvoiceItem[] = [];
    for (const raw of rawItems) {
      const row = raw as Record<string, unknown>;
      const itemId = optionalNumber(row, ["item_id"]);
      const quantity = optionalNumber(row, ["qty_in_base", "qty", "quantity"]);
      const price = optionalNumber(row, ["price"]);
      const amount = optionalNumber(row, ["amount"]);
      if (itemId === null || quantity === null || price === null || amount === null) {
        throw new JubelioSalesGatewayError(
          `Jubelio invoice ${invoiceId} has an unreadable item line`,
          { code: "INVOICE_VERIFY_FAILED", httpStatus: 200, ambiguous: false, retryable: false }
        );
      }
      items.push({
        itemId,
        quantity,
        price,
        amount,
        unit: typeof row.unit === "string" ? row.unit : "",
      });
    }
    return {
      invoiceId: parsedId,
      invoiceNo: typeof body.invoice_no === "string" ? body.invoice_no : "",
      salesorderId,
      contactId,
      locationId,
      subTotal,
      totalDisc,
      totalTax,
      grandTotal,
      isCanceled: body.is_canceled === true,
      items,
    };
  }

  function invoiceLinkageMismatch(input: {
    invoice: JubelioInvoiceSnapshot;
    order: JubelioSalesOrderSnapshot;
  }): string | null {
    const invoice = input.invoice;
    if (
      invoice.salesorderId !== null &&
      invoice.salesorderId !== input.order.salesorderId
    ) {
      return `confirmed invoice ${invoice.invoiceId} belongs to sales order ${invoice.salesorderId}, expected ${input.order.salesorderId}`;
    }
    if (invoice.isCanceled || input.order.isCanceled) {
      return `confirmed invoice ${invoice.invoiceId} or its sales order is canceled`;
    }
    if (invoice.contactId !== input.order.contactId || invoice.locationId !== input.order.locationId) {
      return `confirmed invoice ${invoice.invoiceId} contact or location differs from the sales order`;
    }
    if (!moneyEquals(invoice.subTotal, input.order.subTotal) ||
        !moneyEquals(invoice.totalDisc, input.order.totalDisc) ||
        !moneyEquals(invoice.totalTax, input.order.totalTax) ||
        !moneyEquals(invoice.grandTotal, input.order.grandTotal)) {
      return `confirmed invoice ${invoice.invoiceId} amounts differ from the sales order`;
    }
    const expected = [...input.order.items].sort((a, b) => a.itemId - b.itemId);
    const actual = [...invoice.items].sort((a, b) => a.itemId - b.itemId);
    if (actual.length !== expected.length || actual.some((line, i) =>
      line.itemId !== expected[i].itemId || line.quantity !== expected[i].quantity ||
      !moneyEquals(line.price, expected[i].price) || !moneyEquals(line.amount, expected[i].amount)
    )) {
      return `confirmed invoice ${invoice.invoiceId} item lines differ from the sales order`;
    }
    // Runtime shape (sandbox 2026-09-24): the invoice GET exposes the SO link
    // only via `salesorder_no` (salesorder_id is null), so the authoritative
    // cross-check is the SO GET's invoice_id.
    if (input.order.invoiceId !== invoice.invoiceId) {
      return `sales order ${input.order.salesorderId} does not reference invoice ${invoice.invoiceId} (references ${input.order.invoiceId})`;
    }
    return null;
  }

  function parsePaymentSnapshot(
    paymentId: number,
    body: Record<string, unknown>
  ): JubelioPaymentSnapshot {
    const parsedId = optionalNumber(body, ["payment_id", "id"]);
    const amount = optionalNumber(body, ["amount"]);
    if (parsedId === null || parsedId !== paymentId || amount === null) {
      throw new JubelioSalesGatewayError(
        `Jubelio payment ${paymentId} response is invalid or identifies a different payment`,
        { code: "PAYMENT_VERIFY_FAILED", httpStatus: 200, ambiguous: false, retryable: false }
      );
    }
    // Runtime shape (sandbox 2026-09-24): the invoice association lives in
    // `invoices[]` ({invoice_id, payment_amount, salesorder_id}).
    const rawLines = Array.isArray(body.invoices)
      ? body.invoices
      : Array.isArray(body.items)
        ? body.items
        : [];
    const invoices: { invoiceId: number; paymentAmount: number; salesorderId: number | null }[] = [];
    for (const raw of rawLines) {
      const row = raw as Record<string, unknown>;
      const invoiceId = optionalNumber(row, ["invoice_id"]);
      const paymentAmount = optionalNumber(row, ["payment_amount", "amount"]);
      if (invoiceId === null || paymentAmount === null) continue; // tolerate unknown line shapes
      invoices.push({
        invoiceId,
        paymentAmount,
        salesorderId: optionalNumber(row, ["salesorder_id"]),
      });
    }
    return {
      paymentId: parsedId,
      invoiceId: optionalNumber(body, ["invoice_id"]),
      contactId: optionalNumber(body, ["contact_id"]),
      amount,
      invoices,
    };
  }

  function paymentLinkageMismatch(input: {
    payment: JubelioPaymentSnapshot;
    invoiceId: number;
    amount: number;
  }): string | null {
    const payment = input.payment;
    const linked = payment.invoices.find(
      (item) => item.invoiceId === input.invoiceId
    );
    if (!linked || payment.invoices.length !== 1) {
      return `confirmed payment ${payment.paymentId} has no single line for invoice ${input.invoiceId}`;
    }
    if (linked && !moneyEquals(linked.paymentAmount, input.amount)) {
      return `confirmed payment line for invoice ${input.invoiceId} is ${linked.paymentAmount}, expected ${input.amount}`;
    }
    if (!moneyEquals(payment.amount, input.amount)) {
      return `confirmed payment amount ${payment.amount} does not match requested ${input.amount}`;
    }
    return null;
  }

  return {
    async createSalesOrder(input): Promise<JubelioSalesCreateResult> {
      const payload = buildSalesOrderPayload(input);
      const context = { operation: "sales_order_create", operationId: input.operationId };
      // Exactly one create POST; any failure is terminal for this attempt.
      // Create rides the read lane (5): the cancel POST (10) must stay the
      // highest-priority write so it can outrank reads and create.
      const { status, body } = await postOnce({
        path: "/sales/orders/",
        body: payload,
        priority: 5,
        context,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/orders/", status, body, context });
      }
      const salesOrderId = parsePositiveId(body);
      let snapshot: JubelioSalesOrderSnapshot;
      try {
        snapshot = await readSalesOrderSnapshot(salesOrderId, 5);
      } catch (error) {
        // The create POST may have been applied; an unreadable/unverifiable
        // confirmation GET can never be treated as success.
        log.error("Jubelio sales order confirmation read failed", {
          ...context,
          salesOrderId,
          error: serializeError(error),
        });
        throw new JubelioSalesGatewayError(
          "Jubelio sales order confirmation read failed",
          { ambiguous: true, retryable: false }
        );
      }
      const mismatch = confirmationMismatch({
        requested: input,
        snapshot,
        salesOrderId,
      });
      if (mismatch) {
        log.error("Jubelio sales order confirmation mismatch", {
          ...context,
          salesOrderId,
          mismatch,
        });
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${salesOrderId} does not match the requested order: ${mismatch}`,
          { ambiguous: true, retryable: false }
        );
      }
      log.info("Jubelio sales order created and confirmed", {
        ...context,
        salesOrderId,
      });
      return { salesOrderId, order: snapshot };
    },

    async getSalesOrder(salesOrderId) {
      return readSalesOrderSnapshot(salesOrderId, 5);
    },

    async getSalesOrderForEdit(salesOrderId) {
      const body = await readJson(`/sales/orders/${salesOrderId}`, 5);
      return parseSalesOrderEditSnapshot(salesOrderId, body);
    },

    async editSalesOrder(input): Promise<JubelioSalesEditResult> {
      const context = {
        operation: "sales_order_channel_edit",
        operationId: input.operationId,
        salesOrderId: input.edit.salesorderId,
      };
      // Payload construction is fail-closed BEFORE anything is sent (the
      // builder throws a non-ambiguous JubelioSalesGatewayError on any unsafe
      // snapshot — zero POST).
      const payload = buildSalesOrderEditPayload(
        input.edit,
        input.targetChannelStatus
      );
      // Exactly one edit POST; rides the read lane (5): a channel mirror edit
      // must never outrank the cancel POST (10).
      const { status, body } = await postOnce({
        path: "/sales/orders/",
        body: payload,
        priority: 5,
        context,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/orders/", status, body, context });
      }
      const salesOrderId = parsePositiveId(body);
      if (salesOrderId !== input.edit.salesorderId) {
        throw new JubelioSalesGatewayError(
          `Jubelio sales order edit response identifies order ${salesOrderId}, expected ${input.edit.salesorderId}`,
          { httpStatus: status, ambiguous: true, retryable: false }
        );
      }
      // Independent confirmation GET: marker + core attributes.
      let confirmed: JubelioSalesOrderEditSnapshot;
      try {
        const confirmBody = await readJson(`/sales/orders/${salesOrderId}`, 5);
        confirmed = parseSalesOrderEditSnapshot(salesOrderId, confirmBody);
      } catch (error) {
        log.error("Jubelio sales order edit confirmation read failed", {
          ...context,
          error: serializeError(error),
        });
        throw new JubelioSalesGatewayError(
          "Jubelio sales order edit confirmation read failed",
          { ambiguous: true, retryable: false }
        );
      }
      const mismatch = editConfirmationMismatch({
        requested: input.edit,
        confirmed,
        targetChannelStatus: input.targetChannelStatus,
      });
      if (mismatch) {
        log.error("Jubelio sales order edit confirmation mismatch", {
          ...context,
          mismatch,
        });
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${salesOrderId} edit is not confirmed: ${mismatch}`,
          { code: "EDIT_CONFIRM_MISMATCH", ambiguous: true, retryable: false }
        );
      }
      log.info("Jubelio sales order channel status edited and confirmed", {
        ...context,
      });
      return { salesOrderId, order: confirmed };
    },

    async cancelSalesOrder(input): Promise<JubelioSalesCancelResult> {
      const context = { operation: "sales_order_cancel", operationId: input.operationId };
      // Pre-invoice read: establishes current remote state before any write.
      const pre = await readSalesOrderSnapshot(input.salesOrderId, 5);
      if (pre.isCanceled) {
        log.info("Jubelio sales order already canceled", {
          ...context,
          salesOrderId: input.salesOrderId,
        });
        return { salesOrderId: input.salesOrderId, alreadyCanceled: true, order: pre };
      }
      if (pre.invoiceId !== null) {
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${input.salesOrderId} already has an invoice and cannot be canceled`,
          { ambiguous: false, retryable: false }
        );
      }
      // Exactly one cancel POST; never repeated, whatever the outcome.
      let post: { status: number; body: Record<string, unknown> } | null = null;
      try {
        post = await postOnce({
          path: "/sales/orders/cancel/",
          body: { ids: [input.salesOrderId] },
          priority: 10,
          context,
        });
      } catch (error) {
        // A timeout/network failure may have applied the cancellation: the
        // outcome is unknown, so reconcile with a single confirmation GET.
        if (
          error instanceof JubelioSalesGatewayError &&
          error.options.ambiguous
        ) {
          log.error("Jubelio sales write outcome unknown", {
            ...context,
            salesOrderId: input.salesOrderId,
            error: serializeError(error),
          });
        } else {
          throw error;
        }
      }
      if (post) {
        const { status, body } = post;
        if (status === 429) {
          throw writeRejection({
            path: "/sales/orders/cancel/",
            status,
            body,
            context,
          });
        }
        if (status < 200 || status >= 300) {
          const error = writeRejection({
            path: "/sales/orders/cancel/",
            status,
            body,
            context,
          });
          // Definite provider rejections (400/401/403/404/409) need no further
          // read; 500+ may have been applied, so reconcile with a single GET.
          if (!error.options.ambiguous) throw error;
        }
      }
      let confirmed: JubelioSalesOrderSnapshot;
      try {
        confirmed = await readSalesOrderSnapshot(input.salesOrderId, 5);
      } catch (error) {
        log.error("Jubelio sales order cancel confirmation read failed", {
          ...context,
          salesOrderId: input.salesOrderId,
          error: serializeError(error),
        });
        throw new JubelioSalesGatewayError(
          "Jubelio sales order cancel confirmation read failed",
          { ambiguous: true, retryable: false }
        );
      }
      if (!confirmed.isCanceled) {
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${input.salesOrderId} is not confirmed canceled; outcome is ambiguous`,
          { ambiguous: true, retryable: false }
        );
      }
      log.info("Jubelio sales order canceled and confirmed", {
        ...context,
        salesOrderId: input.salesOrderId,
      });
      return {
        salesOrderId: input.salesOrderId,
        alreadyCanceled: false,
        order: confirmed,
      };
    },

    async createInvoice(input): Promise<JubelioInvoiceCreateResult> {
      const context = {
        operation: "sales_invoice_create",
        operationId: input.operationId,
        salesOrderId: input.salesOrderId,
      };
      // Exactly one conversion POST; any failure is terminal for this attempt.
      // Conversion is a settlement write and rides the read lane (5): it must
      // never outrank the cancel POST (10).
      const { status, body } = await postOnce({
        path: "/sales/packlists/create-invoice",
        body: { salesorder_id: input.salesOrderId },
        priority: 5,
        context,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({
          path: "/sales/packlists/create-invoice",
          status,
          body,
          context,
        });
      }
      // The response documents `{status, id}` where id is the Sales Invoice
      // Number. An unreadable id is AMBIGUOUS: the conversion may exist.
      const invoiceId = parsePositiveId(body);
      let invoice: JubelioInvoiceSnapshot;
      try {
        const verified = await readJson(`/sales/invoices/${invoiceId}`, 5);
        invoice = parseInvoiceSnapshot(invoiceId, verified);
      } catch (error) {
        log.error("Jubelio invoice verification read failed", {
          ...context,
          invoiceId,
          error: serializeError(error),
        });
        // The conversion POST may have been applied; an unverifiable invoice
        // can never be treated as verified. Recovery is a GET of this id.
        throw new JubelioSalesGatewayError(
          "Jubelio invoice verification read failed",
          { code: "INVOICE_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false }
        );
      }
      // Cross-check the linkage on the SALES ORDER: the invoice GET exposes
      // the SO only via salesorder_no (salesorder_id is null at runtime),
      // while the SO GET carries invoice_id after conversion.
      let order: JubelioSalesOrderSnapshot;
      try {
        order = await readSalesOrderSnapshot(input.salesOrderId, 5);
      } catch (error) {
        log.error("Jubelio invoice linkage read failed", {
          ...context,
          invoiceId,
          error: serializeError(error),
        });
        throw new JubelioSalesGatewayError(
          "Jubelio invoice linkage read failed",
          { code: "INVOICE_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false }
        );
      }
      const mismatch = invoiceLinkageMismatch({ invoice, order });
      if (mismatch) {
        log.error("Jubelio invoice verification mismatch", { ...context, invoiceId, mismatch });
        throw new JubelioSalesGatewayError(
          `Jubelio invoice ${invoiceId} does not match the converted sales order: ${mismatch}`,
          { code: "INVOICE_VERIFY_MISMATCH", ambiguous: true, retryable: false }
        );
      }
      log.info("Jubelio invoice created and linked", { ...context, invoiceId });
      return { invoiceId, invoice };
    },

    async getInvoice(invoiceId) {
      const body = await readJson(`/sales/invoices/${invoiceId}`, 5);
      return parseInvoiceSnapshot(invoiceId, body);
    },

    async createInvoicePayment(input): Promise<JubelioPaymentCreateResult> {
      const payment = input.payment;
      if (!Number.isSafeInteger(payment.accountId) || payment.accountId <= 0) {
        throw new JubelioSalesGatewayError(
          "Jubelio invoice payment requires a positive payment account id",
          { code: "PAYMENT_ACCOUNT_MISSING", ambiguous: false, retryable: false }
        );
      }
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        throw new JubelioSalesGatewayError(
          "Jubelio invoice payment requires a positive amount",
          { code: "PAYMENT_AMOUNT_INVALID", ambiguous: false, retryable: false }
        );
      }
      if (!Number.isSafeInteger(payment.paymentType) || payment.paymentType < 0) {
        throw new JubelioSalesGatewayError(
          "Jubelio invoice payment requires a numeric payment type",
          { code: "PAYMENT_TYPE_INVALID", ambiguous: false, retryable: false }
        );
      }
      const context = {
        operation: "sales_payment_create",
        operationId: input.operationId,
        invoiceId: payment.invoiceId,
      };
      // Exactly one payment POST (sandbox 2026-09-24: payment_type is a
      // number, payment_no "[auto]" is provider-numbered, response is
      // `{status, id}` where id is the payment_id). The invoice id was
      // already verified by the caller.
      const { status, body } = await postOnce({
        path: "/sales/payments/",
        body: {
          account_id: payment.accountId,
          amount: payment.amount,
          contact_id: payment.contactId,
          ...(payment.contactName ? { contact_name: payment.contactName } : {}),
          payment_id: 0,
          payment_no: "[auto]",
          payment_type: payment.paymentType,
          transaction_date: new Date().toISOString(),
          ...(payment.note ? { note: payment.note } : {}),
          items: [
            {
              payment_detail_id: 0,
              invoice_id: payment.invoiceId,
              payment_amount: payment.amount,
            },
          ],
        },
        priority: 5,
        context,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/payments/", status, body, context });
      }
      // `saveOK` may not carry an id; without one the payment cannot be
      // verified → ambiguous (it may exist). Never blind-retry; reconcile.
      const paymentId = optionalNumber(body, ["payment_id", "id"]);
      if (paymentId === null || !Number.isSafeInteger(paymentId) || paymentId <= 0) {
        throw new JubelioSalesGatewayError(
          "Jubelio payment response has no usable payment id; the payment outcome is unknown",
          { code: "PAYMENT_ID_MISSING", httpStatus: 200, ambiguous: true, retryable: false }
        );
      }
      let snapshot: JubelioPaymentSnapshot;
      try {
        const verified = await readJson(`/sales/payments/${paymentId}`, 5);
        snapshot = parsePaymentSnapshot(paymentId, verified);
      } catch (error) {
        log.error("Jubelio payment verification read failed", {
          ...context,
          paymentId,
          error: serializeError(error),
        });
        throw new JubelioSalesGatewayError(
          "Jubelio payment verification read failed",
          { code: "PAYMENT_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false }
        );
      }
      const mismatch = paymentLinkageMismatch({
        payment: snapshot,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
      });
      if (mismatch) {
        log.error("Jubelio payment verification mismatch", { ...context, paymentId, mismatch });
        throw new JubelioSalesGatewayError(
          `Jubelio payment ${paymentId} does not match the verified invoice: ${mismatch}`,
          { code: "PAYMENT_VERIFY_MISMATCH", ambiguous: true, retryable: false }
        );
      }
      log.info("Jubelio payment created and linked", { ...context, paymentId });
      return { paymentId, payment: snapshot };
    },

    async getPayment(paymentId) {
      const body = await readJson(`/sales/payments/${paymentId}`, 5);
      return parsePaymentSnapshot(paymentId, body);
    },
  };
}