import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { orders } from "./orders";

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
 * - A `create` operation must NOT carry a salesOrderId until an independent
 *   `GET /sales/orders/{id}` has confirmed the create; a `cancel` operation
 *   always carries the known SO id (both enforced by CHECK constraints).
 * - Provider calls stay OUTSIDE any DB transaction; this table only records
 *   intent, claim and outcome.
 * - Settlement (Path 1) rides the same ledger: `invoice` operations carry the
 *   known SO id and persist the returned invoice id BEFORE any payment;
 *   `payment` operations carry the verified invoice id and persist the
 *   payment id only after a verified GET. Path 2
 *   (`/sales/packlists/create-invoice-payment`) is never called.
 */

/** Request snapshot of `POST /sales/orders/` (zero-disc/zero-tax envelope only). */
export type JubelioSalesOrderCreateRequest = {
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
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // create | cancel | invoice | payment
    status: text("status").notNull().default("intent"),
    // Unique provider-facing request reference (the create `note`): the only
    // provider-visible correlation key for an operation.
    reference: text("reference").notNull(),
    // Full request snapshot persisted before any POST so a claimed operation
    // is always auditable/reconcilable without re-deriving the request.
    payload: jsonb("payload").$type<JubelioSalesOperationPayload>().notNull(),
    // Known remote sales-order identifier: required for cancel and invoice
    // intents, set for create operations only after the confirmed independent
    // GET.
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
  })
);