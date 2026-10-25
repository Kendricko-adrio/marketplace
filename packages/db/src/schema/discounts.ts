import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  check,
  unique,
  uniqueIndex,
  primaryKey,
  index,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

import { clients, users } from "./auth";
import { orderItems, orders } from "./orders";
import { checkoutAttempts } from "./checkout";

// =========================================================
// Discount administration — Offer identity, draft revisions, usage projection,
// and command receipts (spec §7.1–§7.3, §8.1–§8.4)
// =========================================================
// Only the records the CURRENT slice writes are declared here: a public fixed
// Offer draft, its one unpublished draft revision, the single fixed-goods
// benefit of a revision, the zeroed global usage projection, and the
// create/replay receipt. `discount_code`, `discount_redemption`,
// `discount_client_usage` and the allocation tables are added by the slices
// that first write them — an empty table is not a contract.
//
// Declaration order matters in ONE place: `discount_offer_revision` is declared
// before `discount_offer` because the Offer carries a COMPOSITE ownership
// foreign key to it (`(id, current_revision_id) -> (offer_id, id)`), and a
// table-level `foreignKey()` needs its target table object at build time. The
// reverse edge (revision → Offer) is a lazy column reference, so it can point
// at the Offer declared below.
//
// Money is exact: integer Rupiah in `numeric(15,2)` columns, bounded to the
// store money bound 0..9999999999999 with a whole-Rupiah (scale 0) CHECK. The
// draft is explicitly allowed to be INCOMPLETE (no quota, no budget, no
// published revision); only live states require a global bound plus a current
// revision. Ordinary CHECK constraints cannot enforce cross-row sums or
// immutability — those are module/write-path guarantees (spec §8.2).


/** One immutable revision per publication attempt; drafts are editable only
 * while `published_at` is null and at most ONE unpublished draft may exist per
 * Offer (partial unique index below). */
export const discountOfferRevisions = pgTable(
  "discount_offer_revision",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references((): AnyPgColumn => discountOffers.id, {
        onDelete: "restrict",
      }),
    revisionNo: integer("revision_no").notNull(),
    // Terms may stay incomplete while the revision is an unpublished draft;
    // publication completeness is enforced when `published_at` is set.
    name: text("name"),
    currency: text("currency"),
    minSubtotal: numeric("min_subtotal", { precision: 15, scale: 2 }),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    // Supported contract versions for this revision shape. Unknown versions
    // are rejected at read/write, never defaulted.
    schemaVersion: integer("schema_version").notNull().default(1),
    engineVersion: integer("engine_version").notNull().default(1),
    // Monotonic draft version of this revision row (stale save gate).
    draftVersion: integer("draft_version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Safe, immutable attribution: survives the actor FK becoming null.
    actorIdentity: text("actor_identity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discount_offer_revision_offer_no_unique").on(
      t.offerId,
      t.revisionNo
    ),
    // Composite ownership target for the Offer's current-revision pointer. A
    // table UNIQUE CONSTRAINT (inline DDL) rather than a separate index: the
    // generated migration adds foreign keys before standalone indexes, and an
    // FK target must already be unique when its ALTER TABLE runs.
    unique("discount_offer_revision_offer_id_unique").on(t.offerId, t.id),
    // At most ONE unpublished draft revision per Offer.
    uniqueIndex("discount_offer_revision_single_draft_unique")
      .on(t.offerId)
      .where(sql`${t.publishedAt} is null`),
    check(
      "discount_offer_revision_no_positive",
      sql`${t.revisionNo} >= 1`
    ),
    check(
      "discount_offer_revision_draft_version_positive",
      sql`${t.draftVersion} >= 1`
    ),
    check(
      "discount_offer_revision_versions_supported",
      sql`${t.schemaVersion} = 1 and ${t.engineVersion} = 1`
    ),
    check(
      "discount_offer_revision_name_shape",
      sql`${t.name} is null or char_length(btrim(${t.name})) between 1 and 120`
    ),
    check(
      "discount_offer_revision_currency_shape",
      sql`${t.currency} is null or ${t.currency} = 'IDR'`
    ),
    check(
      "discount_offer_revision_min_subtotal_bounded",
      sql`${t.minSubtotal} is null or (${t.minSubtotal} >= 0 and ${t.minSubtotal} <= 9999999999999 and ${t.minSubtotal} = trunc(${t.minSubtotal}))`
    ),
    // Start is inclusive and end exclusive, so start < end is the only
    // meaningful ordering (equal instants would be an empty window).
    check(
      "discount_offer_revision_window_ordered",
      sql`${t.startAt} is null or ${t.endAt} is null or ${t.startAt} < ${t.endAt}`
    ),
    // Publication completeness: a PUBLISHED revision must carry the terms the
    // pricing/evaluation paths read. Drafts are exempt (incomplete is legal).
    //
    // `currency is not null` is NOT redundant with `currency = 'IDR'`: for a
    // NULL currency the equality evaluates to NULL, and NULL propagates through
    // the AND so the whole CHECK evaluates to NULL — which SQL accepts. A
    // published revision with `name` and `min_subtotal` set but no currency
    // would then be stored as a complete publication. The IS NOT NULL term
    // makes the predicate two-valued again.
    check(
      "discount_offer_revision_published_complete",
      sql`${t.publishedAt} is null or (${t.name} is not null and ${t.currency} is not null and ${t.currency} = 'IDR' and ${t.minSubtotal} is not null)`
    ),
    check(
      "discount_offer_revision_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
  ]
);

/** Offer identity. `activation_kind` is fixed for the lifetime of the row:
 * moving a Coupon to the manual channel (or back) requires a NEW Offer identity,
 * never a revision. `public` Offers carry no customer code; `manual_only`
 * Offers are only usable with one of their reserved `discount_code` rows. */
export const discountOffers = pgTable(
  "discount_offer",
  {
    id: text("id").primaryKey(),
    // Stable opaque Offer identity (admin-side handle, never a customer code).
    key: text("key").notNull(),
    activationKind: text("activation_kind").notNull(),
    state: text("state").notNull().default("draft"),
    // NULL while the Offer has no published revision (draft).
    currentRevisionId: text("current_revision_id"),
    // Monotonic identity version (state/policy/pointer mutations).
    version: integer("version").notNull().default(1),
    // Monotonic draft version (shared draft edits).
    draftVersion: integer("draft_version").notNull().default(1),
    // Live capacity bounds. NULL in a draft — there is NO voucher-style
    // default quota of 100.
    quotaCount: integer("quota_count"),
    budgetAmount: numeric("budget_amount", { precision: 15, scale: 2 }),
    perClientLimit: integer("per_client_limit").notNull().default(1),
    policyVersion: integer("policy_version").notNull().default(1),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorIdentity: text("actor_identity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discount_offer_key_unique").on(t.key),
    // Composite ownership target: a manual code may only belong to a manual
    // Offer, and a Redemption may only name a code of its own Offer.
    unique("discount_offer_id_activation_unique").on(t.id, t.activationKind),
    // The current pointer must reference a revision OF THIS Offer; RESTRICT so
    // a published revision can never be deleted out from under a live Offer.
    foreignKey({
      name: "discount_offer_current_revision_ownership_fk",
      columns: [t.id, t.currentRevisionId],
      foreignColumns: [discountOfferRevisions.offerId, discountOfferRevisions.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "discount_offer_key_shape",
      sql`char_length(${t.key}) between 1 and 128`
    ),
    check(
      "discount_offer_activation_kind_supported",
      sql`${t.activationKind} in ('public', 'manual_only')`
    ),
    check(
      "discount_offer_state_valid",
      sql`${t.state} in ('draft', 'enabled', 'paused', 'archived')`
    ),
    check("discount_offer_version_positive", sql`${t.version} >= 1`),
    check(
      "discount_offer_draft_version_positive",
      sql`${t.draftVersion} >= 1`
    ),
    check(
      "discount_offer_policy_version_positive",
      sql`${t.policyVersion} >= 1`
    ),
    // Count bounds follow spec §4.3: a quota / per-account allowance is a
    // positive integer up to 2147483647. The upper bound equals the int4 range
    // (so Postgres already rejects a larger literal with 22003); the CHECK
    // states the contract explicitly so no narrower number is ever pinned here.
    check(
      "discount_offer_per_client_limit_positive",
      sql`${t.perClientLimit} >= 1 and ${t.perClientLimit} <= 2147483647`
    ),
    check(
      "discount_offer_quota_count_bounded",
      sql`${t.quotaCount} is null or (${t.quotaCount} >= 1 and ${t.quotaCount} <= 2147483647)`
    ),
    check(
      "discount_offer_budget_amount_bounded",
      sql`${t.budgetAmount} is null or (${t.budgetAmount} >= 0 and ${t.budgetAmount} <= 9999999999999 and ${t.budgetAmount} = trunc(${t.budgetAmount}))`
    ),
    // Drafts may be launch-INCOMPLETE; every live state needs a current
    // revision AND at least one global bound (removal of the last bound would
    // be an unbounded giveaway).
    check(
      "discount_offer_live_requirements",
      sql`${t.state} = 'draft' or (${t.currentRevisionId} is not null and (${t.quotaCount} is not null or ${t.budgetAmount} is not null))`
    ),
    check(
      "discount_offer_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
    // §8.4 validity/list lookup (state + activation kind).
    index("idx_discount_offer_state_activation").on(t.state, t.activationKind),
  ]
);

/** Global usage projection, created together with the Offer identity with
 * zeroed counters. Reservation/consume paths (ticket 07/12) mutate this row
 * under an Offer lock; it is never a customer-visible ledger. */
export const discountOfferUsage = pgTable(
  "discount_offer_usage",
  {
    offerId: text("offer_id")
      .primaryKey()
      .references(() => discountOffers.id, { onDelete: "restrict" }),
    reservedCount: integer("reserved_count").notNull().default(0),
    consumedCount: integer("consumed_count").notNull().default(0),
    reservedAmount: numeric("reserved_amount", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0"),
    consumedAmount: numeric("consumed_amount", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Usage counters are non-negative integers bounded by the same spec §4.3
    // maximum as the Offer quota (2147483647), so a projection can never be
    // narrower than the capacity it counts.
    check(
      "discount_offer_usage_reserved_count_bounded",
      sql`${t.reservedCount} >= 0 and ${t.reservedCount} <= 2147483647`
    ),
    check(
      "discount_offer_usage_consumed_count_bounded",
      sql`${t.consumedCount} >= 0 and ${t.consumedCount} <= 2147483647`
    ),
    check(
      "discount_offer_usage_reserved_amount_bounded",
      sql`${t.reservedAmount} >= 0 and ${t.reservedAmount} <= 9999999999999 and ${t.reservedAmount} = trunc(${t.reservedAmount})`
    ),
    check(
      "discount_offer_usage_consumed_amount_bounded",
      sql`${t.consumedAmount} >= 0 and ${t.consumedAmount} <= 9999999999999 and ${t.consumedAmount} = trunc(${t.consumedAmount})`
    ),
    check("discount_offer_usage_version_positive", sql`${t.version} >= 1`),
  ]
);

/** Exactly one typed benefit per revision, version1. Dua kind goods yang didukung:
 * `fixed_goods` (nominal positif Rupiah utuh) dan `percentage_goods` (rate
 * `>0..100` sampai6 digit pecahan, `cap_amount` NULL atau positif). Shipping
 * subsidy datang dengan slice yang pertama mendukungnya (ticket 11).
 * `(revision_id, id)` unik supaya redemption/allocation dapat memegang composite
 * FK ke benefit persis yang dipakai.
 *
 * Rate disimpan `numeric(9,6)` (kontrak spec §4.3); presisi lebih dari6 digit
 * ditolak oleh validator modul SEBELUM insert — Postgres sendiri akan membulatkan
 * nilai berlebih ke skala kolom, jadi guard input bukan opsional. */
export const discountBenefits = pgTable(
  "discount_benefit",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references((): AnyPgColumn => discountOfferRevisions.id, {
        onDelete: "restrict",
      }),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    fixedAmount: numeric("fixed_amount", { precision: 15, scale: 2 }),
    /** Percentage goods rate, exact decimal `numeric(9,6)`. */
    rate: numeric("rate", { precision: 9, scale: 6 }),
    /** Opsional cap Rupiah untuk percentage goods; NULL = tanpa cap. */
    capAmount: numeric("cap_amount", { precision: 15, scale: 2 }),
    paramsVersion: integer("params_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One benefit per revision. Publication additionally requires that the
    // published revision HAS a benefit; a cross-table rule cannot be a CHECK,
    // so the publish transaction guard owns it (spec §8.1).
    uniqueIndex("discount_benefit_revision_unique").on(t.revisionId),
    unique("discount_benefit_revision_id_unique").on(t.revisionId, t.id),
    check(
      "discount_benefit_kind_supported",
      sql`${t.kind} in ('fixed_goods', 'percentage_goods', 'shipping')`
    ),
    check(
      "discount_benefit_scope_supported",
      sql`(${t.kind} in ('fixed_goods', 'percentage_goods') and ${t.scope} = 'goods') or (${t.kind} = 'shipping' and ${t.scope} = 'shipping')`
    ),
    // Bentuk TEPAT satu kind: fixed membawa nominal positif dan TIDAK membawa
    // rate/cap; percentage membawa rate positif <=100 dan cap NULL/positif tanpa
    // nominal fixed. Campuran field antar-kind tidak pernah bisa disimpan.
    check(
      "discount_benefit_shape_valid",
      sql`(${t.kind} = 'fixed_goods' and ${t.fixedAmount} is not null and ${t.fixedAmount} > 0 and ${t.fixedAmount} <= 9999999999999 and ${t.fixedAmount} = trunc(${t.fixedAmount}) and ${t.rate} is null and ${t.capAmount} is null)
        or (${t.kind} = 'percentage_goods' and ${t.fixedAmount} is null and ${t.rate} is not null and ${t.rate} > 0 and ${t.rate} <= 100 and (${t.capAmount} is null or (${t.capAmount} > 0 and ${t.capAmount} <= 9999999999999 and ${t.capAmount} = trunc(${t.capAmount}))))
        or (${t.kind} = 'shipping' and ${t.fixedAmount} is null and ${t.rate} is null and ${t.capAmount} is not null and ${t.capAmount} > 0 and ${t.capAmount} <= 9999999999999 and ${t.capAmount} = trunc(${t.capAmount}))`
    ),
    check(
      "discount_benefit_params_version_supported",
      sql`${t.paramsVersion} = 1`
    ),
  ]
);

/** Reserved Manual Promo Code (ticket 09, spec §7.1/§8.1).
 *
 * The canonical literal is UNIQUE GLOBALLY: two Offers can never reserve the
 * same spelling. A code belongs to exactly one manual-only Offer forever — the
 * literal and owner are immutable once published (module guarantee; the
 * composite FK only proves the owner is a manual Offer). Active/inactive/
 * archived follow the Offer window; a code has NO sub-quota, separate expiry or
 * customer binding, and it shares the Offer's global/budget/per-account usage.
 *
 * `published_at` is set when the add-code/publish transaction commits, never
 * when an admin merely types a draft proposal. */
export const discountCodes = pgTable(
  "discount_code",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull(),
    // Fixed `manual_only` activation ownership (see composite FK below).
    activationKind: text("activation_kind").notNull().default("manual_only"),
    canonicalCode: text("canonical_code").notNull(),
    state: text("state").notNull().default("active"),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorIdentity: text("actor_identity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Exact canonical uniqueness ACROSS Offers (no case/space aliasing).
    uniqueIndex("discount_code_canonical_unique").on(t.canonicalCode),
    // Composite ownership target for Redemption `(offer_id, code_id)`.
    unique("discount_code_offer_id_unique").on(t.offerId, t.id),
    foreignKey({
      name: "discount_code_manual_offer_fk",
      columns: [t.offerId, t.activationKind],
      foreignColumns: [discountOffers.id, discountOffers.activationKind],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("discount_code_offer_state_idx").on(t.offerId, t.state),
    check(
      "discount_code_canonical_shape",
      sql`${t.canonicalCode} ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'`
    ),
    check(
      "discount_code_activation_manual",
      sql`${t.activationKind} = 'manual_only'`
    ),
    check(
      "discount_code_state_valid",
      sql`${t.state} in ('active', 'inactive', 'archived')`
    ),
    check("discount_code_version_positive", sql`${t.version} >= 1`),
    check(
      "discount_code_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
  ]
);

/** Immutable accepted command receipt: one row per `(actor, request key)`.
 *
 * Created in the SAME commit as the Offer/revision/usage/audit it produced, so
 * a lost response cannot create a second Offer. `actor_identity` is a plain
 * immutable string — `actor_id` (SET NULL) is attribution only, so deleting a
 * user never frees the request key for reuse. `target_id` deliberately has NO
 * foreign key: a receipt must survive independently of the Offer it names.
 * `result_json` is the bounded safe result (no code literal, no provider data). */
export const discountAdminRequests = pgTable(
  "discount_admin_request",
  {
    id: text("id").primaryKey(),
    actorIdentity: text("actor_identity").notNull(),
    requestKey: text("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id"),
    // Offer identity version produced/accepted by the command.
    version: integer("version").notNull(),
    resultJson: jsonb("result_json").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The authoritative idempotency key. NOT the request key alone: two actors
    // may legitimately pick the same client-generated key.
    uniqueIndex("discount_admin_request_actor_key_unique").on(
      t.actorIdentity,
      t.requestKey
    ),
    check(
      "discount_admin_request_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
    check(
      "discount_admin_request_key_uuid",
      sql`${t.requestKey} ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
    ),
    // Canonical SHA-256 fingerprint of the validated command (transport
    // metadata excluded).
    check(
      "discount_admin_request_fingerprint_sha256",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "discount_admin_request_action_shape",
      sql`${t.action} ~ '^[a-z][a-z0-9_]{0,63}$'`
    ),
    check("discount_admin_request_version_positive", sql`${t.version} >= 1`),
    // Bounded result payload (256 KiB); a generic event bus is not an option.
    // Measured on the text form, matching the existing bounded-JSON CHECK on
    // `orders.pricing_snapshot`.
    check(
      "discount_admin_request_result_bounded",
      sql`octet_length(${t.resultJson}::text) <= 262144`
    ),
  ]
);

// =========================================================
// Redemption lifecycle (ticket 07) — reserve → consume/release
// =========================================================
// One Redemption per order for its entire lifetime, incl. released. The global
// and per-client usage projections are mutated under the Offer lock in the
// SAME commit as the order/stock/intent, so capacity can never be oversold by
// a projection that disagrees with the redemption rows. Ordinary CHECKs cannot
// enforce cross-row sums or immutability: those are module guarantees.

/** Per-(Offer, client) usage projection. Created conflict-safe AFTER the Offer
 * lock; `per_client_limit` (default 1) is checked against it. */
export const discountClientUsage = pgTable(
  "discount_client_usage",
  {
    offerId: text("offer_id")
      .notNull()
      .references(() => discountOffers.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    reservedCount: integer("reserved_count").notNull().default(0),
    consumedCount: integer("consumed_count").notNull().default(0),
    reservedAmount: numeric("reserved_amount", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    consumedAmount: numeric("consumed_amount", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.offerId, t.clientId] }),
    check(
      "discount_client_usage_reserved_count_bounded",
      sql`${t.reservedCount} >= 0 and ${t.reservedCount} <= 2147483647`
    ),
    check(
      "discount_client_usage_consumed_count_bounded",
      sql`${t.consumedCount} >= 0 and ${t.consumedCount} <= 2147483647`
    ),
    check(
      "discount_client_usage_reserved_amount_bounded",
      sql`${t.reservedAmount} >= 0 and ${t.reservedAmount} <= 9999999999999 and ${t.reservedAmount} = trunc(${t.reservedAmount})`
    ),
    check(
      "discount_client_usage_consumed_amount_bounded",
      sql`${t.consumedAmount} >= 0 and ${t.consumedAmount} <= 9999999999999 and ${t.consumedAmount} = trunc(${t.consumedAmount})`
    ),
    check("discount_client_usage_version_positive", sql`${t.version} >= 1`),
  ]
);

/** One Redemption per order, for the whole order lifetime. `released` rows are
 * RETRAINED: releasing capacity never deletes the evidence, and the same order
 * can never acquire a second Redemption. */
export const discountRedemptions = pgTable(
  "discount_redemption",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    checkoutAttemptId: text("checkout_attempt_id"),
    clientId: text("client_id").notNull(),
    offerId: text("offer_id").notNull(),
    revisionId: text("revision_id").notNull(),
    benefitId: text("benefit_id").notNull(),
    // Exactly one activation channel per Redemption: a public Coupon carries no
    // code, a manual Redemption names the code the customer actually used. Both
    // columns are fixed for the lifetime of the row and share the SAME Offer
    // usage counters (no per-code capacity).
    activationKind: text("activation_kind").notNull().default("public"),
    codeId: text("code_id"),
    status: text("status").notNull().default("reserved"),
    // Actual benefit applied to this order (positive whole Rupiah, clipped to
    // the subtotal after Markdown). Zero-benefit configurations never reserve.
    benefitAmount: numeric("benefit_amount", { precision: 15, scale: 2 }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    policyVersion: integer("policy_version").notNull(),
    contractVersion: integer("contract_version").notNull().default(1),
    engineVersion: integer("engine_version").notNull().default(1),
    // Frozen terms/result evidence (bounded; never a second source of truth for
    // master prices or provider money).
    termsSnapshot: jsonb("terms_snapshot").notNull(),
    resultSnapshot: jsonb("result_snapshot").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    terminalReason: text("terminal_reason"),
    releaseSource: text("release_source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // ONE Redemption per order — for every status, released included.
    uniqueIndex("discount_redemption_order_unique").on(t.orderId),
    uniqueIndex("discount_redemption_attempt_unique").on(t.checkoutAttemptId),
    foreignKey({ name: "discount_redemption_attempt_owner_fk", columns: [t.checkoutAttemptId, t.clientId],
      foreignColumns: [checkoutAttempts.id, checkoutAttempts.clientId] }).onDelete("restrict").onUpdate("restrict"),
    foreignKey({ name: "discount_redemption_attempt_order_fk", columns: [t.checkoutAttemptId, t.orderId],
      foreignColumns: [checkoutAttempts.id, checkoutAttempts.orderId] }).onDelete("restrict").onUpdate("restrict"),
    check("discount_redemption_owner_required", sql`${t.orderId} IS NOT NULL OR ${t.checkoutAttemptId} IS NOT NULL`),
    check("discount_redemption_consumed_order_required", sql`${t.status} <> 'consumed' OR ${t.orderId} IS NOT NULL`),
    // Composite ownership targets for `order_discount_allocation`.
    unique("discount_redemption_order_id_unique").on(t.orderId, t.id),
    unique("discount_redemption_id_benefit_unique").on(t.id, t.benefitId),
    // Redemption owner is the order owner (composite FK to orders(id,user_id)).
    foreignKey({
      name: "discount_redemption_order_owner_fk",
      columns: [t.orderId, t.clientId],
      foreignColumns: [orders.id, orders.userId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // Revision belongs to the named Offer.
    foreignKey({
      name: "discount_redemption_revision_ownership_fk",
      columns: [t.offerId, t.revisionId],
      foreignColumns: [discountOfferRevisions.offerId, discountOfferRevisions.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // Benefit belongs to the named revision.
    foreignKey({
      name: "discount_redemption_benefit_ownership_fk",
      columns: [t.revisionId, t.benefitId],
      foreignColumns: [discountBenefits.revisionId, discountBenefits.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // The manual code belongs to the named Offer (and the composite FK to
    // `(offer_id, activation_kind)` proved that Offer is manual-only).
    foreignKey({
      name: "discount_redemption_code_ownership_fk",
      columns: [t.offerId, t.codeId],
      foreignColumns: [discountCodes.offerId, discountCodes.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // Lifecycle lookups: released-but-expiring holds and per-Offer history.
    index("discount_redemption_status_deadline_idx").on(t.status, t.deadline),
    index("discount_redemption_offer_client_idx").on(
      t.offerId,
      t.clientId,
      t.createdAt
    ),
    check(
      "discount_redemption_activation_kind",
      sql`(${t.activationKind} = 'public' and ${t.codeId} is null)
        or (${t.activationKind} = 'manual_only' and ${t.codeId} is not null)`
    ),
    check(
      "discount_redemption_status_valid",
      sql`${t.status} in ('reserved', 'consumed', 'released')`
    ),
    check(
      "discount_redemption_benefit_amount_positive",
      sql`${t.benefitAmount} > 0 and ${t.benefitAmount} <= 9999999999999 and ${t.benefitAmount} = trunc(${t.benefitAmount})`
    ),
    check(
      "discount_redemption_versions_supported",
      sql`${t.policyVersion} >= 1 and ${t.contractVersion} = 1 and ${t.engineVersion} = 1`
    ),
    // Terminal timestamps must agree with the status: a consumed row has a
    // consumed_at and no released_at (and vice versa). A released row may later
    // receive a late_paid_review EVENT but never becomes consumed.
    check(
      "discount_redemption_terminal_timestamps",
      sql`(${t.status} = 'reserved' and ${t.consumedAt} is null and ${t.releasedAt} is null)
        or (${t.status} = 'consumed' and ${t.consumedAt} is not null and ${t.releasedAt} is null)
        or (${t.status} = 'released' and ${t.releasedAt} is not null and ${t.consumedAt} is null)`
    ),
    check(
      "discount_redemption_terms_bounded",
      sql`jsonb_typeof(${t.termsSnapshot}) = 'object' and octet_length(${t.termsSnapshot}::text) <= 4096`
    ),
    check(
      "discount_redemption_result_bounded",
      sql`jsonb_typeof(${t.resultSnapshot}) = 'object' and octet_length(${t.resultSnapshot}::text) <= 16384`
    ),
    check(
      "discount_redemption_terminal_reason_bounded",
      sql`${t.terminalReason} is null or char_length(${t.terminalReason}) <= 500`
    ),
    check(
      "discount_redemption_release_source_bounded",
      sql`${t.releaseSource} is null or char_length(${t.releaseSource}) <= 64`
    ),
  ]
);

/** Append-only lifecycle evidence. `event_key` is the authoritative idempotency
 * key (a duplicate/out-of-order callback is a no-op insert conflict, never a
 * counter decrement). No refund event exists: an external manual refund does
 * not build a sync/ledger/restore path. */
export const discountRedemptionEvents = pgTable(
  "discount_redemption_event",
  {
    id: text("id").primaryKey(),
    redemptionId: text("redemption_id")
      .notNull()
      .references(() => discountRedemptions.id, { onDelete: "restrict" }),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    source: text("source").notNull(),
    correlation: text("correlation"),
    reason: text("reason"),
    actorIdentity: text("actor_identity"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discount_redemption_event_key_unique").on(t.eventKey),
    index("discount_redemption_event_redemption_idx").on(
      t.redemptionId,
      t.createdAt
    ),
    check(
      "discount_redemption_event_transition_valid",
      sql`(${t.kind} = 'reserved' and ${t.previousStatus} is null and ${t.nextStatus} = 'reserved')
        or (${t.kind} = 'consumed' and ${t.previousStatus} = 'reserved' and ${t.nextStatus} = 'consumed')
        or (${t.kind} = 'released' and ${t.previousStatus} = 'reserved' and ${t.nextStatus} = 'released')
        or (${t.kind} = 'late_paid_review' and ${t.previousStatus} = 'released' and ${t.nextStatus} = 'released')`
    ),
    check(
      "discount_redemption_event_amount_positive",
      sql`${t.amount} > 0 and ${t.amount} <= 9999999999999 and ${t.amount} = trunc(${t.amount})`
    ),
    check(
      "discount_redemption_event_source_shape",
      sql`${t.source} ~ '^[a-z][a-z0-9_-]{0,31}$'`
    ),
    check(
      "discount_redemption_event_key_bounded",
      sql`char_length(${t.eventKey}) between 1 and 200`
    ),
    check(
      "discount_redemption_event_correlation_bounded",
      sql`${t.correlation} is null or char_length(${t.correlation}) <= 128`
    ),
    check(
      "discount_redemption_event_reason_bounded",
      sql`${t.reason} is null or char_length(${t.reason}) <= 500`
    ),
    check(
      "discount_redemption_event_actor_bounded",
      sql`${t.actorIdentity} is null or char_length(${t.actorIdentity}) between 1 and 128`
    ),
  ]
);

/** Per-line allocation evidence. Positive amounts only (a zero allocation is
 * never stored), Markdown is a separate component from the Offer slot, and an
 * Offer shipping subsidy has no item allocation (ticket 11). */
export const orderDiscountAllocations = pgTable(
  "order_discount_allocation",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    orderItemId: text("order_item_id"),
    component: text("component").notNull(),
    markdownRevisionId: text("markdown_revision_id"),
    redemptionId: text("redemption_id"),
    benefitId: text("benefit_id"),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One allocation per component per canonical cart line.
    uniqueIndex("order_discount_allocation_item_component_unique")
      .on(t.orderId, t.orderItemId, t.component)
      .where(sql`${t.component} in ('markdown', 'offer_goods')`),
    // At most one shipping subsidy allocation per Redemption.
    uniqueIndex("order_discount_allocation_shipping_unique")
      .on(t.redemptionId)
      .where(sql`${t.component} = 'offer_shipping'`),
    foreignKey({
      name: "order_discount_allocation_order_fk",
      columns: [t.orderId],
      foreignColumns: [orders.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // The item belongs to the same order.
    foreignKey({
      name: "order_discount_allocation_item_ownership_fk",
      columns: [t.orderId, t.orderItemId],
      foreignColumns: [orderItems.orderId, orderItems.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // The Redemption belongs to the same order.
    foreignKey({
      name: "order_discount_allocation_redemption_ownership_fk",
      columns: [t.orderId, t.redemptionId],
      foreignColumns: [discountRedemptions.orderId, discountRedemptions.id],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    // The benefit named by the allocation is the benefit of that Redemption.
    foreignKey({
      name: "order_discount_allocation_benefit_ownership_fk",
      columns: [t.redemptionId, t.benefitId],
      foreignColumns: [discountRedemptions.id, discountRedemptions.benefitId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("order_discount_allocation_order_idx").on(t.orderId),
    index("order_discount_allocation_redemption_idx").on(t.redemptionId),
    check(
      "order_discount_allocation_component_valid",
      sql`${t.component} in ('markdown', 'offer_goods', 'offer_shipping')`
    ),
    // Shape: Markdown is per item + revision without a Redemption; goods offer
    // is per item + Redemption + benefit; shipping is a Redemption + benefit
    // WITHOUT an item. Nothing else can be stored.
    check(
      "order_discount_allocation_shape_valid",
      sql`(${t.component} = 'markdown' and ${t.orderItemId} is not null and ${t.markdownRevisionId} is not null and ${t.redemptionId} is null and ${t.benefitId} is null)
        or (${t.component} = 'offer_goods' and ${t.orderItemId} is not null and ${t.markdownRevisionId} is null and ${t.redemptionId} is not null and ${t.benefitId} is not null)
        or (${t.component} = 'offer_shipping' and ${t.orderItemId} is null and ${t.markdownRevisionId} is null and ${t.redemptionId} is not null and ${t.benefitId} is not null)`
    ),
    check(
      "order_discount_allocation_amount_positive",
      sql`${t.amount} > 0 and ${t.amount} <= 9999999999999 and ${t.amount} = trunc(${t.amount})`
    ),
  ]
);

// =========================================================
// Relations
// =========================================================

export const discountCodesRelations = relations(discountCodes, ({ one }) => ({
  offer: one(discountOffers, {
    fields: [discountCodes.offerId],
    references: [discountOffers.id],
  }),
}));

export const discountOffersRelations = relations(discountOffers, ({ many, one }) => ({
  revisions: many(discountOfferRevisions),
  codes: many(discountCodes),
  usage: one(discountOfferUsage, {
    fields: [discountOffers.id],
    references: [discountOfferUsage.offerId],
  }),
}));

export const discountOfferRevisionsRelations = relations(
  discountOfferRevisions,
  ({ one }) => ({
    offer: one(discountOffers, {
      fields: [discountOfferRevisions.offerId],
      references: [discountOffers.id],
    }),
    benefit: one(discountBenefits, {
      fields: [discountOfferRevisions.id],
      references: [discountBenefits.revisionId],
    }),
  })
);

export const discountOfferUsageRelations = relations(
  discountOfferUsage,
  ({ one }) => ({
    offer: one(discountOffers, {
      fields: [discountOfferUsage.offerId],
      references: [discountOffers.id],
    }),
  })
);

export const discountAdminRequestsRelations = relations(
  discountAdminRequests,
  ({ one }) => ({
    actor: one(users, {
      fields: [discountAdminRequests.actorId],
      references: [users.id],
    }),
  })
);

export const discountClientUsageRelations = relations(
  discountClientUsage,
  ({ one }) => ({
    offer: one(discountOffers, {
      fields: [discountClientUsage.offerId],
      references: [discountOffers.id],
    }),
    client: one(clients, {
      fields: [discountClientUsage.clientId],
      references: [clients.id],
    }),
  })
);

export const discountRedemptionsRelations = relations(
  discountRedemptions,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [discountRedemptions.orderId],
      references: [orders.id],
    }),
    client: one(clients, {
      fields: [discountRedemptions.clientId],
      references: [clients.id],
    }),
    offer: one(discountOffers, {
      fields: [discountRedemptions.offerId],
      references: [discountOffers.id],
    }),
    code: one(discountCodes, {
      fields: [discountRedemptions.codeId],
      references: [discountCodes.id],
    }),
    events: many(discountRedemptionEvents),
    allocations: many(orderDiscountAllocations),
  })
);

export const discountRedemptionEventsRelations = relations(
  discountRedemptionEvents,
  ({ one }) => ({
    redemption: one(discountRedemptions, {
      fields: [discountRedemptionEvents.redemptionId],
      references: [discountRedemptions.id],
    }),
  })
);

export const orderDiscountAllocationsRelations = relations(
  orderDiscountAllocations,
  ({ one }) => ({
    order: one(orders, {
      fields: [orderDiscountAllocations.orderId],
      references: [orders.id],
    }),
    item: one(orderItems, {
      fields: [orderDiscountAllocations.orderItemId],
      references: [orderItems.id],
    }),
    redemption: one(discountRedemptions, {
      fields: [orderDiscountAllocations.redemptionId],
      references: [discountRedemptions.id],
    }),
  })
);
