import { deleteRetainedOrderFixtures } from "@marketplace/db/src/testing/retained-order-fixtures";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env") });
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import {
  JubelioSalesGatewayError,
  type JubelioSalesGateway,
  type JubelioInvoiceSnapshot,
  type JubelioPaymentSnapshot,
  type JubelioSalesOrderSnapshot,
} from "./jubelio-sales-client";
import {
  getJubelioSalesOperation,
  type JubelioSalesOperation,
} from "./jubelio-sales-operations";
import type {
  JubelioSalesOrderCreateRequest,
  JubelioSalesOrderCreateRequestLegacy,
  JubelioSalesOrderCreateRequestV2,
  PricingSnapshotPayloadV1,
} from "@marketplace/db/src/schema";

const {
  db,
  branchStocks,
  branches,
  clients,
  jubelioSalesOperations,
  orderItems,
  orders,
  products,
  productVariants,
} = await import("@/db");
const {
  dispatchJubelioSalesCreate,
  ensureJubelioInvoice,
  ensureJubelioPayment,
  setDefaultJubelioSalesGateway,
} = await import("./jubelio-sales-lifecycle");
const { settleJubelioSalesOrder } = await import("./jubelio-sales-settlement");

// =========================================================
// Integration seam lane C (ticket01): provider operation ledger → dispatch /
// recovery → verified provider payable.
//
// Real PostgreSQL (disposable DATABASE_URL) + controlled external gateway
// fakes. No internal module is mocked; every assertion goes through the public
// interface (`settleJubelioSalesOrder`, `ensureJubelioInvoice`,
// `ensureJubelioPayment`, `getJubelioSalesOperation`, order reads).
//
// Independent literals come from the approved spec §4.4 and evidence T1/T2:
// goods 150000 + net ongkir 30000 → expected provider payable 180000,
// invoice/payment 180000, website total 196500 (PPN 16500). A v2 settlement
// must NEVER fall back to `orders.subtotal` (150000).
//
// Two IMMUTABLE stored records must agree (spec §8.3 + §10.2):
//   1. the order row's versioned pricing snapshot (pricing1/engine1/provider2
//      + financial snapshot), and
//   2. the frozen Sales create intent in the operation ledger
//      (`payload.create`, contract v2).
// Neither record is recomputed from master/config; a disagreement, a missing
// version or an unknown version holds the next stage.
// =========================================================

const TEST_PREFIX = `sales-v2-${crypto.randomUUID()}`;
const clientId = `${TEST_PREFIX}-client`;
const branchId = `${TEST_PREFIX}-branch`;
const productId = `${TEST_PREFIX}-product`;
const variantId = `${TEST_PREFIX}-variant`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SO_ID = 684_410;
const INVOICE_ID = 459_710;
const PAYMENT_ID = 710_001;
const CONTACT_ID = -1;
const LOCATION_ID = 15;
const ITEM_ID = 101_187;
const GOODS = 150_000;
const SHIPPING = 30_000; // original ongkir before any subsidy
const PROVIDER_PAYABLE = 180_000; // goods 150000 + net ongkir 30000
const PPN = 16_500; // 11% of net goods only (fixture rate, not policy)
// Website total (goods + PPN + net ongkir, no service fee) = 196500; the public
// `orders` read returns it as numeric(15,2) → "196500.00".

const url = process.env.DATABASE_URL;

async function schemaReady(): Promise<{ ready: boolean; blocker?: string }> {
  if (!url) return { ready: false, blocker: "DATABASE_URL is not configured" };
  try {
    const probe = new Pool({ connectionString: url, max: 1 });
    const result = await probe.query(
      "select to_regclass('public.jubelio_sales_operation') is not null as ops, to_regclass('public.orders') is not null as orders"
    );
    await probe.end();
    if (result.rows[0]?.ops !== true || result.rows[0]?.orders !== true) {
      return {
        ready: false,
        blocker:
          "jubelio_sales_operation/orders tables not found — apply the shared schema to the disposable database first",
      };
    }
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      blocker: error instanceof Error ? error.message : String(error),
    };
  }
}

const schemaState = await schemaReady();
if (!schemaState.ready) {
  console.warn(
    `[jubelio-sales-versioned.db] versioned settlement tests NOT run (skipped, not green) — exact blocker: ${schemaState.blocker}`
  );
}

// A visible blocker: a skipped DB file must never look like a pass.
it.skipIf(schemaState.ready)(
  "environment blocker: versioned provider settlement NOT verified (requires PostgreSQL)",
  () => {
    throw new Error(
      `Versioned settlement tests NOT run — durable provider payable semantics remain UNVERIFIED. Exact blocker: ${schemaState.blocker}`
    );
  }
);

// Deterministic fake-provider configuration (evidence T1/T2: account 2, type 0)
// and a clean default gateway between tests. These are external-environment
// boundaries only; the legacy branch logic is never changed to compensate.
beforeEach(() => {
  vi.stubEnv("JUBELIO_PAYMENT_ACCOUNT_ID", "2");
  vi.stubEnv("JUBELIO_PAYMENT_TYPE", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDefaultJubelioSalesGateway(null);
});

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

async function seedCatalog(): Promise<void> {
  await db.insert(clients).values({
    id: clientId,
    name: "Versioned Settlement Fixture",
    email: `${clientId}@example.test`,
    emailVerified: true,
  });
  await db.insert(branches).values({
    id: branchId,
    code: TEST_PREFIX,
    name: "Versioned Settlement Fixture",
    city: "Test",
    address: "Test",
  });
  await db.insert(products).values({
    id: productId,
    slug: TEST_PREFIX,
    name: "Versioned Settlement Fixture",
    basePrice: String(GOODS),
  });
  await db.insert(productVariants).values({
    id: variantId,
    productId,
    sku: TEST_PREFIX,
    price: String(GOODS),
  });
  await db.insert(branchStocks).values({
    branchId,
    productVariantId: variantId,
    availableStock: 5,
    pendingRemoteStock: 1,
  });
}

/**
 * Immutable pricing snapshot of the new contract (pricing1/engine1/provider2).
 * Literal money only — the same independent values the create intent carries.
 */
function pricingSnapshotV1(input: { subsidy: number }): PricingSnapshotPayloadV1 {
  const netShipping = SHIPPING - input.subsidy;
  const payable = GOODS + netShipping;
  return {
    pricingContractVersion: 1,
    pricingEngineVersion: 1,
    providerContractVersion: 2,
    currency: "IDR",
    fulfillmentMethod: "delivery",
    sourceGoodsSubtotal: String(GOODS),
    markdownTotal: "0",
    subtotal: String(GOODS),
    goodsDiscount: "0",
    netGoods: String(GOODS),
    shippingBeforeSubsidy: String(SHIPPING),
    shippingSubsidy: String(input.subsidy),
    shippingCost: String(netShipping),
    merchantFunding: String(input.subsidy),
    serviceFee: "0",
    taxableBase: String(GOODS),
    ppnRatePercent: "11",
    ppnAmount: String(PPN),
    total: String(GOODS + PPN + netShipping),
    expectedProviderPayable: String(payable),
    providerQuotedShippingCost: String(SHIPPING),
    providerBilledShippingCost: null,
    lines: [
      {
        variantId,
        quantity: 1,
        sourceUnitPrice: String(GOODS),
        effectiveUnitPrice: String(GOODS),
        sourceLineAmount: String(GOODS),
        markdownAmount: "0",
        goodsDiscountAmount: "0",
        netLineAmount: String(GOODS),
        markdownRevisionId: null,
      },
    ],
  };
}

type SeedOrderInput = {
  id: string;
  /** `v1` = new-contract row; `legacy` = pre-contract `0/0/0` row. */
  pricing?: "v1" | "legacy";
  status?: string;
  paymentStatus?: string;
  invoiceId?: number | null;
  blockedReason?: string | null;
  /** v1 only: ongkir subsidy in Rupiah (0 = no subsidy). */
  subsidy?: number;
  /** Known remote SO pointer; null for an order whose create is not confirmed. */
  linkedSalesOrderId?: number | null;
};

/**
 * Paid delivery order fixture. The provider payable is NEVER derived from
 * `orders.subtotal`; for a `v1` row it is the stored financial snapshot, and
 * the v2 create intent must agree with it.
 */
async function seedOrder(input: SeedOrderInput): Promise<void> {
  const subsidy = input.subsidy ?? 0;
  const netShipping = SHIPPING - subsidy;
  const payable = GOODS + netShipping;
  const total = GOODS + PPN + netShipping;
  const legacy = input.pricing === "legacy";
  await db.insert(orders).values({
    id: input.id,
    userId: clientId,
    branchId,
    contactPhone: "08123456789",
    contactEmail: `${clientId}@example.test`,
    subtotal: String(GOODS),
    shippingCost: String(netShipping),
    ppnRate: "11",
    ppnAmount: String(PPN),
    total: String(total),
    status: input.status ?? "processing",
    paymentStatus: input.paymentStatus ?? "paid",
    fulfillmentMethod: "delivery",
    fulfillmentBlockedReason: input.blockedReason ?? null,
    jubelioSalesOrderId:
      input.linkedSalesOrderId === undefined ? SO_ID : input.linkedSalesOrderId,
    ...(input.invoiceId != null ? { jubelioInvoiceId: input.invoiceId } : {}),
    ...(legacy
      ? {}
      : {
          pricingContractVersion: 1,
          pricingEngineVersion: 1,
          providerContractVersion: 2,
          pricingCurrency: "IDR",
          sourceGoodsSubtotal: String(GOODS),
          markdownTotal: "0",
          netGoods: String(GOODS),
          shippingBeforeSubsidy: String(SHIPPING),
          shippingSubsidy: String(subsidy),
          merchantFunding: String(subsidy),
          taxableBase: String(GOODS),
          expectedProviderPayable: String(payable),
          providerQuotedShippingCost: String(SHIPPING),
          pricingSnapshot: pricingSnapshotV1({ subsidy }),
        }),
  });
}

function v2CreateRequest(
  note: string,
  input: { subsidy?: number } = {}
): JubelioSalesOrderCreateRequestV2 {
  const subsidy = input.subsidy ?? 0;
  return {
    contactId: CONTACT_ID,
    customerName: "Pelanggan Umum",
    locationId: LOCATION_ID,
    note,
    providerContractVersion: 2,
    originalShipmentCost: SHIPPING,
    shippingCost: SHIPPING - subsidy,
    expectedProviderPayable: GOODS + SHIPPING - subsidy,
    items: [
      {
        itemId: ITEM_ID,
        quantity: 1,
        price: GOODS,
        discAmount: 0,
        taxAmount: 0,
        unit: "Buah",
        taxId: 1,
      },
    ],
  };
}

function legacyCreateRequest(note: string): JubelioSalesOrderCreateRequestLegacy {
  return {
    contactId: CONTACT_ID,
    customerName: "Pelanggan Umum",
    locationId: LOCATION_ID,
    note,
    items: [
      {
        itemId: ITEM_ID,
        quantity: 1,
        price: GOODS,
        discAmount: 0,
        taxAmount: 0,
        unit: "Buah",
        taxId: 1,
      },
    ],
  };
}

async function seedConfirmedCreateOp(
  orderId: string,
  create: JubelioSalesOrderCreateRequest
): Promise<void> {
  await db.insert(jubelioSalesOperations).values({
    id: `${orderId}-create`,
    orderId,
    type: "create",
    status: "confirmed",
    reference: `${orderId}-create`,
    salesOrderId: SO_ID,
    holdAccountedAt: new Date(),
    payload: { type: "create", create },
  });
}

// ---------------------------------------------------------
// Controlled external gateway (system boundary only)
// ---------------------------------------------------------

type FakeProviderSpec = {
  orderId: string;
  invoiceSubTotal: number;
  invoiceGrandTotal: number;
  /** `payment_amount` observed on a PAID invoice GET (omitted when undefined). */
  invoicePaidAmount?: number;
  paymentAmount: number;
  paymentLine: { paymentAmount: number; grandTotal?: number; due?: number };
  /**
   * Observed `salesorder_id` on the payment association line (DTO spelling:
   * `salesorderId`). Default `SO_ID`; set to another id to prove the linkage
   * guard actually reads the observed association.
   */
  associationSalesOrderId?: number | null;
  paymentAccountId?: number;
  paymentType?: number;
  failPaymentGet?: boolean;
  /**
   * Simulate a returned id that could NOT be persisted before verification:
   * one POST happened, the id is only known through the gateway error.
   */
  failBeforeInvoiceHook?: boolean;
};

type FakeProvider = {
  gateway: JubelioSalesGateway;
  invoicePosts: Array<{ salesOrderId: number }>;
  paymentPosts: Array<{
    invoiceId: number;
    amount: number;
    accountId: number;
    paymentType: number;
  }>;
  createPosts: Array<{ note: string; expectedProviderPayable?: number }>;
  /** Ledger rows observed inside the awaited persistence hook. */
  ledgerAtHook: {
    create?: JubelioSalesOperation | null;
    invoice?: JubelioSalesOperation | null;
    payment?: JubelioSalesOperation | null;
  };
};

function invoiceSnapshot(
  spec: FakeProviderSpec,
  paidAmount: number | undefined
): JubelioInvoiceSnapshot {
  return {
    invoiceId: INVOICE_ID,
    invoiceNo: "INV-000459710",
    // Runtime shape: the invoice GET exposes the SO link only via the SO GET.
    salesorderId: null,
    contactId: CONTACT_ID,
    locationId: LOCATION_ID,
    subTotal: spec.invoiceSubTotal,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: spec.invoiceGrandTotal,
    isCanceled: false,
    items: [
      { itemId: ITEM_ID, quantity: 1, price: GOODS, amount: GOODS, unit: "Buah" },
    ],
    ...(paidAmount === undefined ? {} : { paymentAmount: paidAmount }),
  };
}

function paymentSnapshot(spec: FakeProviderSpec): JubelioPaymentSnapshot {
  return {
    paymentId: PAYMENT_ID,
    invoiceId: INVOICE_ID,
    contactId: CONTACT_ID,
    amount: spec.paymentAmount,
    invoices: [
      {
        invoiceId: INVOICE_ID,
        salesorderId:
          spec.associationSalesOrderId === undefined
            ? SO_ID
            : spec.associationSalesOrderId,
        ...spec.paymentLine,
      },
    ],
    ...(spec.paymentAccountId === undefined
      ? {}
      : { accountId: spec.paymentAccountId }),
    ...(spec.paymentType === undefined ? {} : { paymentType: spec.paymentType }),
  };
}

function salesOrderSnapshot(invoiced: boolean): JubelioSalesOrderSnapshot {
  return {
    salesorderId: SO_ID,
    salesorderNo: "SO-000684410",
    source: 1,
    refNo: "",
    contactId: CONTACT_ID,
    customerName: "Pelanggan Umum",
    locationId: LOCATION_ID,
    note: `${TEST_PREFIX}-note`,
    isCanceled: false,
    invoiceId: invoiced ? INVOICE_ID : null,
    channelStatus: "Belum Bayar",
    subTotal: GOODS,
    totalDisc: 0,
    totalTax: 0,
    grandTotal: PROVIDER_PAYABLE,
    originalShipmentCost: SHIPPING,
    shippingCost: SHIPPING,
    items: [
      { itemId: ITEM_ID, quantity: 1, price: GOODS, amount: GOODS, unit: "Buah" },
    ],
  };
}

function fakeProvider(spec: FakeProviderSpec): FakeProvider {
  const invoicePosts: FakeProvider["invoicePosts"] = [];
  const paymentPosts: FakeProvider["paymentPosts"] = [];
  const createPosts: FakeProvider["createPosts"] = [];
  const ledgerAtHook: FakeProvider["ledgerAtHook"] = {};

  const gateway = {
    async createSalesOrder(input: {
      note: string;
      expectedProviderPayable?: number;
      onSalesOrderId?: (providerId: number) => Promise<void> | void;
    }) {
      createPosts.push({
        note: input.note,
        expectedProviderPayable: input.expectedProviderPayable,
      });
      // The real gateway awaits the caller's hook BEFORE its verification GET.
      await input.onSalesOrderId?.(SO_ID);
      ledgerAtHook.create = await getJubelioSalesOperation(db, {
        orderId: spec.orderId,
        type: "create",
      });
      return { salesOrderId: SO_ID, order: salesOrderSnapshot(false) };
    },
    async getSalesOrder() {
      return salesOrderSnapshot(true);
    },
    async createInvoice(input: {
      salesOrderId: number;
      onInvoiceId?: (providerId: number) => Promise<void> | void;
    }) {
      invoicePosts.push({ salesOrderId: input.salesOrderId });
      if (spec.failBeforeInvoiceHook === true) {
        // The returned id is known but was NOT persisted by the caller yet.
        throw new JubelioSalesGatewayError(
          "returned invoice id could not be persisted before verification",
          {
            code: "RETURNED_ID_PERSIST_FAILED",
            ambiguous: true,
            retryable: false,
            invoiceId: INVOICE_ID,
          }
        );
      }
      await input.onInvoiceId?.(INVOICE_ID);
      ledgerAtHook.invoice = await getJubelioSalesOperation(db, {
        orderId: spec.orderId,
        type: "invoice",
      });
      return { invoiceId: INVOICE_ID, invoice: invoiceSnapshot(spec, undefined) };
    },
    async getInvoice() {
      return invoiceSnapshot(spec, spec.invoicePaidAmount);
    },
    async createInvoicePayment(input: {
      payment: {
        invoiceId: number;
        amount: number;
        accountId: number;
        paymentType: number;
      };
      onPaymentId?: (providerId: number) => Promise<void> | void;
    }) {
      paymentPosts.push({
        invoiceId: input.payment.invoiceId,
        amount: input.payment.amount,
        accountId: input.payment.accountId,
        paymentType: input.payment.paymentType,
      });
      await input.onPaymentId?.(PAYMENT_ID);
      ledgerAtHook.payment = await getJubelioSalesOperation(db, {
        orderId: spec.orderId,
        type: "payment",
      });
      if (spec.failPaymentGet === true) {
        // Runtime shape: the payment POST is followed by an independent GET,
        // whose failure is ambiguous and never retried.
        throw new JubelioSalesGatewayError(
          "Jubelio payment verification read failed",
          {
            code: "PAYMENT_CONFIRMATION_READ_FAILED",
            ambiguous: true,
            retryable: false,
            paymentId: PAYMENT_ID,
          }
        );
      }
      return { paymentId: PAYMENT_ID, payment: paymentSnapshot(spec) };
    },
    async getPayment() {
      if (spec.failPaymentGet === true) {
        throw new JubelioSalesGatewayError("payment GET failed", {
          code: "PAYMENT_CONFIRMATION_READ_FAILED",
          ambiguous: true,
          retryable: false,
        });
      }
      return paymentSnapshot(spec);
    },
  } as unknown as JubelioSalesGateway;

  return { gateway, invoicePosts, paymentPosts, createPosts, ledgerAtHook };
}

/** The observed provider payable (the exact v2 expectation, never the subtotal). */
function v2ProviderSpec(orderId: string): FakeProviderSpec {
  return {
    orderId,
    invoiceSubTotal: GOODS,
    invoiceGrandTotal: PROVIDER_PAYABLE,
    invoicePaidAmount: PROVIDER_PAYABLE,
    paymentAmount: PROVIDER_PAYABLE,
    paymentLine: {
      paymentAmount: PROVIDER_PAYABLE,
      grandTotal: PROVIDER_PAYABLE,
      due: 0,
    },
    paymentAccountId: 2,
    paymentType: 0,
  };
}

await seedCatalog();

afterAll(async () => {
  setDefaultJubelioSalesGateway(null);
  const fixtureOrders = await pool.query("SELECT id FROM orders WHERE user_id=$1", [clientId]);
  await deleteRetainedOrderFixtures(pool, fixtureOrders.rows.map((row) => row.id));
  await pool.query('DELETE FROM "client" WHERE id = $1', [clientId]);
  await pool.query('DELETE FROM "product" WHERE id = $1', [productId]);
  await pool.query('DELETE FROM "branch" WHERE id = $1', [branchId]);
  await pool.end();
});

describe.skipIf(!schemaState.ready)(
  "Jubelio provider settlement uses the stored expected payable (PostgreSQL)",
  () => {
    it("persists the returned sales order id durably BEFORE the verification GET", async () => {
      // Ticket01 §10.2: the returned SO id must survive a crash between the
      // POST and the independent GET.
      const orderId = `${TEST_PREFIX}-create`;
      await seedOrder({
        id: orderId,
        status: "pending_payment",
        paymentStatus: "pending",
        linkedSalesOrderId: null,
      });
      await db.insert(orderItems).values({
        id: `${orderId}-item`,
        orderId,
        variantId,
        productName: "Versioned Settlement Fixture",
        quantity: 1,
        price: String(GOODS),
      });
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const result = await dispatchJubelioSalesCreate({
        orderId,
        create: v2CreateRequest(`${orderId}-note`),
        gateway: provider.gateway,
      });

      expect(result).toEqual({ status: "confirmed", salesOrderId: SO_ID });
      // Observed THROUGH the public ledger read, inside the awaited hook.
      expect(provider.createPosts).toHaveLength(1);
      expect(provider.ledgerAtHook.create).toMatchObject({
        status: "dispatched_unknown",
        salesOrderId: SO_ID,
      });
      const ledger = await getJubelioSalesOperation(db, {
        orderId,
        type: "create",
      });
      expect(ledger).toMatchObject({ status: "confirmed", salesOrderId: SO_ID });
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.jubelioSalesOrderId).toBe(SO_ID);
      expect(provider.createPosts[0].expectedProviderPayable).toBe(
        PROVIDER_PAYABLE
      );
    });

    it("settles a delivery order at 180000 (goods 150000 + ongkir 30000), not at the 150000 subtotal", async () => {
      const orderId = `${TEST_PREFIX}-v2-normal`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider(v2ProviderSpec(orderId));
      setDefaultJubelioSalesGateway(provider.gateway);

      expect(await settleJubelioSalesOrder(orderId)).toEqual({
        status: "fulfilled",
        pickupCode: null,
      });
      // Replay: the committed ledger converges, never a second provider write.
      expect((await settleJubelioSalesOrder(orderId)).status).toBe("fulfilled");

      expect(provider.invoicePosts).toEqual([{ salesOrderId: SO_ID }]);
      expect(provider.paymentPosts).toHaveLength(1);
      expect(provider.paymentPosts[0]).toEqual({
        invoiceId: INVOICE_ID,
        amount: PROVIDER_PAYABLE,
        accountId: 2,
        paymentType: 0,
      });
      // Both returned ids were durable BEFORE their verification GET.
      expect(provider.ledgerAtHook.invoice).toMatchObject({
        status: "dispatched_unknown",
        invoiceId: INVOICE_ID,
      });
      expect(provider.ledgerAtHook.payment).toMatchObject({
        status: "dispatched_unknown",
        paymentId: PAYMENT_ID,
      });

      const invoiceOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "invoice",
      });
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(invoiceOp?.status).toBe("confirmed");
      expect(invoiceOp?.invoiceId).toBe(INVOICE_ID);
      expect(paymentOp?.status).toBe("confirmed");
      expect(paymentOp?.paymentId).toBe(PAYMENT_ID);

      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.paymentStatus).toBe("paid");
      expect(row.status).toBe("processing");
      expect(row.fulfillmentBlockedReason).toBeNull();
      expect(row.jubelioInvoiceId).toBe(INVOICE_ID);
      expect(row.jubelioPaymentId).toBe(PAYMENT_ID);
      // Website money is untouched by the provider settlement.
      // numeric(15,2) public read: independent literal 196500, scale 2.
      expect(row.total).toBe("196500.00");
    });

    it("recovers a manual-review v2 payment by GET against the stored payable and account/type intent", async () => {
      const orderId = `${TEST_PREFIX}-v2-recovery`;
      await seedOrder({
        id: orderId,
        invoiceId: INVOICE_ID,
        blockedReason: "payment verification blocked",
      });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      await db.insert(jubelioSalesOperations).values([
        {
          id: `${orderId}-invoice`,
          orderId,
          type: "invoice",
          status: "confirmed",
          reference: `${orderId}-invoice`,
          salesOrderId: SO_ID,
          invoiceId: INVOICE_ID,
          payload: { type: "invoice", invoice: { salesOrderId: SO_ID } },
        },
        {
          id: `${orderId}-payment`,
          orderId,
          type: "payment",
          status: "manual_review",
          reference: `${orderId}-payment`,
          salesOrderId: SO_ID,
          invoiceId: INVOICE_ID,
          paymentId: PAYMENT_ID,
          lastError: "payment verification blocked",
          payload: {
            type: "payment",
            payment: {
              invoiceId: INVOICE_ID,
              accountId: 2,
              amount: PROVIDER_PAYABLE,
              contactId: CONTACT_ID,
              contactName: "Customer",
              paymentType: 0,
              note: `${orderId}-payment`,
            },
          },
        },
      ]);
      const provider = fakeProvider(v2ProviderSpec(orderId));
      setDefaultJubelioSalesGateway(provider.gateway);

      const outcome = await settleJubelioSalesOrder(orderId, {
        readOnlyRecovery: true,
      });

      expect(outcome).toEqual({ status: "fulfilled", pickupCode: null });
      // GET-only recovery: zero conversion/payment POST.
      expect(provider.invoicePosts).toHaveLength(0);
      expect(provider.paymentPosts).toHaveLength(0);
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(paymentOp?.status).toBe("confirmed");
      expect(paymentOp?.paymentId).toBe(PAYMENT_ID);
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.jubelioPaymentId).toBe(PAYMENT_ID);
      expect(row.fulfillmentBlockedReason).toBeNull();
    });

    it("holds a v2 payment whose observed amount diverges by Rp1, with no confirmed pointer", async () => {
      const orderId = `${TEST_PREFIX}-v2-mismatch`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider({
        ...v2ProviderSpec(orderId),
        paymentAmount: PROVIDER_PAYABLE - 1,
        paymentLine: {
          paymentAmount: PROVIDER_PAYABLE - 1,
          grandTotal: PROVIDER_PAYABLE - 1,
          due: 1,
        },
      });

      expect(
        (await ensureJubelioInvoice({ orderId, gateway: provider.gateway }))
          .status
      ).toBe("confirmed");
      const payment = await ensureJubelioPayment({
        orderId,
        gateway: provider.gateway,
      });

      expect(payment.status).toBe("manual_review");
      // The request itself carries the stored expected payable (180000); the
      // provider observation diverged, so nothing is confirmed or fulfilled.
      expect(provider.paymentPosts).toHaveLength(1);
      expect(provider.paymentPosts[0].amount).toBe(PROVIDER_PAYABLE);
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(paymentOp?.status).toBe("manual_review");
      // The known id stays reconcilable by GET.
      expect(paymentOp?.paymentId).toBe(PAYMENT_ID);
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.jubelioPaymentId).toBeNull();
      expect(row.paymentStatus).toBe("paid");
    });

    it("holds a v2 payment whose association belongs to a different sales order", async () => {
      // Linkage guard must read the OBSERVED association (`salesorderId`) of the
      // payment GET. An association pointing at another sales order can never
      // confirm the payment or set the local confirmed pointer.
      const orderId = `${TEST_PREFIX}-v2-wrong-association`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider({
        ...v2ProviderSpec(orderId),
        associationSalesOrderId: SO_ID + 1,
      });

      expect(
        (await ensureJubelioInvoice({ orderId, gateway: provider.gateway }))
          .status
      ).toBe("confirmed");
      const payment = await ensureJubelioPayment({
        orderId,
        gateway: provider.gateway,
      });

      expect(payment.status).toBe("manual_review");
      expect(provider.paymentPosts).toHaveLength(1);
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(paymentOp?.status).toBe("manual_review");
      expect(paymentOp?.paymentId).toBe(PAYMENT_ID);
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.jubelioPaymentId).toBeNull();
      expect(row.paymentStatus).toBe("paid");
    });

    it("fails closed after a failed payment GET without a second write", async () => {
      const orderId = `${TEST_PREFIX}-v2-get-fail`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider({
        ...v2ProviderSpec(orderId),
        failPaymentGet: true,
      });

      expect(
        (await ensureJubelioInvoice({ orderId, gateway: provider.gateway }))
          .status
      ).toBe("confirmed");
      const payment = await ensureJubelioPayment({
        orderId,
        gateway: provider.gateway,
      });

      expect(payment.status).toBe("manual_review");
      expect(provider.paymentPosts).toHaveLength(1);
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(paymentOp?.status).toBe("manual_review");
      expect(paymentOp?.paymentId).toBe(PAYMENT_ID);
    });

    it("fails closed on an unknown persisted provider contract version without any write", async () => {
      const orderId = `${TEST_PREFIX}-v2-unknown`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, {
        ...v2CreateRequest(`${orderId}-note`),
        providerContractVersion: 3,
      } as unknown as JubelioSalesOrderCreateRequest);
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(0);
      expect(
        await getJubelioSalesOperation(db, { orderId, type: "invoice" })
      ).toBeNull();
    });

    it("never downgrades an explicit null version to the legacy branch", async () => {
      const orderId = `${TEST_PREFIX}-v2-null`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, {
        ...v2CreateRequest(`${orderId}-note`),
        providerContractVersion: null,
      } as unknown as JubelioSalesOrderCreateRequest);
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(0);
      expect(
        await getJubelioSalesOperation(db, { orderId, type: "invoice" })
      ).toBeNull();
    });

    it("fails closed when the v2 intent has no matching versioned order snapshot", async () => {
      // A v2 provider intent on a legacy 0/0/0 order row is not a legitimate
      // pair: the immutable order financial snapshot is missing.
      const orderId = `${TEST_PREFIX}-v2-missing-row-version`;
      await seedOrder({ id: orderId, pricing: "legacy" });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(0);
      expect(
        await getJubelioSalesOperation(db, { orderId, type: "invoice" })
      ).toBeNull();
    });

    it("fails closed when the order snapshot and the stored intent disagree on the payable", async () => {
      // Order row carries a 10000 ongkir subsidy → snapshot payable 170000,
      // while the frozen create intent still says 180000. Both stored records
      // must agree; neither is trusted alone.
      const orderId = `${TEST_PREFIX}-v2-intent-drift`;
      await seedOrder({ id: orderId, subsidy: 10_000 });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(0);
      expect(
        await getJubelioSalesOperation(db, { orderId, type: "invoice" })
      ).toBeNull();
    });

    it("fails closed when the stored expected payable does not match its own line arithmetic", async () => {
      const orderId = `${TEST_PREFIX}-v2-payable-drift`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, {
        ...v2CreateRequest(`${orderId}-note`),
        expectedProviderPayable: PROVIDER_PAYABLE - 1,
      });
      const provider = fakeProvider(v2ProviderSpec(orderId));

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(0);
    });

    it("never confirms when the returned invoice id could not be persisted before verification", async () => {
      const orderId = `${TEST_PREFIX}-v2-persist-fail`;
      await seedOrder({ id: orderId });
      await seedConfirmedCreateOp(orderId, v2CreateRequest(`${orderId}-note`));
      const provider = fakeProvider({
        ...v2ProviderSpec(orderId),
        failBeforeInvoiceHook: true,
      });

      const invoice = await ensureJubelioInvoice({
        orderId,
        gateway: provider.gateway,
      });

      expect(invoice.status).toBe("manual_review");
      expect(provider.invoicePosts).toHaveLength(1);
      const invoiceOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "invoice",
      });
      // The known id survives for GET reconciliation; no confirmed pointer.
      expect(invoiceOp).toMatchObject({
        status: "manual_review",
        invoiceId: INVOICE_ID,
      });
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(row.jubelioInvoiceId).toBeNull();
    });

    it("keeps legacy (unversioned) settlement on the order subtotal, unchanged", async () => {
      const orderId = `${TEST_PREFIX}-legacy`;
      await seedOrder({ id: orderId, pricing: "legacy" });
      await seedConfirmedCreateOp(
        orderId,
        legacyCreateRequest(`${orderId}-note`)
      );
      const provider = fakeProvider({
        orderId,
        // Legacy envelope: no provider shipping field, so the legacy payable
        // is the pre-PPN subtotal (150000), exactly as before contract v2.
        invoiceSubTotal: GOODS,
        invoiceGrandTotal: GOODS,
        paymentAmount: GOODS,
        paymentLine: { paymentAmount: GOODS },
      });
      setDefaultJubelioSalesGateway(provider.gateway);

      expect(await settleJubelioSalesOrder(orderId)).toEqual({
        status: "fulfilled",
        pickupCode: null,
      });

      expect(provider.paymentPosts).toHaveLength(1);
      expect(provider.paymentPosts[0]).toMatchObject({
        invoiceId: INVOICE_ID,
        amount: GOODS,
      });
      const paymentOp = await getJubelioSalesOperation(db, {
        orderId,
        type: "payment",
      });
      expect(paymentOp?.status).toBe("confirmed");
    });
  }
);
