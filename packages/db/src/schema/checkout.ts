import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, jsonb, check, uniqueIndex, index, integer, primaryKey, foreignKey, unique } from "drizzle-orm/pg-core";
import { clients } from "./auth";
import { orders, orderItems, addresses } from "./orders";
import { branches } from "./branches";
import type { JubelioSalesOrderCreateRequest } from "./jubelio-sales";

/** Only initial checkout fields are promotable; no paid/refund/fulfillment flags from JSON. */
export type CheckoutOrderDraft = Pick<typeof orders.$inferInsert,
  | "branchId" | "addressId" | "contactPhone" | "contactEmail" | "subtotal" | "shippingCost" | "discount"
  | "serviceFee" | "ppnRate" | "ppnAmount" | "total" | "fulfillmentMethod" | "deliverySnapshot" | "pickupTime"
  | "pricingContractVersion" | "pricingEngineVersion" | "providerContractVersion" | "pricingCurrency"
  | "sourceGoodsSubtotal" | "markdownTotal" | "netGoods" | "shippingBeforeSubsidy" | "shippingSubsidy"
  | "merchantFunding" | "taxableBase" | "expectedProviderPayable" | "providerQuotedShippingCost"
  | "providerBilledShippingCost" | "pricingSnapshot"> & { pickupDate?: string | null };

export interface CheckoutAttemptSnapshot {
  version: 1;
  order: CheckoutOrderDraft;
  items: Array<Omit<typeof orderItems.$inferInsert, "orderId" | "createdAt">>;
  cart: Array<{ itemId: string; cartId: string; variantId: string; branchId: string;
    quantity: number; updatedAt: string }>;
  createRequest: JubelioSalesOrderCreateRequest;
  addressToSave: Omit<typeof addresses.$inferInsert, "id" | "userId" | "createdAt" | "updatedAt"> | null;
}

export type CheckoutAttemptState =
  | "preparing" | "compensating" | "processing" | "manual_review" | "rejected" | "promoted";
export type CheckoutFailureCode =
  | "SALES_ORDER_REJECTED" | "PAYMENT_INITIALIZATION_REJECTED" | "CHECKOUT_EXPIRED";

export type CheckoutPaymentDispatchState =
  | "none" | "intent" | "dispatched_unknown" | "ready" | "rejected" | "manual_review";

/** Durable pre-order evidence; an unsuccessful attempt is not a customer order. */
export const checkoutAttempts = pgTable("checkout_attempt", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  lifecycleVersion: integer("lifecycle_version").notNull().default(2),
  reservedOrderId: text("reserved_order_id").notNull(),
  orderId: text("order_id"),
  state: text("state").$type<CheckoutAttemptState>().notNull().default("preparing"),
  failureCode: text("failure_code").$type<CheckoutFailureCode>(),
  snapshot: jsonb("snapshot").$type<CheckoutAttemptSnapshot>().notNull(),
  stockHoldState: text("stock_hold_state").notNull().default("held"),
  paymentState: text("payment_state").$type<CheckoutPaymentDispatchState>().notNull().default("none"),
  paymentToken: text("payment_token"),
  paymentRedirectUrl: text("payment_redirect_url"),
  paymentTransactionId: text("payment_transaction_id"),
  paymentDispatchedAt: timestamp("payment_dispatched_at", { withTimezone: true }),
  // Only verified, normalized payment evidence. Never a raw callback/provider body.
  paymentEvent: jsonb("payment_event").$type<{ transactionId: string; status: string;
    grossAmount: string; paymentType: string | null; verifiedAt: string }>(),
  paymentStartedAt: timestamp("payment_started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("checkout_attempt_owner_key_unique").on(t.clientId, t.requestKey),
  uniqueIndex("checkout_attempt_active_owner_unique").on(t.clientId)
    .where(sql`${t.state} NOT IN ('rejected', 'promoted')`),
  uniqueIndex("checkout_attempt_reserved_order_unique").on(t.reservedOrderId),
  uniqueIndex("checkout_attempt_order_unique").on(t.orderId),
  unique("checkout_attempt_owner_identity_unique").on(t.id, t.clientId),
  unique("checkout_attempt_order_identity_unique").on(t.id, t.orderId),
  index("checkout_attempt_recovery_idx").on(t.state, t.updatedAt),
  foreignKey({ name: "checkout_attempt_promoted_owner_fk", columns: [t.orderId, t.clientId],
    foreignColumns: [orders.id, orders.userId] }).onDelete("restrict").onUpdate("restrict"),
  check("checkout_attempt_key_valid", sql`${t.requestKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  check("checkout_attempt_fingerprint_valid", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
  check("checkout_attempt_version_valid", sql`${t.lifecycleVersion} = 2`),
  check("checkout_attempt_state_valid", sql`${t.state} IN ('preparing','compensating','processing','manual_review','rejected','promoted')`),
  check("checkout_attempt_promotion_valid", sql`(
    (${t.state} = 'promoted' AND ${t.orderId} IS NOT NULL AND ${t.orderId} = ${t.reservedOrderId} AND ${t.paymentState} = 'ready')
    OR (${t.state} <> 'promoted' AND ${t.orderId} IS NULL)) IS TRUE`),
  check("checkout_attempt_rejection_valid", sql`(
    (${t.state} = 'rejected' AND ${t.failureCode} IN ('SALES_ORDER_REJECTED','PAYMENT_INITIALIZATION_REJECTED','CHECKOUT_EXPIRED')
      AND ${t.stockHoldState} = 'released' AND ${t.paymentState} IN ('none','rejected'))
    OR (${t.state} <> 'rejected' AND ${t.failureCode} IS NULL)) IS TRUE`),
  check("checkout_attempt_stock_hold_valid", sql`${t.stockHoldState} IN ('held','mirrored','released')`),
  check("checkout_attempt_payment_valid", sql`(
    ${t.paymentState} IN ('none','intent','dispatched_unknown','ready','rejected','manual_review')
    AND (${t.paymentState} <> 'ready' OR (length(btrim(${t.paymentToken})) > 0 AND length(btrim(${t.paymentRedirectUrl})) > 0))
    AND (${t.paymentState} NOT IN ('dispatched_unknown','ready','manual_review') OR ${t.paymentDispatchedAt} IS NOT NULL)) IS TRUE`),
  check("checkout_attempt_snapshot_valid", sql`(jsonb_typeof(${t.snapshot}) = 'object'
    AND ${t.snapshot}->'version' = '1'::jsonb AND jsonb_typeof(${t.snapshot}->'order') = 'object'
    AND jsonb_typeof(${t.snapshot}->'items') = 'array' AND jsonb_array_length(${t.snapshot}->'items') > 0
    AND jsonb_typeof(${t.snapshot}->'cart') = 'array' AND jsonb_array_length(${t.snapshot}->'cart') > 0
    AND jsonb_typeof(${t.snapshot}->'createRequest') = 'object'
    AND octet_length(${t.snapshot}::text) <= 262144) IS TRUE`),
  check("checkout_attempt_deadline_valid", sql`${t.expiresAt} > ${t.paymentStartedAt}`),
]);

/**
 * Counter admission rate-limit yang ephemeral (spec §5.5). Terpisah dari
 * accepted checkout result: baris di sini boleh kedaluwarsa dan dibersihkan
 * opportunistic, sedangkan `checkout_request` retained bersama order.
 */
export const discountRequestWindows = pgTable("discount_request_window", {
  kind: text("kind").notNull(),
  subjectHash: text("subject_hash").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.kind, t.subjectHash, t.windowStart] }),
  index("discount_request_window_expiry_idx").on(t.expiresAt),
  check("discount_request_window_count_valid", sql`${t.count} >= 0`),
  check("discount_request_window_subject_valid", sql`${t.subjectHash} ~ '^[a-f0-9]{64}$'`),
  check("discount_request_window_kind_valid", sql`${t.kind} IN ('preview:account','preview:ip','place:account','place:ip','code:account','code:ip')`),
  check("discount_request_window_expiry_valid", sql`${t.expiresAt} = ${t.windowStart} + interval '60 seconds'`),
]);

/** Hasil placement yang retained; bukan counter rate atau reservation sementara. */
export const checkoutRequests = pgTable("checkout_request", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull().default("accepted"),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  result: jsonb("result").$type<{ version: 1; orderId: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("checkout_request_owner_key_unique").on(t.clientId, t.requestKey),
  uniqueIndex("checkout_request_order_unique").on(t.orderId),
  index("checkout_request_key_idx").on(t.requestKey),
  check("checkout_request_key_valid", sql`${t.requestKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  check("checkout_request_fingerprint_valid", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check("checkout_request_accepted_result_valid", sql`(${t.status} = 'accepted' AND jsonb_typeof(${t.result}) = 'object' AND ${t.result}->'version' = '1'::jsonb AND ${t.result}->>'orderId' = ${t.orderId} AND octet_length(${t.result}::text) <= 262144) IS TRUE`),
]);
