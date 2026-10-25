import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { orders } from "./orders";
import { checkoutAttempts } from "./checkout";

/**
 * Durable Jubelio sales-order operation ledger (plan:
 * jubelio-sales-api-switching, Gate C.1 — feature 3 "SO create/cancel gateway
 * and durable recovery").
 *
 * Safety contract:
 * - The intent row is persisted BEFORE any POST to the real Jubelio gateway.
 * - `claimJubelioSalesOperationForDispatch` (apps/store/src/lib/
 *   jubelio-sales-operations.ts) grants the single POST permission through ONE
 *   atomic conditional UPDATE ... WHERE status = 'intent' ... RETURNING.
 *   A claimed operation becomes `dispatched_unknown`: the write may already
 *   have been applied remotely, so replay (crash, retry, duplicate cron) can
 *   never re-POST it — recovery is reconcile-by-GET with the persisted
 *   `salesOrderId`, or `manual_review` when no SO id is known (create).
 * - `reference` is the unique provider-facing request note. There is no
 *   documented by-note GET search in Jubelio; reconciliation uses persisted
 *   SO ids only.
 * - A `create` response handle may be persisted as salesOrderId before the
 *   independent `GET /sales/orders/{id}` verifies it, allowing GET-only crash
 *   recovery. `confirmed` requires the known SO id; a `cancel` operation
 *   always carries that id (enforced by CHECK constraints).
 * - Provider calls stay OUTSIDE any DB transaction; this table only records
 *   intent, claim and outcome.
 * - Settlement (Path 1) rides the same ledger: `invoice` operations carry the
 *   known SO id and persist the returned invoice id BEFORE any payment;
 *   `payment` operations carry the verified invoice id and persist the
 *   payment id only after a verified GET. Path 2
 *   (`/sales/packlists/create-invoice-payment`) is never called.
 */

/**
 * Provider contract version of a persisted Sales Order create request.
 *
 * - absent — legacy/unversioned snapshot: the evidenced zero-disc/zero-tax
 *   envelope without shipping fields, read by the explicit legacy decoder and
 *   never assumed to be version 2.
 * - `2` — contract v2 (spec §8.3/§10.1): frozen original/net shipping plus the
 *   expected provider payable, so the provider request and its independent GET
 *   verification are derived from the stored snapshot.
 *
 * Any other explicit version is unknown and must be rejected (fail closed) by
 * the decoder/builder; this type is compile-time only, the runtime guard lives
 * in the gateway (`apps/store/src/lib/jubelio-sales-client.ts`).
 */
export type JubelioSalesProviderContractVersion = 2;

/** Fields shared by every persisted create-request snapshot. */
export type JubelioSalesOrderCreateRequestFields = {
  contactId: number;
  customerName: string;
  locationId: number;
  note: string;
  refNo?: string;
  /** New pickup create intents persist their informational initial marker. */
  channelStatus?: "Belum Bayar";
  items: Array<{
    itemId: number;
    quantity: number;
    price: number;
    discAmount: number;
    taxAmount: number;
    unit: string;
    taxId: number;
  }>;
};

/**
 * Unversioned legacy create intent: the evidenced zero-disc/zero-tax envelope
 * only. The gateway branch for this shape is unchanged — it carries no shipping
 * fields and keeps the original zero-discount guard.
 */
export type JubelioSalesOrderCreateRequestLegacy =
  JubelioSalesOrderCreateRequestFields;

/**
 * Contract-v2 create intent: the frozen money snapshot the provider request is
 * built from and verified against.
 *
 * - `originalShipmentCost` — customer shipping before subsidy (pickup: 0).
 * - `shippingCost` — net customer shipping after subsidy (pickup: 0).
 * - `expectedProviderPayable` — net goods + net shipping, which must equal the
 *   provider `grand_total`, invoice and payment amount.
 */
export type JubelioSalesOrderCreateRequestV2 =
  JubelioSalesOrderCreateRequestFields & {
    providerContractVersion: JubelioSalesProviderContractVersion;
    originalShipmentCost: number;
    shippingCost: number;
    expectedProviderPayable: number;
  };

/** Request snapshot of `POST /sales/orders/`. */
export type JubelioSalesOrderCreateRequest =
  | JubelioSalesOrderCreateRequestLegacy
  | JubelioSalesOrderCreateRequestV2;

/** Request snapshot of `POST /sales/orders/cancel/` with `{ids: [...]}`. */
export type JubelioSalesOrderCancelRequest = {
  salesOrderId: number;
};

export type JubelioSalesOperationPayload =
  | { type: "create"; create: JubelioSalesOrderCreateRequest }
  | { type: "cancel"; cancel: JubelioSalesOrderCancelRequest }
  | { type: "invoice"; invoice: JubelioSalesInvoiceRequest }
  | { type: "payment"; payment: JubelioSalesPaymentRequest };

/**
 * Request snapshot of the invoice conversion `POST /sales/packlists/create-invoice`
 * (Path 1 only — `/sales/packlists/create-invoice-payment` is never called).
 */
export type JubelioSalesInvoiceRequest = {
  salesOrderId: number;
};

/**
 * Request snapshot of `POST /sales/payments/` (Path 1 settlement, at most
 * once, only after the invoice id is persisted AND verified via
 * `GET /sales/invoices/{id}`).
 *
 * Sandbox-verified (2026-09-24): `payment_type` is a NUMBER (0 = cash/other,
 * account-dependent), `payment_no: "[auto]"` is accepted and the provider
 * numbers the payment (CP-...). The response is `{status, id}` where id is
 * the payment_id.
 */
export type JubelioSalesPaymentRequest = {
  invoiceId: number;
  accountId: number;
  amount: number;
  contactId: number;
  contactName?: string;
  paymentType: number;
  note?: string;
};

// Status lifecycle (single direction, no automatic transitions):
//   intent             — persisted intent, never dispatched (the only claimable state)
//   dispatched_unknown — claimed; the single POST may have been applied; recovery
//                        is reconcile-by-GET with the persisted SO id or manual_review
//   confirmed          — independent GET confirmed create/cancel with a known SO id,
//                        invoice conversion with its verified invoice id, or the
//                        payment POST with its verified payment id
//   rejected           — definitive pre-apply provider/local rejection; write not applied
//   manual_review      — ambiguous outcome routed to operator reconciliation
//   aborted            — locally abandoned while still `intent` (write never sent)
export const jubelioSalesOperations = pgTable(
  "jubelio_sales_operation",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .references(() => orders.id, { onDelete: "restrict" }),
    checkoutAttemptId: text("checkout_attempt_id")
      .references(() => checkoutAttempts.id, { onDelete: "restrict" }),
    type: text("type").notNull(), // create | cancel | invoice | payment
    status: text("status").notNull().default("intent"),
    // Unique provider-facing request reference (the create `note`): the only
    // provider-visible correlation key for an operation.
    reference: text("reference").notNull(),
    // Full request snapshot persisted before any POST so a claimed operation
    // is always auditable/reconcilable without re-deriving the request.
    payload: jsonb("payload").$type<JubelioSalesOperationPayload>().notNull(),
    // Known remote sales-order identifier: required for cancel and invoice
    // intents. A create response handle may be persisted before confirmation
    // so recovery can GET it; status becomes confirmed only after verification.
    salesOrderId: integer("sales_order_id"),
    // Remote invoice id (the Sales Invoice Number returned by invoice
    // conversion). Persisted as soon as the conversion POST returns it —
    // BEFORE any payment — so a crash still leaves a reconcilable GET handle.
    invoiceId: integer("invoice_id"),
    // Remote payment id, persisted only after a verified payment GET.
    paymentId: integer("payment_id"),
    // Create marker mismatch is informational: core GET confirmation still
    // succeeds; no extra edit or checkout payment gate is introduced.
    channelStatusMismatchReason: text("channel_status_mismatch_reason"),
    channelStatusMismatchAt: timestamp("channel_status_mismatch_at", { withTimezone: true }),
    // Accounting of the confirmed create/cancel hold is committed atomically
    // with the stock update; NULL means sweep must finish crash recovery.
    holdAccountedAt: timestamp("hold_accounted_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("jubelio_sales_operation_order_type_unique").on(
      t.orderId,
      t.type
    ),
    uniqueIndex("jubelio_sales_operation_reference_unique").on(t.reference),
    uniqueIndex("jubelio_sales_operation_attempt_type_unique").on(t.checkoutAttemptId, t.type),
    foreignKey({ name: "jubelio_sales_operation_attempt_order_fk", columns: [t.checkoutAttemptId, t.orderId],
      foreignColumns: [checkoutAttempts.id, checkoutAttempts.orderId] }).onDelete("restrict").onUpdate("restrict"),
    check("jubelio_sales_operation_owner_required", sql`${t.orderId} IS NOT NULL OR ${t.checkoutAttemptId} IS NOT NULL`),
    check("jubelio_sales_operation_unpromoted_type_valid", sql`${t.orderId} IS NOT NULL OR ${t.type} IN ('create','cancel')`),
    index("idx_jubelio_sales_operation_status").on(t.status),
    check(
      "jubelio_sales_operation_type_valid",
      sql`${t.type} in ('create', 'cancel', 'invoice', 'payment')`
    ),
    check(
      "jubelio_sales_operation_status_valid",
      sql`${t.status} in ('intent', 'dispatched_unknown', 'confirmed', 'rejected', 'manual_review', 'aborted')`
    ),
    check(
      "jubelio_sales_operation_attempt_nonnegative",
      sql`${t.attemptCount} >= 0`
    ),
    check(
      "jubelio_sales_operation_cancel_requires_sales_order",
      sql`${t.type} <> 'cancel' or ${t.salesOrderId} is not null`
    ),
    check(
      "jubelio_sales_operation_confirmed_requires_sales_order",
      sql`${t.status} <> 'confirmed' or ${t.salesOrderId} is not null`
    ),
    check(
      "jubelio_sales_operation_invoice_requires_sales_order",
      sql`${t.type} <> 'invoice' or ${t.salesOrderId} is not null`
    ),
    check(
      "jubelio_sales_operation_payment_requires_invoice_id",
      sql`${t.type} <> 'payment' or ${t.invoiceId} is not null`
    ),
    check(
      "jubelio_sales_operation_confirmed_invoice_requires_invoice_id",
      sql`${t.type} <> 'invoice' or ${t.status} <> 'confirmed' or ${t.invoiceId} is not null`
    ),
    check(
      "jubelio_sales_operation_confirmed_payment_requires_payment_id",
      sql`${t.type} <> 'payment' or ${t.status} <> 'confirmed' or ${t.paymentId} is not null`
    ),
  ]
);

export const jubelioSalesOperationsRelations = relations(
  jubelioSalesOperations,
  ({ one }) => ({
    order: one(orders, {
      fields: [jubelioSalesOperations.orderId],
      references: [orders.id],
    }),
    checkoutAttempt: one(checkoutAttempts, {
      fields: [jubelioSalesOperations.checkoutAttemptId],
      references: [checkoutAttempts.id],
    }),
  })
);