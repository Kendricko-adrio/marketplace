import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orders } from "./orders";

/**
 * Spec TX-02 §8/§12.1 — ledger payment session milik ORDER, bukan job queue.
 *
 * Satu order maksimal punya satu baris (unique `order_id`), dan referensi
 * provider immutable (unique `provider_reference`). Initial legacy dan
 * repayment memakai baris yang SAMA, sehingga klaim `intent →
 * dispatched_unknown` menjadi satu-satunya izin dispatch provider.
 *
 * State:
 * - `intent`             — snapshot identity/money/deadline tersimpan, belum di-claim.
 * - `dispatched_unknown` — satu writer sudah memperoleh hak dispatch; tidak boleh re-POST.
 * - `ready`              — redirect valid tersimpan (belum berarti customer membayar).
 * - `rejected`           — evidence definitif bahwa sesi tidak pernah dibuat.
 * - `manual_review`      — evidence belum cukup / histori ambigu.
 * - `paid` / `expired`   — observation provider authoritative.
 *
 * `provenance` membedakan intent runtime dari baris lama:
 * `runtime`, `adopted_redirect` (redirect lama dipakai tanpa backfill history),
 * `legacy_unknown` (tidak ada row/dispatch evidence — tidak claimable).
 */
export interface OrderCartSelection {
  cartId: string;
  itemId: string;
  variantId: string;
  branchId: string;
  quantity: number;
  updatedAt: string;
}

export type OrderPaymentSessionState =
  | "intent"
  | "dispatched_unknown"
  | "ready"
  | "rejected"
  | "manual_review"
  | "paid"
  | "expired";

export type OrderPaymentSessionProvenance =
  | "runtime"
  | "adopted_redirect"
  | "legacy_unknown";

export const orderPaymentSessions = pgTable(
  "order_payment_session",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** Immutable provider order reference (same value the order id uses). */
    providerReference: text("provider_reference").notNull(),
    provenance: text("provenance").notNull(),
    state: text("state").notNull().default("intent"),
    expectedAmount: numeric("expected_amount", { precision: 15, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("IDR"),
    /** Original anchor/deadline, never recomputed on replay/resume. */
    paymentStartedAt: timestamp("payment_started_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Local claim identity: committed BEFORE the provider POST. */
    dispatchClaimId: text("dispatch_claim_id"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    /** Server-only Snap token; never sent to a browser response. */
    token: text("token"),
    redirectUrl: text("redirect_url"),
    /** Normalized verified observation, never the raw provider body. */
    transactionId: text("transaction_id"),
    lastVerifiedStatus: text("last_verified_status"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    /** Allowlisted code, never a free-form error message. */
    lastErrorCode: text("last_error_code"),
    /** Exact initial server-side cart selection, bounded; no PII. */
    cartSnapshot: jsonb("cart_snapshot").$type<OrderCartSelection[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_payment_session_order_unique").on(t.orderId),
    uniqueIndex("order_payment_session_reference_unique").on(t.providerReference),
    index("idx_order_payment_session_state").on(t.state, t.expiresAt),
    check(
      "order_payment_session_state_valid",
      sql`${t.state} in ('intent', 'dispatched_unknown', 'ready', 'rejected', 'manual_review', 'paid', 'expired')`
    ),
    check(
      "order_payment_session_provenance_valid",
      sql`${t.provenance} in ('runtime', 'adopted_redirect', 'legacy_unknown')`
    ),
    check(
      "order_payment_session_currency_valid",
      sql`${t.currency} = 'IDR'`
    ),
    check(
      "order_payment_session_amount_valid",
      sql`${t.expectedAmount} >= 0
          and ${t.expectedAmount} = trunc(${t.expectedAmount})
          and ${t.expectedAmount} <= 9999999999999`
    ),
    // A ready runtime session must carry a provider redirect. Adopted history
    // may legitimately have no stored token (the old rows never kept one).
    check(
      "order_payment_session_ready_requires_redirect",
      sql`${t.state} <> 'ready' or (${t.redirectUrl} is not null and length(btrim(${t.redirectUrl})) > 0)`
    ),
    // A possibly-sent session always carries its claim identity and anchor.
    check(
      "order_payment_session_dispatched_requires_claim",
      sql`${t.state} <> 'dispatched_unknown' or (
        ${t.dispatchClaimId} is not null
        and ${t.dispatchedAt} is not null
        and ${t.paymentStartedAt} is not null
        and ${t.expiresAt} is not null)`
    ),
    // Authoritative states require persisted verified evidence.
    check(
      "order_payment_session_verified_states",
      sql`${t.state} not in ('paid', 'expired') or (
        ${t.lastVerifiedStatus} is not null and ${t.lastVerifiedAt} is not null)`
    ),
    // A session that was never dispatched cannot hold a returned handle.
    check(
      "order_payment_session_unclaimed_has_no_handle",
      sql`${t.state} not in ('intent', 'rejected') or (
        ${t.token} is null and ${t.redirectUrl} is null)`
    ),
    // An intent was never claimed, so it can never carry a dispatch claim.
    check(
      "order_payment_session_intent_unclaimed",
      sql`${t.state} <> 'intent' or ${t.dispatchClaimId} is null`
    ),
    check(
      "order_payment_session_error_code_valid",
      sql`${t.lastErrorCode} is null or (
        length(${t.lastErrorCode}) <= 64 and ${t.lastErrorCode} ~ '^[a-z_]+$')`
    ),
    check(
      "order_payment_session_cart_snapshot_size",
      sql`${t.cartSnapshot} is null or octet_length(${t.cartSnapshot}::text) <= 262144`
    ),
  ]
);
