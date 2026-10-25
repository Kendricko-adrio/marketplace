import {
  JubelioRequestQueueError,
  getSharedJubelioRequestScheduler,
  type JubelioRequestScheduler,
} from "./jubelio-request-scheduler";
import { createModuleLogger } from "./logger";

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
 * - Contract v2 (ticket 01) is explicit: `providerContractVersion: 2` plus the
 *   frozen `originalShipmentCost`/`shippingCost`/`expectedProviderPayable`
 *   envelope is required, bounded to whole Rupiah and bounded cart quantity
 *   before the POST, and the request is emitted with `original_shipment_cost`
 *   + `shipping_cost` and `grand_total = net goods + net shipping`.
 *   `shipping_cost_discount` is never emitted. The unversioned legacy branch
 *   keeps its rules unchanged; any other explicit version fails closed.
 * - A create is only confirmed when the independent GET proves the STORED
 *   expected envelope (original/net shipping, grand total = expected provider
 *   payable, item/header money). Missing GET fields and a Rp1 divergence are
 *   both mismatches, and the returned SO id is preserved on the error so the
 *   outcome stays reconcilable.
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

/**
 * Module-scope logger: only the module name is bound here. Correlation fields
 * are read from the active scope when a line is written, so creating it once at
 * import time (before any request scope exists) is correct.
 */
const log = createModuleLogger("jubelio-sales");

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

/**
 * Expected money envelope of a contract-v2 Sales Order, taken from the STORED
 * create intent (never recomputed from a provider response): frozen original
 * shipping before subsidy, net customer shipping after subsidy and the exact
 * provider payable (net goods + net shipping).
 */
export type JubelioSalesExpectedEnvelope = {
  providerContractVersion: 2;
  originalShipmentCost: number;
  shippingCost: number;
  expectedProviderPayable: number;
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
  /**
   * Explicit provider contract version of the persisted intent.
   *
   * - absent (`undefined`) — unversioned legacy snapshot (zero-disc/zero-tax
   *   envelope, no shipping fields; rules unchanged).
   * - `2` — contract v2: the frozen shipping/payable envelope below is
   *   required and the provider request is derived from it.
   *
   * Any other explicit value — including an explicit `null` — is an unknown
   * version and fails closed before anything is sent. The version is typed as
   * `number | null` here on purpose: the persisted payload is `jsonb`
   * (compile-time typing only), so an unknown/null version must be rejected at
   * runtime instead of being trusted by the type. Only an ABSENT value is the
   * legacy branch.
   */
  providerContractVersion?: number | null;
  /** Contract v2 only: customer shipping before subsidy (pickup: 0). */
  originalShipmentCost?: number;
  /** Contract v2 only: net customer shipping after subsidy (pickup: 0). */
  shippingCost?: number;
  /** Contract v2 only: expected provider payable = net goods + net shipping. */
  expectedProviderPayable?: number;
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
  /**
   * Shipping money as observed on the GET (contract v2). `null` when the
   * response omits the field; the v2 envelope guard then fails closed.
   */
  originalShipmentCost?: number | null;
  shippingCost?: number | null;
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
  /**
   * Shipping money as observed on the GET (contract v2). `null` when the
   * response omits the field; a v2 confirmation never accepts a missing value.
   */
  originalShipmentCost?: number | null;
  shippingCost?: number | null;
  items: JubelioSalesOrderItem[];
};

export type JubelioSalesCreateResult = {
  salesOrderId: number;
  order: JubelioSalesOrderSnapshot;
};

/**
 * Awaited persistence hook for a provider id a write returned.
 *
 * The caller stores the handle durably (its own ledger/DB) BEFORE any
 * independent verification GET runs, so a crash between the POST and the GET
 * never loses the only reconciliation handle. The hook is a runtime-only input
 * and is NEVER serialized into the provider request or the persisted request
 * snapshot.
 */
export type JubelioSalesReturnedIdPersistence = (
  providerId: number
) => Promise<void> | void;

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
  /**
   * ADDITIVE (contract v2, evidence T1/T2): the paid amount observed on the
   * invoice GET. Absent when the response does not carry `payment_amount`, so
   * a legacy snapshot keeps its previous shape; the contract-v2 settlement
   * treats a missing value as a failed-closed mismatch, never as zero.
   */
  paymentAmount?: number;
};

/**
 * One payment↔invoice association as observed on `GET /sales/payments/{id}`
 * (evidence T1/T2: `{salesorder_id, invoice_id, payment_amount, grand_total,
 * due}`).
 */
export type JubelioPaymentInvoiceAssociation = {
  invoiceId: number;
  paymentAmount: number;
  salesorderId: number | null;
  /** ADDITIVE (contract v2): observed grand total of the association line. */
  grandTotal?: number;
  /** ADDITIVE (contract v2): observed remaining due of the association line. */
  due?: number;
};

export type JubelioPaymentSnapshot = {
  paymentId: number;
  invoiceId: number | null;
  contactId: number | null;
  amount: number;
  invoices: JubelioPaymentInvoiceAssociation[];
  /**
   * ADDITIVE (contract v2, evidence T1/T2): the payment account observed on the
   * GET. Absent for a legacy response; contract v2 requires it to equal the
   * stored account intent.
   */
  accountId?: number;
  /** ADDITIVE (contract v2): observed payment type (0 = cash/other). */
  paymentType?: number;
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
      /**
       * Remote id the provider already returned for the failed stage, so an
       * ambiguous/mismatched outcome stays reconcilable by GET instead of
       * being re-created (never a blind retry).
       */
      salesOrderId?: number;
      /** Same reconciliation handle for the invoice conversion stage. */
      invoiceId?: number;
      /** Same reconciliation handle for the payment stage. */
      paymentId?: number;
    }
  ) {
    super(message);
    this.name = "JubelioSalesGatewayError";
  }
}

/**
 * Technical failure codes this module is allowed to describe in a log line.
 * Every value is a literal owned by the gateway — never text copied from a
 * provider, transport, persistence layer or caller.
 */
type JubelioSalesLogCode = "QUEUE_FULL" | "QUEUE_TIMEOUT";

/**
 * Safe technical projection for the `error` field of this module's log lines.
 *
 * The logging core keeps the `name`/`message`/`stack`/`cause` of whatever it is
 * given, redacted by shape only. Passing a raw caught value would therefore
 * publish free text that a transport, persistence or provider layer put into
 * `message`, `stack` or `cause`: a customer name or a street address cannot be
 * recovered by key-based redaction once it already sits inside a string. This
 * class is consequently the ONLY value this module hands to a log line — the
 * message is chosen here, and the optional `code` is one of the allowlisted
 * literals above.
 *
 * The caught value is never lost from the business flow: the thrown
 * `JubelioSalesGatewayError` keeps its own message, code, classification and
 * ids exactly as before.
 */
class JubelioSalesDependencyError extends Error {
  readonly code?: JubelioSalesLogCode;

  constructor(message: string, code?: JubelioSalesLogCode) {
    super(message);
    this.name = "JubelioSalesDependencyError";
    this.code = code;
  }
}

/**
 * Classifies a caught dependency failure into the static projection above.
 *
 * A queue rejection is the only case whose technical code is a module-owned
 * literal (`QUEUE_FULL`/`QUEUE_TIMEOUT`); every other caught value is described
 * generically, because its text belongs to the layer that threw it. Property
 * reads and `instanceof` are guarded: a throwing getter or proxy trap must
 * degrade to the generic projection instead of turning a logging-only concern
 * into a business failure.
 */
function safeDependencyErrorLog(error: unknown): JubelioSalesDependencyError {
  try {
    if (error instanceof JubelioRequestQueueError) {
      const code = error.code;
      if (code === "QUEUE_FULL" || code === "QUEUE_TIMEOUT") {
        return new JubelioSalesDependencyError(
          "Jubelio request ditolak oleh antrean permintaan provider",
          code
        );
      }
    }
  } catch {
    // A hostile value (throwing getter or proxy trap) carries no safe signal:
    // fall through to the generic projection instead of failing the caller.
  }
  return new JubelioSalesDependencyError(
    "Jubelio sales request gagal pada lapisan transport, gateway atau penyimpanan"
  );
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
 * Conservative website money bound (spec §4.3): whole Rupiah
 * `0..9_999_999_999_999`. Provider decimals are normalized exactly elsewhere;
 * nothing here rounds a fractional Rupiah.
 */
const CONTRACT_MONEY_MAX = 9_999_999_999_999;
/** Bounded cart (spec §4.3): at most 50 distinct variant lines. */
const CONTRACT_MAX_ITEM_LINES = 50;
/** Bounded cart (spec §4.3): quantity 1..99 per variant. */
const CONTRACT_MAX_ITEM_QUANTITY = 99;

function isContractMoney(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= CONTRACT_MONEY_MAX
  );
}

/**
 * Runtime validation of an EXPLICITLY supplied contract-v2 expected envelope
 * (the stored create intent of the same order). The persisted payload is
 * `jsonb`: its TypeScript type is compile-time only, so this is the single
 * trust boundary for every caller that passes an envelope in.
 *
 * - `undefined` / `null` ARGUMENT → no envelope supplied (legacy caller): the
 *   unchanged legacy rules apply.
 * - A supplied envelope OBJECT must carry exactly version `2`; an explicit
 *   `null`, `1`, `3` or any other value is an unknown version and fails closed.
 * - Money must be bounded whole Rupiah with net shipping never above the
 *   pre-subsidy shipping.
 *
 * All failures are non-ambiguous/pre-send, so an unknown version can never
 * reach a payload or the network.
 */
function assertExpectedEnvelope(
  expected:
    | {
        providerContractVersion?: number | null;
        originalShipmentCost?: number;
        shippingCost?: number;
        expectedProviderPayable?: number;
      }
    | null
    | undefined
): JubelioSalesExpectedEnvelope | null {
  if (expected === undefined || expected === null) return null;
  const version = expected.providerContractVersion;
  if (version !== 2) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order provider contract version ${String(version)} is unsupported: only the unversioned legacy snapshot and contract version 2 are accepted`,
      { code: "CONTRACT_VERSION_UNSUPPORTED", ambiguous: false, retryable: false }
    );
  }
  const { originalShipmentCost, shippingCost, expectedProviderPayable } = expected;
  if (
    !isContractMoney(originalShipmentCost) ||
    !isContractMoney(shippingCost) ||
    !isContractMoney(expectedProviderPayable)
  ) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: original shipping, net shipping and expected provider payable must be whole Rupiah integers from 0 to ${CONTRACT_MONEY_MAX}`,
      { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
    );
  }
  if (shippingCost > originalShipmentCost) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: net shipping ${shippingCost} cannot exceed the original shipping ${originalShipmentCost}`,
      { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
    );
  }
  return {
    providerContractVersion: 2,
    originalShipmentCost,
    shippingCost,
    expectedProviderPayable,
  };
}

/**
 * Resolves the expected provider money envelope of a create input from the
 * STORED intent.
 *
 * - absent (`undefined`) version → the unversioned legacy snapshot: the
 *   existing zero-disc/zero-tax rules apply unchanged, and shipping money must
 *   never be attached without an explicit version (it would be silently
 *   dropped otherwise).
 * - explicit version (including an explicit `null`) → must be exactly `2`;
 *   everything else fails closed BEFORE login/POST.
 */
function resolveContractEnvelope(input: {
  providerContractVersion?: number | null;
  originalShipmentCost?: number;
  shippingCost?: number;
  expectedProviderPayable?: number;
}): JubelioSalesExpectedEnvelope | null {
  const version = input.providerContractVersion;
  if (version === undefined) {
    if (
      input.originalShipmentCost !== undefined ||
      input.shippingCost !== undefined ||
      input.expectedProviderPayable !== undefined
    ) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order input is invalid: shipping/payable money requires an explicit provider contract version",
        { code: "CONTRACT_VERSION_REQUIRED", ambiguous: false, retryable: false }
      );
    }
    return null;
  }
  return assertExpectedEnvelope({
    providerContractVersion: version,
    originalShipmentCost: input.originalShipmentCost,
    shippingCost: input.shippingCost,
    expectedProviderPayable: input.expectedProviderPayable,
  });
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
 *
 * Contract v2 (ticket 01) keeps the same zero item discount/tax rule (the
 * discount mapping is ticket 03) and adds the frozen shipping/provider-payable
 * envelope plus the bounded cart/money limits, all verified before the POST.
 *
 * @returns the resolved contract-v2 envelope, or `null` for the unchanged
 * unversioned legacy branch.
 */
function assertValidCreateInput(
  input: JubelioSalesOrderCreateInput
): JubelioSalesExpectedEnvelope | null {
  // The version gate runs first: an unknown version must never be sent.
  const envelope = resolveContractEnvelope(input);
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
    if (item.taxAmount !== 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order with a nonzero tax amount is rejected: the provider tax envelope is a valid No Tax record",
        { ambiguous: false, retryable: false }
      );
    }
    if (item.discAmount > 0) {
      if (!Number.isSafeInteger(item.price * item.quantity)) {
        throw new JubelioSalesGatewayError(
          "Jubelio sales order input is invalid: line gross must stay a safe integer when a discount is present",
          { ambiguous: false, retryable: false }
        );
      }
      if (item.discAmount > item.price * item.quantity) {
        throw new JubelioSalesGatewayError(
          "Jubelio sales order input is invalid: item discount cannot exceed the line gross",
          { ambiguous: false, retryable: false }
        );
      }
    }
    // The unversioned legacy branch keeps its evidenced zero-discount rule
    // unchanged; only the versioned contract-2 path may carry a whole-line
    // Markdown discount (spec §10.2).
    if (!envelope && item.discAmount !== 0) {
      throw new JubelioSalesGatewayError(
        "Jubelio sales order with a nonzero discount is rejected on the unversioned legacy contract",
        { ambiguous: false, retryable: false }
      );
    }
  }
  if (envelope) {
    assertContractCreateEnvelope(input, envelope);
  }
  return envelope;
}

/**
 * Contract-v2 bounded cart + exact provider-payable verification (the expected
 * value comes from the stored snapshot, never from a provider response).
 */
function assertContractCreateEnvelope(
  input: JubelioSalesOrderCreateInput,
  envelope: JubelioSalesExpectedEnvelope
): void {
  if (input.items.length > CONTRACT_MAX_ITEM_LINES) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: at most ${CONTRACT_MAX_ITEM_LINES} item lines are allowed`,
      { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
    );
  }
  let subTotal = 0;
  let totalDisc = 0;
  for (const item of input.items) {
    if (item.quantity > CONTRACT_MAX_ITEM_QUANTITY) {
      throw new JubelioSalesGatewayError(
        `Jubelio sales order contract v2 input is invalid: item quantity must be 1..${CONTRACT_MAX_ITEM_QUANTITY} per line`,
        { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
      );
    }
    // Source Jubelio prices with a nonzero Rupiah fraction are held, never
    // silently rounded into provider money.
    if (!isContractMoney(item.price)) {
      throw new JubelioSalesGatewayError(
        `Jubelio sales order contract v2 input is invalid: item price must be whole Rupiah from 0 to ${CONTRACT_MONEY_MAX}`,
        { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
      );
    }
    const gross = item.price * item.quantity;
    if (!isContractMoney(gross)) {
      throw new JubelioSalesGatewayError(
        `Jubelio sales order contract v2 input is invalid: item gross amount must stay within whole Rupiah 0..${CONTRACT_MONEY_MAX}`,
        { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
      );
    }
    subTotal += gross;
    totalDisc += item.discAmount;
  }
  // Net goods = gross - whole-line discount; provider payable = net goods +
  // net shipping. Tax stays locked at 0 by the item guard above.
  if (!isContractMoney(subTotal) || !isContractMoney(totalDisc)) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: sub total must stay within whole Rupiah 0..${CONTRACT_MONEY_MAX}`,
      { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
    );
  }
  const payable = subTotal - totalDisc + envelope.shippingCost;
  if (!isContractMoney(payable)) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: provider payable must stay within whole Rupiah 0..${CONTRACT_MONEY_MAX}`,
      { code: "CONTRACT_ENVELOPE_INVALID", ambiguous: false, retryable: false }
    );
  }
  if (payable !== envelope.expectedProviderPayable) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order contract v2 input is invalid: expected provider payable ${envelope.expectedProviderPayable} does not equal net goods ${subTotal - totalDisc} + net shipping ${envelope.shippingCost} (${payable})`,
      { code: "CONTRACT_PAYABLE_MISMATCH", ambiguous: false, retryable: false }
    );
  }
}

/**
 * Pure payload builder for `POST /sales/orders/` (`saveSalesOrderRequest`).
 * Rejects invalid input (including any nonzero tax/discount — see
 * `assertValidCreateInput`) before producing anything serializable.
 * Creation only: `salesorder_id` 0 and `salesorder_no` "[auto]" per the
 * documented schema and the canary. `source` 1 = Internal. `disc` (the
 * percentage field) is left at 0. Within the evidenced envelope
 * (disc = 0, tax = 0) the item `amount` reduces to `price × quantity`.
 *
 * Contract v2 adds the frozen money envelope: header
 * `original_shipment_cost` (pre-subsidy) and `shipping_cost` (net customer),
 * with `grand_total = net goods + net shipping = expected provider payable`.
 * `shipping_cost_discount` is never emitted (contract09 §3: absent from the
 * actual request, not 0/null/empty string — a GET default of 0 is never
 * copied into the request).
 */
export function buildSalesOrderPayload(
  input: JubelioSalesOrderCreateInput
): Record<string, unknown> {
  const envelope = assertValidCreateInput(input);
  const lines = input.items.map((item) => {
    const gross = item.price * item.quantity;
    const amount = gross - item.discAmount + item.taxAmount;
    return {
      salesorder_detail_id: 0,
      item_id: item.itemId,
      qty_in_base: item.quantity,
      price: item.price,
      // Percentage DERIVED from the whole-line discount (spec §10.1): a
      // provider display field, never a second discount. 0 for zero gross.
      disc: gross > 0 ? (100 * item.discAmount) / gross : 0,
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
    ...(envelope
      ? {
          original_shipment_cost: envelope.originalShipmentCost,
          shipping_cost: envelope.shippingCost,
        }
      : {}),
    grand_total: subTotal - totalDisc + totalTax + (envelope?.shippingCost ?? 0),
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
 *
 * `expected` is the OPTIONAL explicit contract-v2 create envelope of the same
 * order (from the stored create intent). When supplied, the snapshot's
 * original/net shipping must equal it, `grand_total` must equal the stored
 * expected provider payable, and the outbound payload preserves
 * `original_shipment_cost` + `shipping_cost`. `shipping_cost_discount` is
 * never emitted — a GET default of 0 is not copied into the request. Without
 * `expected`, the legacy rules above apply unchanged.
 */
export function buildSalesOrderEditPayload(
  edit: JubelioSalesOrderEditSnapshot,
  targetChannelStatus: string,
  expected: JubelioSalesExpectedEnvelope | null = null
): Record<string, unknown> {
  // The supplied envelope is the only trust boundary for the v2 money rules:
  // an unknown version or out-of-bound money must fail closed BEFORE anything
  // is serialized (and therefore long before any POST).
  const validatedExpected = assertExpectedEnvelope(expected);
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
  assertEditableMoneyEnvelope(edit, validatedExpected);
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
    ...(validatedExpected
      ? {
          original_shipment_cost:
            edit.originalShipmentCost ?? validatedExpected.originalShipmentCost,
          shipping_cost: edit.shippingCost ?? validatedExpected.shippingCost,
        }
      : {}),
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
 *
 * With an explicit contract-v2 `expected` envelope the header grand total is
 * checked against "net goods + net shipping = expected provider payable" and
 * the GET's original/net shipping must equal the stored values, instead of the
 * legacy `grand_total = sub_total` rule. The legacy branch is unchanged.
 */
function assertEditableMoneyEnvelope(
  edit: {
    subTotal: number;
    totalDisc: number;
    totalTax: number;
    grandTotal: number;
    addFee: number;
    addDisc: number;
    serviceFee: number;
    originalShipmentCost?: number | null;
    shippingCost?: number | null;
    items: Array<{
      quantity: number;
      price: number;
      disc: number;
      discAmount: number;
      taxAmount: number;
      amount: number;
      itemId: number;
    }>;
  },
  expected: JubelioSalesExpectedEnvelope | null = null
): void {
  const envelopeViolations: string[] = [];
  // A whole-line discount is allowed ONLY on the validated contract-v2 path
  // (`expected` present). The legacy branch keeps its evidenced zero-discount
  // envelope unchanged.
  const versioned = expected !== null;
  for (const line of edit.items) {
    const gross = line.price * line.quantity;
    if (line.taxAmount !== 0) {
      envelopeViolations.push(`item ${line.itemId} carries a nonzero tax amount`);
    }
    if (line.discAmount < 0 || line.discAmount > gross) {
      envelopeViolations.push(
        `item ${line.itemId} whole-line discount ${line.discAmount} is outside 0..gross(${gross})`
      );
    }
    if (!versioned && (line.disc !== 0 || line.discAmount !== 0)) {
      envelopeViolations.push(
        `item ${line.itemId} carries a nonzero discount on the unversioned legacy contract`
      );
    }
    // The provider line amount is gross - whole-line discount (tax is 0).
    const expectedAmount = gross - line.discAmount + line.taxAmount;
    if (!moneyEqualsSafe(line.amount, expectedAmount)) {
      envelopeViolations.push(
        `item ${line.itemId} amount ${line.amount} does not equal gross ${gross} - discount ${line.discAmount} (${expectedAmount})`
      );
    }
  }
  const expectedSubTotal = edit.items.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0
  );
  const expectedTotalDisc = edit.items.reduce(
    (sum, line) => sum + line.discAmount,
    0
  );
  if (edit.totalTax !== 0) {
    envelopeViolations.push("header carries a nonzero tax total");
  }
  if (versioned) {
    if (!moneyEqualsSafe(edit.totalDisc, expectedTotalDisc)) {
      envelopeViolations.push(
        `total_disc ${edit.totalDisc} does not equal the sum of line discounts (${expectedTotalDisc})`
      );
    }
  } else if (edit.totalDisc !== 0) {
    envelopeViolations.push("header carries a nonzero discount total on the legacy contract");
  }
  if (edit.addFee !== 0 || edit.addDisc !== 0 || edit.serviceFee !== 0) {
    envelopeViolations.push("header carries a nonzero fee/discount field");
  }
  if (!moneyEqualsSafe(edit.subTotal, expectedSubTotal)) {
    envelopeViolations.push(
      `sub_total ${edit.subTotal} does not equal the item lines (${expectedSubTotal})`
    );
  }
  if (expected) {
    if (
      edit.originalShipmentCost === undefined ||
      edit.originalShipmentCost === null ||
      !moneyEqualsSafe(edit.originalShipmentCost, expected.originalShipmentCost)
    ) {
      envelopeViolations.push(
        `original shipping ${String(edit.originalShipmentCost)} does not equal the stored original shipping ${expected.originalShipmentCost}`
      );
    }
    if (
      edit.shippingCost === undefined ||
      edit.shippingCost === null ||
      !moneyEqualsSafe(edit.shippingCost, expected.shippingCost)
    ) {
      envelopeViolations.push(
        `net shipping ${String(edit.shippingCost)} does not equal the stored net shipping ${expected.shippingCost}`
      );
    }
  }
  const expectedGrandTotal =
    expectedSubTotal - edit.totalDisc + edit.totalTax + (expected?.shippingCost ?? 0);
  if (!moneyEqualsSafe(edit.grandTotal, expectedGrandTotal)) {
    envelopeViolations.push(
      expected
        ? `grand_total ${edit.grandTotal} does not equal net goods ${expectedSubTotal} + net shipping ${expected.shippingCost} (${expectedGrandTotal})`
        : `grand_total ${edit.grandTotal} does not equal sub_total ${expectedSubTotal}`
    );
  }
  if (expected && !moneyEqualsSafe(edit.grandTotal, expected.expectedProviderPayable)) {
    envelopeViolations.push(
      `grand_total ${edit.grandTotal} does not equal the stored expected provider payable ${expected.expectedProviderPayable}`
    );
  }
  if (envelopeViolations.length > 0) {
    throw new JubelioSalesGatewayError(
      `Jubelio sales order edit refused: the money envelope does not match its validated contract — ${envelopeViolations.join("; ")}`,
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
    input: JubelioSalesOrderCreateInput & {
      operationId?: string;
      /**
       * Awaited with the returned SO id immediately after the POST id is
       * parsed and BEFORE the confirmation GET. A rejection is ambiguous
       * (the write may exist) and is never retried; the id stays on the error.
       */
      onSalesOrderId?: JubelioSalesReturnedIdPersistence;
    }
  ): Promise<JubelioSalesCreateResult>;
  getSalesOrder(salesOrderId: number): Promise<JubelioSalesOrderSnapshot>;
  /**
   * Strict edit pre-read (ticket #03): parses every documented
   * `saveSalesOrderRequest` field plus the item detail ids and fee fields,
   * fail-closed on any shape that must never become an edit POST. Pass the
   * order's explicit contract-v2 `expected` envelope so the pre-read also
   * proves the stored original/net shipping and provider payable.
   */
  getSalesOrderForEdit(
    salesOrderId: number,
    expected?: JubelioSalesExpectedEnvelope
  ): Promise<JubelioSalesOrderEditSnapshot>;
  /**
   * Full-payload channel-status edit (at most one POST). Built ONLY from the
   * verified pre-edit snapshot; confirmed by an independent GET. Never
   * re-POSTed on any ambiguous outcome. `expected` (contract v2) is OPTIONAL:
   * without it the legacy zero-disc/zero-fee rules apply unchanged.
   */
  editSalesOrder(input: {
    edit: JubelioSalesOrderEditSnapshot;
    targetChannelStatus: string;
    operationId?: string;
    expected?: JubelioSalesExpectedEnvelope;
  }): Promise<JubelioSalesEditResult>;
  cancelSalesOrder(input: {
    salesOrderId: number;
    operationId?: string;
  }): Promise<JubelioSalesCancelResult>;
  /** Path 1 only: convert a confirmed SO to an invoice, then verify it. */
  createInvoice(input: {
    salesOrderId: number;
    operationId?: string;
    /**
     * Awaited with the returned invoice id BEFORE the invoice/SO verification
     * GETs. A rejection is ambiguous and is never retried.
     */
    onInvoiceId?: JubelioSalesReturnedIdPersistence;
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
    /**
     * Awaited with the returned payment id BEFORE the payment verification
     * GET. A rejection is ambiguous and is never retried.
     */
    onPaymentId?: JubelioSalesReturnedIdPersistence;
  }): Promise<JubelioPaymentCreateResult>;
  getPayment(paymentId: number): Promise<JubelioPaymentSnapshot>;
};

/**
 * Stable business reference for one provider operation, used inside log
 * messages only: the operation name plus the caller-supplied operation id when
 * present. No free metadata field is added to a record.
 */
function operationLabel(operation: string, operationId?: string): string {
  return operationId === undefined || operationId.length === 0
    ? operation
    : `${operation} ${operationId}`;
}

/**
 * These knobs are the shared, provider-level Jubelio backpressure settings
 * already used by the stock gateway. Sharing them (and the shared scheduler
 * keyed by base URL) keeps one backpressure profile for all Jubelio traffic.
 */
export function createJubelioSalesGateway(options: {
  env?: JubelioSalesEnvironment;
  fetchImpl?: typeof fetch;
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
    log.info(`Jubelio POST ${path} dimulai`);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, init),
        { priority }
      );
    } catch (error) {
      log.error(
        `Jubelio POST ${path} gagal setelah ${Date.now() - startedAt}ms`,
        safeDependencyErrorLog(error)
      );
      throw error;
    }
    const body = await parseBody(response);
    log.info(
      `Jubelio POST ${path}: HTTP ${response.status} dalam ${Date.now() - startedAt}ms`
    );
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
    const method = requestInit.method ?? "GET";
    log.info(`Jubelio ${method} ${path} dimulai`);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await scheduler.schedule(
        () => fetchImpl(`${runtime.baseUrl}${path}`, requestInit),
        { priority }
      );
    } catch (error) {
      log.error(
        `Jubelio ${method} ${path} gagal setelah ${Date.now() - startedAt}ms`,
        safeDependencyErrorLog(error)
      );
      throw error;
    }
    log.info(
      `Jubelio ${method} ${path}: HTTP ${response.status} dalam ${Date.now() - startedAt}ms`
    );
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
    // Never log provider bodies: they contain customer PII.
    log.info(`Jubelio GET ${path}: HTTP ${response.status}`);
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
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    // Pre-send authentication happens OUTSIDE the ambiguity-wrapped request:
    // an auth/config/login failure means the write was never attempted, so
    // it must never be classified as ambiguous.
    try {
      await getAuthToken(input.priority);
    } catch (error) {
      // One shared line BEFORE the branches: a queue rejection is also a
      // pre-send failure, so which write was NOT sent must stay observable.
      // The `error` field is the static projection, never the caught value.
      log.error(
        `Jubelio POST ${input.path} tidak dikirim: autentikasi gagal`,
        safeDependencyErrorLog(error)
      );
      // Unchanged classification and branch order: a gateway error keeps its
      // own message/code, a queue rejection stays non-ambiguous but retryable,
      // and anything else is a non-ambiguous pre-send failure.
      if (error instanceof JubelioSalesGatewayError) {
        throw error;
      }
      if (error instanceof JubelioRequestQueueError) {
        // The request never left the process boundary — not ambiguous.
        throw new JubelioSalesGatewayError(error.message, {
          code: error.code,
          ambiguous: false,
          retryable: true,
        });
      }
      throw new JubelioSalesGatewayError(
        error instanceof Error ? error.message : "Jubelio write not attempted",
        { ambiguous: false, retryable: true }
      );
    }
    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify(input.body),
    };
    // Never log request payloads: Sales Orders include customer PII.
    log.info(`Jubelio POST ${input.path} dimulai`);
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
      log.error(
        `Jubelio POST ${input.path} gagal setelah ${Date.now() - startedAt}ms; hasil penulisan belum pasti`,
        safeDependencyErrorLog(error)
      );
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
      log.error(
        `Jubelio POST ${input.path}: body respons HTTP ${response.status} gagal dibaca; hasil penulisan belum pasti`,
        safeDependencyErrorLog(error)
      );
      throw new JubelioSalesGatewayError(
        "Jubelio sales write response body could not be read; the write outcome is unknown",
        { ambiguous: true, retryable: false }
      );
    }
    log.info(`Jubelio POST ${input.path}: HTTP ${response.status}`);
    return { status: response.status, body };
  }

  /**
   * Hands a returned provider id to the caller's awaited persistence hook
   * IMMEDIATELY after the valid POST id is parsed and BEFORE any independent
   * verification GET (ticket 01 / spec §10.2): the handle must be durable
   * before a crash or a failing verification can lose it.
   *
   * A rejecting hook means the handle could NOT be stored while the write may
   * already exist remotely → ambiguous, never retried, and the known id stays
   * on the error for reconciliation. The hook receives only the provider id:
   * it is never serialized into the provider request.
   */
  async function persistReturnedProviderId(input: {
    hook?: JubelioSalesReturnedIdPersistence;
    providerId: number;
    label: string;
    ids: { salesOrderId?: number; invoiceId?: number; paymentId?: number };
  }): Promise<void> {
    if (!input.hook) return;
    try {
      await input.hook(input.providerId);
    } catch (error) {
      log.error(
        `Jubelio ${input.label} ${input.providerId} gagal disimpan sebelum verifikasi; hasil penulisan belum pasti`,
        safeDependencyErrorLog(error)
      );
      throw new JubelioSalesGatewayError(
        `Jubelio ${input.label} ${input.providerId} could not be persisted before verification; the outcome is unknown`,
        {
          code: "RETURNED_ID_PERSIST_FAILED",
          ambiguous: true,
          retryable: false,
          ...input.ids,
        }
      );
    }
  }

  function writeRejection(input: {
    path: string;
    status: number;
    body: Record<string, unknown>;
  }): JubelioSalesGatewayError {
    // 500+: the write may or may not have been applied → ambiguous.
    // 429: throttled before processing; deliberately retryable later, but the
    // gateway itself never repeats a POST.
    // 400/401/403/404/409: the provider rejected the request before applying.
    const ambiguous = input.status >= 500;
    if (ambiguous) {
      log.error(
        `Jubelio POST ${input.path}: HTTP ${input.status}; hasil penulisan belum pasti`
      );
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
    // Contract v2 header shipping money is ADDITIVE: the keys are only returned
    // when the GET actually carried them, so the legacy response shape stays
    // byte-for-byte what it was before contract v2. A v2 confirmation treats a
    // missing key as a failed-closed mismatch, never as zero.
    const originalShipmentCost = optionalNumber(body, ["original_shipment_cost"]);
    const shippingCost = optionalNumber(body, ["shipping_cost"]);
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
      ...(originalShipmentCost === null ? {} : { originalShipmentCost }),
      ...(shippingCost === null ? {} : { shippingCost }),
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
    body: Record<string, unknown>,
    expected: JubelioSalesExpectedEnvelope | null = null
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
    const originalShipmentCost = optionalNumber(body, ["original_shipment_cost"]);
    const shippingCost = optionalNumber(body, ["shipping_cost"]);
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
      // Contract v2 shipping money is ADDITIVE: only returned when the GET
      // actually carried it, so the legacy edit snapshot shape is unchanged.
      ...(originalShipmentCost === null ? {} : { originalShipmentCost }),
      ...(shippingCost === null ? {} : { shippingCost }),
      items,
    };
    // Reuse the shared envelope rule so a GET showing nonzero disc/tax/fee
    // money fails closed exactly like the payload builder would. With an
    // explicit contract-v2 envelope the GET must also prove the stored
    // original/net shipping and expected provider payable.
    assertEditableMoneyEnvelope(snapshot, expected);
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
    expectedEnvelope: JubelioSalesExpectedEnvelope | null;
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
    if (input.expectedEnvelope) {
      // Contract v2: the GET must prove the STORED original/net shipping.
      // Missing fields and a Rp1 divergence both hold the next stage.
      const expected = input.expectedEnvelope;
      if (
        snapshot.originalShipmentCost === undefined ||
        snapshot.originalShipmentCost === null ||
        !moneyEquals(snapshot.originalShipmentCost, expected.originalShipmentCost)
      ) {
        return `confirmed original shipping ${String(snapshot.originalShipmentCost)} does not match the stored original shipping ${expected.originalShipmentCost}`;
      }
      if (
        snapshot.shippingCost === undefined ||
        snapshot.shippingCost === null ||
        !moneyEquals(snapshot.shippingCost, expected.shippingCost)
      ) {
        return `confirmed net shipping ${String(snapshot.shippingCost)} does not match the stored net shipping ${expected.shippingCost}`;
      }
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
      requestedSubTotal -
      requestedTotalDisc +
      requestedTotalTax +
      (input.expectedEnvelope?.shippingCost ?? 0);
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
    if (
      input.expectedEnvelope &&
      !moneyEquals(
        snapshot.grandTotal,
        input.expectedEnvelope.expectedProviderPayable
      )
    ) {
      return `confirmed grand total ${snapshot.grandTotal} does not match the stored provider payable ${input.expectedEnvelope.expectedProviderPayable}`;
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
    // ADDITIVE contract-v2 observation: only returned when the GET carried it,
    // so the legacy invoice snapshot shape stays exactly what it was.
    const paymentAmount = optionalNumber(body, ["payment_amount"]);
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
      ...(paymentAmount === null ? {} : { paymentAmount }),
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
    const invoices: JubelioPaymentInvoiceAssociation[] = [];
    for (const raw of rawLines) {
      const row = raw as Record<string, unknown>;
      const invoiceId = optionalNumber(row, ["invoice_id"]);
      const paymentAmount = optionalNumber(row, ["payment_amount", "amount"]);
      if (invoiceId === null || paymentAmount === null) continue; // tolerate unknown line shapes
      // ADDITIVE contract-v2 observations (evidence T1/T2): absent keys keep
      // the legacy association shape byte-for-byte.
      const grandTotal = optionalNumber(row, ["grand_total"]);
      const due = optionalNumber(row, ["due"]);
      invoices.push({
        invoiceId,
        paymentAmount,
        salesorderId: optionalNumber(row, ["salesorder_id"]),
        ...(grandTotal === null ? {} : { grandTotal }),
        ...(due === null ? {} : { due }),
      });
    }
    const accountId = optionalNumber(body, ["account_id"]);
    const paymentTypeValue = optionalNumber(body, ["payment_type"]);
    return {
      paymentId: parsedId,
      invoiceId: optionalNumber(body, ["invoice_id"]),
      contactId: optionalNumber(body, ["contact_id"]),
      amount,
      invoices,
      ...(accountId === null ? {} : { accountId }),
      ...(paymentTypeValue === null ? {} : { paymentType: paymentTypeValue }),
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
      // The version gate and the bounded v2 envelope are resolved BEFORE any
      // request: an unknown version never reaches login/POST.
      const expectedEnvelope = resolveContractEnvelope(input);
      const payload = buildSalesOrderPayload(input);
      const operationRef = operationLabel("sales_order_create", input.operationId);
      // Exactly one create POST; any failure is terminal for this attempt.
      // Create rides the read lane (5): the cancel POST (10) must stay the
      // highest-priority write so it can outrank reads and create.
      const { status, body } = await postOnce({
        path: "/sales/orders/",
        body: payload,
        priority: 5,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/orders/", status, body });
      }
      const salesOrderId = parsePositiveId(body);
      // Durable handle first: the confirmation GET may fail or the process may
      // crash, and the returned id is the only reconciliation path.
      await persistReturnedProviderId({
        hook: input.onSalesOrderId,
        providerId: salesOrderId,
        label: "sales order",
        ids: { salesOrderId },
      });
      let snapshot: JubelioSalesOrderSnapshot;
      try {
        snapshot = await readSalesOrderSnapshot(salesOrderId, 5);
      } catch (error) {
        // The create POST may have been applied; an unreadable/unverifiable
        // confirmation GET can never be treated as success.
        log.error(
          `Jubelio ${operationRef}: sales order ${salesOrderId} gagal dikonfirmasi, pembacaan ulang gagal`,
          safeDependencyErrorLog(error)
        );
        throw new JubelioSalesGatewayError(
          "Jubelio sales order confirmation read failed",
          { ambiguous: true, retryable: false, salesOrderId }
        );
      }
      const mismatch = confirmationMismatch({
        requested: input,
        snapshot,
        salesOrderId,
        expectedEnvelope,
      });
      if (mismatch) {
        log.error(
          `Jubelio ${operationRef}: sales order ${salesOrderId} tidak cocok dengan permintaan — ${mismatch}`
        );
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${salesOrderId} does not match the requested order: ${mismatch}`,
          { ambiguous: true, retryable: false, salesOrderId }
        );
      }
      log.info(
        `Jubelio ${operationRef}: sales order ${salesOrderId} dibuat dan terkonfirmasi`
      );
      return { salesOrderId, order: snapshot };
    },

    async getSalesOrder(salesOrderId) {
      return readSalesOrderSnapshot(salesOrderId, 5);
    },

    async getSalesOrderForEdit(salesOrderId, expected) {
      // Validate the supplied v2 envelope BEFORE the pre-read GET: an unknown
      // version must never reach the network.
      const validatedExpected = assertExpectedEnvelope(expected);
      const body = await readJson(`/sales/orders/${salesOrderId}`, 5);
      return parseSalesOrderEditSnapshot(salesOrderId, body, validatedExpected);
    },

    async editSalesOrder(input): Promise<JubelioSalesEditResult> {
      // Validate the supplied v2 envelope BEFORE any payload/POST: an unknown
      // version must never reach the wire (the builder re-asserts it).
      const validatedExpected = assertExpectedEnvelope(input.expected);
      const operationRef = operationLabel(
        "sales_order_channel_edit",
        input.operationId
      );
      // Payload construction is fail-closed BEFORE anything is sent (the
      // builder throws a non-ambiguous JubelioSalesGatewayError on any unsafe
      // snapshot — zero POST).
      const payload = buildSalesOrderEditPayload(
        input.edit,
        input.targetChannelStatus,
        validatedExpected
      );
      // Exactly one edit POST; rides the read lane (5): a channel mirror edit
      // must never outrank the cancel POST (10).
      const { status, body } = await postOnce({
        path: "/sales/orders/",
        body: payload,
        priority: 5,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/orders/", status, body });
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
        confirmed = parseSalesOrderEditSnapshot(
          salesOrderId,
          confirmBody,
          validatedExpected
        );
      } catch (error) {
        log.error(
          `Jubelio ${operationRef}: kanal sales order ${salesOrderId} gagal dikonfirmasi setelah edit, pembacaan ulang gagal`,
          safeDependencyErrorLog(error)
        );
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
        // `mismatch` can quote the RAW provider `channel_status` value, which
        // is arbitrary remote text (it may carry a customer name). The log
        // keeps a static summary plus the ids; the thrown error below still
        // carries the detailed business mismatch unchanged.
        log.error(
          `Jubelio ${operationRef}: edit kanal sales order ${salesOrderId} belum terkonfirmasi oleh GET pembanding`
        );
        throw new JubelioSalesGatewayError(
          `Jubelio sales order ${salesOrderId} edit is not confirmed: ${mismatch}`,
          { code: "EDIT_CONFIRM_MISMATCH", ambiguous: true, retryable: false }
        );
      }
      log.info(
        `Jubelio ${operationRef}: kanal sales order ${salesOrderId} diubah ke ${input.targetChannelStatus} dan terkonfirmasi`
      );
      return { salesOrderId, order: confirmed };
    },

    async cancelSalesOrder(input): Promise<JubelioSalesCancelResult> {
      const operationRef = operationLabel("sales_order_cancel", input.operationId);
      // Pre-invoice read: establishes current remote state before any write.
      const pre = await readSalesOrderSnapshot(input.salesOrderId, 5);
      if (pre.isCanceled) {
        log.info(
          `Jubelio ${operationRef}: sales order ${input.salesOrderId} sudah dibatalkan`
        );
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
        });
      } catch (error) {
        // A timeout/network failure may have applied the cancellation: the
        // outcome is unknown, so reconcile with a single confirmation GET.
        if (
          error instanceof JubelioSalesGatewayError &&
          error.options.ambiguous
        ) {
          log.error(
            `Jubelio ${operationRef}: hasil pembatalan sales order ${input.salesOrderId} belum pasti`,
            safeDependencyErrorLog(error)
          );
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
          });
        }
        if (status < 200 || status >= 300) {
          const error = writeRejection({
            path: "/sales/orders/cancel/",
            status,
            body,
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
        log.error(
          `Jubelio ${operationRef}: konfirmasi pembatalan sales order ${input.salesOrderId} gagal dibaca`,
          safeDependencyErrorLog(error)
        );
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
      log.info(
        `Jubelio ${operationRef}: sales order ${input.salesOrderId} dibatalkan dan terkonfirmasi`
      );
      return {
        salesOrderId: input.salesOrderId,
        alreadyCanceled: false,
        order: confirmed,
      };
    },

    async createInvoice(input): Promise<JubelioInvoiceCreateResult> {
      const operationRef = operationLabel(
        "sales_invoice_create",
        input.operationId
      );
      // Exactly one conversion POST; any failure is terminal for this attempt.
      // Conversion is a settlement write and rides the read lane (5): it must
      // never outrank the cancel POST (10).
      const { status, body } = await postOnce({
        path: "/sales/packlists/create-invoice",
        body: { salesorder_id: input.salesOrderId },
        priority: 5,
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({
          path: "/sales/packlists/create-invoice",
          status,
          body,
        });
      }
      // The response documents `{status, id}` where id is the Sales Invoice
      // Number. An unreadable id is AMBIGUOUS: the conversion may exist.
      const invoiceId = parsePositiveId(body);
      // Persist the conversion handle BEFORE the invoice/SO verification GETs.
      await persistReturnedProviderId({
        hook: input.onInvoiceId,
        providerId: invoiceId,
        label: "invoice",
        ids: { invoiceId },
      });
      let invoice: JubelioInvoiceSnapshot;
      try {
        const verified = await readJson(`/sales/invoices/${invoiceId}`, 5);
        invoice = parseInvoiceSnapshot(invoiceId, verified);
      } catch (error) {
        log.error(
          `Jubelio ${operationRef}: verifikasi invoice ${invoiceId} untuk sales order ${input.salesOrderId} gagal dibaca`,
          safeDependencyErrorLog(error)
        );
        // The conversion POST may have been applied; an unverifiable invoice
        // can never be treated as verified. Recovery is a GET of this id.
        throw new JubelioSalesGatewayError(
          "Jubelio invoice verification read failed",
          { code: "INVOICE_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false, invoiceId }
        );
      }
      // Cross-check the linkage on the SALES ORDER: the invoice GET exposes
      // the SO only via salesorder_no (salesorder_id is null at runtime),
      // while the SO GET carries invoice_id after conversion.
      let order: JubelioSalesOrderSnapshot;
      try {
        order = await readSalesOrderSnapshot(input.salesOrderId, 5);
      } catch (error) {
        log.error(
          `Jubelio ${operationRef}: tautan invoice ${invoiceId} ke sales order ${input.salesOrderId} gagal dibaca`,
          safeDependencyErrorLog(error)
        );
        throw new JubelioSalesGatewayError(
          "Jubelio invoice linkage read failed",
          { code: "INVOICE_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false, invoiceId }
        );
      }
      const mismatch = invoiceLinkageMismatch({ invoice, order });
      if (mismatch) {
        log.error(
          `Jubelio ${operationRef}: invoice ${invoiceId} tidak cocok dengan sales order ${input.salesOrderId} — ${mismatch}`
        );
        throw new JubelioSalesGatewayError(
          `Jubelio invoice ${invoiceId} does not match the converted sales order: ${mismatch}`,
          { code: "INVOICE_VERIFY_MISMATCH", ambiguous: true, retryable: false, invoiceId }
        );
      }
      log.info(
        `Jubelio ${operationRef}: invoice ${invoiceId} dibuat dan tertaut ke sales order ${input.salesOrderId}`
      );
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
      const operationRef = operationLabel(
        "sales_payment_create",
        input.operationId
      );
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
      });
      if (status < 200 || status >= 300) {
        throw writeRejection({ path: "/sales/payments/", status, body });
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
      // Persist the payment handle BEFORE the payment verification GET.
      await persistReturnedProviderId({
        hook: input.onPaymentId,
        providerId: paymentId,
        label: "payment",
        ids: { paymentId },
      });
      let snapshot: JubelioPaymentSnapshot;
      try {
        const verified = await readJson(`/sales/payments/${paymentId}`, 5);
        snapshot = parsePaymentSnapshot(paymentId, verified);
      } catch (error) {
        log.error(
          `Jubelio ${operationRef}: verifikasi payment ${paymentId} untuk invoice ${payment.invoiceId} gagal dibaca`,
          safeDependencyErrorLog(error)
        );
        throw new JubelioSalesGatewayError(
          "Jubelio payment verification read failed",
          { code: "PAYMENT_CONFIRMATION_READ_FAILED", ambiguous: true, retryable: false, paymentId }
        );
      }
      const mismatch = paymentLinkageMismatch({
        payment: snapshot,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
      });
      if (mismatch) {
        log.error(
          `Jubelio ${operationRef}: payment ${paymentId} tidak cocok dengan invoice ${payment.invoiceId} — ${mismatch}`
        );
        throw new JubelioSalesGatewayError(
          `Jubelio payment ${paymentId} does not match the verified invoice: ${mismatch}`,
          { code: "PAYMENT_VERIFY_MISMATCH", ambiguous: true, retryable: false, paymentId }
        );
      }
      log.info(
        `Jubelio ${operationRef}: payment ${paymentId} dibuat dan tertaut ke invoice ${payment.invoiceId}`
      );
      return { paymentId, payment: snapshot };
    },

    async getPayment(paymentId) {
      const body = await readJson(`/sales/payments/${paymentId}`, 5);
      return parsePaymentSnapshot(paymentId, body);
    },
  };
}