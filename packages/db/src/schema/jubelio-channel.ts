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
 * Durable per-order channel-status mirror projection (ticket #03 — Siap
 * Proses edit, crash-tolerant; spec: .scratch/jubelio-pickup-status/
 * spec-draft.md, implementation decision 4).
 *
 * Why a SEPARATE table: `jubelio_sales_operation` is unique per
 * `(order_id, type)` for `create | cancel | invoice | payment` and is the
 * settlement ledger — it cannot hold a monotonic SERIES of channel edits.
 * This projection persists, per order, the staged channel-status target
 * (monotonic version), the known SO id, the desired marker, the last
 * observed marker and the dispatch state BEFORE any edit POST:
 *
 * - `pending`          — persisted intent, never claimed (the only
 *                        dispatchable state; at most ONE POST per intent).
 * - `possibly_sent`    — claimed; the edit may already have been applied.
 *                        Recovery is GET-only with the persisted
 *                        `sales_order_id` — never a re-POST. A newer target
 *                        must not be dispatched while this state is
 *                        unresolved.
 * - `confirmed`        — the independent post-edit GET observed the target
 *                        marker (`last_observed_status`) and the core SO
 *                        attributes.
 * - `needs_investigation` — fail-closed mismatch (remote SO changed, unsafe
 *                        payload shape, marker diverged) or an aged unknown
 *                        outcome; `mismatch_reason` is a durable, PII-safe
 *                        reason code. No automatic re-dispatch.
 * - `rejected`         — definitive pre-apply provider rejection (4xx); the
 *                        write was never applied. Only an explicit new local
 *                        state may open a later target.
 * - `aborted`          — locally abandoned while still `pending` (never sent).
 *
 * The edit payload snapshot is persisted (`payload`) BEFORE the POST so a
 * crash still leaves an auditable full-payload request. Provider calls stay
 * OUTSIDE any DB transaction. A mirror failure never changes the local order
 * status, payment status, pickup code or verify-pickup permission: nothing
 * here is authoritative for payment or pickup.
 */

/** The approved Status Channel marker vocabulary (spec table). */
export const CHANNEL_STATUS_MARKERS = [
  "Belum Bayar",
  "Menunggu Verifikasi",
  "Siap Proses",
  "Gagal Bayar",
  "Dibatalkan",
  "Selesai",
] as const;

export type ChannelStatusMarker = (typeof CHANNEL_STATUS_MARKERS)[number];

/** Dispatch state lifecycle (single direction, no automatic transitions). */
export type JubelioChannelStatusIntentStatus =
  | "pending"
  | "possibly_sent"
  | "confirmed"
  | "needs_investigation"
  | "rejected"
  | "aborted";

/**
 * Request snapshot of the full-payload SO edit (`saveSalesOrderRequest` with
 * `salesorder_id` != 0), built from the verified pre-edit GET and persisted
 * before the single POST so a claimed edit is always auditable. Every
 * allowlist field is preserved verbatim; the ONLY intended change is
 * `channel_status`.
 */
export type JubelioSalesOrderEditRequest = {
  type: "edit";
  edit: {
    salesorderId: number;
    salesorderNo: string;
    contactId: number;
    customerName: string;
    transactionDate: string;
    isTaxIncluded: boolean;
    note: string;
    refNo: string;
    locationId: number;
    source: number;
    channelStatus: string;
    subTotal: number;
    totalDisc: number;
    totalTax: number;
    grandTotal: number;
    addFee: number;
    addDisc: number;
    serviceFee: number;
    items: Array<{
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
    }>;
  };
};

export const jubelioChannelStatusIntents = pgTable(
  "jubelio_channel_status_intent",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // A channel edit always targets a KNOWN, confirmed Sales Order.
    salesOrderId: integer("sales_order_id").notNull(),
    // Monotonic per order: a new local stage records the next version; a
    // possibly-sent older version blocks newer dispatches.
    targetVersion: integer("target_version").notNull(),
    // The marker the edit intends to write (allowlist-checked).
    targetStatus: text("target_status").notNull(),
    status: text("status").notNull().default("pending"),
    // Full-payload edit snapshot persisted BEFORE the single POST (audit +
    // crash recovery). NULL for a never-claimed intent.
    payload: jsonb("payload").$type<JubelioSalesOrderEditRequest>(),
    // Last marker observed by a GET (pre-read, post-edit or recovery).
    lastObservedStatus: text("last_observed_status"),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    // Durable, PII-safe investigation reason (mismatch / fail-closed code).
    mismatchReason: text("mismatch_reason"),
    mismatchAt: timestamp("mismatch_at", { withTimezone: true }),
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
    uniqueIndex("jubelio_channel_status_intent_order_version_unique").on(
      t.orderId,
      t.targetVersion
    ),
    // PER-SO ACTIVE DISPATCH GUARD (spec serialization is per SO): at most
    // ONE possibly_sent intent may exist per sales_order_id across ALL local
    // orders, so two different orders referencing the same SO can never both
    // hold an in-flight edit. The claim treats the unique violation as a
    // fail-closed refusal (never a second POST). Monotonic per-order
    // versions are unaffected; the guard releases as soon as the intent
    // leaves `possibly_sent` (confirmed / needs_investigation / rejected /
    // aborted).
    uniqueIndex("jubelio_channel_status_intent_active_per_so_unique")
      .on(t.salesOrderId)
      .where(sql`${t.status} = 'possibly_sent'`),
    index("idx_jubelio_channel_status_intent_status").on(t.status),
    check(
      "jubelio_channel_status_intent_target_valid",
      sql`${t.targetStatus} in ('Belum Bayar', 'Menunggu Verifikasi', 'Siap Proses', 'Gagal Bayar', 'Dibatalkan', 'Selesai')`
    ),
    check(
      "jubelio_channel_status_intent_status_valid",
      sql`${t.status} in ('pending', 'possibly_sent', 'confirmed', 'needs_investigation', 'rejected', 'aborted')`
    ),
    check(
      "jubelio_channel_status_intent_attempt_nonnegative",
      sql`${t.attemptCount} >= 0`
    ),
    check(
      "jubelio_channel_status_intent_sales_order_positive",
      sql`${t.salesOrderId} > 0`
    ),
    check(
      "jubelio_channel_status_intent_version_positive",
      sql`${t.targetVersion} >= 1`
    ),
    check(
      "jubelio_channel_status_intent_possibly_sent_requires_dispatched_at",
      sql`${t.status} <> 'possibly_sent' or ${t.dispatchedAt} is not null`
    ),
    check(
      "jubelio_channel_status_intent_needs_investigation_requires_reason",
      sql`${t.status} <> 'needs_investigation' or ${t.mismatchReason} is not null`
    ),
    check(
      "jubelio_channel_status_intent_confirmed_requires_observed_status",
      sql`${t.status} <> 'confirmed' or ${t.lastObservedStatus} is not null`
    ),
  ]
);

export const jubelioChannelStatusIntentsRelations = relations(
  jubelioChannelStatusIntents,
  ({ one }) => ({
    order: one(orders, {
      fields: [jubelioChannelStatusIntents.orderId],
      references: [orders.id],
    }),
  })
);