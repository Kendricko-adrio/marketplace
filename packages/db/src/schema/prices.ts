import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  check,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

import { users } from "./auth";
import { productVariants } from "./products";

// =========================================================
// Manual Markdown price changes — batch, row, immutable revision, current
// pointer (spec §6.1, §6.3, §6.4, §8.1–§8.4)
// =========================================================
// Only the records this slice writes are declared here:
//
//   price_change_batch       one staged/admin command (manual, bulk, xlsx)
//   price_change_batch_row   one input row + its staged preview/durable result
//   variant_price_revision   immutable before/after revision per applied row
//   variant_price_current    the ONE current pointer per variant (never reset)
//   price_change_apply_request  accepted apply/resume command ledger (key replay)
//
// Markdown is a read PROJECTION of `(source price, stored target)`; the target is
// never written into `product_variant.price`. A source sync only writes the
// source, so a fallback target stays stored and becomes active again when the
// source rises. Ordinary CHECK constraints cannot enforce cross-row sums or
// immutability — those are module/write-path guarantees (spec §8.2).
//
// FK direction note: `variant_price_revision.batch_row_id` intentionally has NO
// foreign key to `price_change_batch_row`, while the row's
// `applied_revision_id` DOES reference the revision. A two-way FK would be a
// cycle that neither side could delete first during an FK-ordered seeder clean;
// the revision's UNIQUE(batch_row_id) is the ownership/attribution proof and the
// apply transaction writes both rows together.

const MONEY_MAX = sql`9999999999999`;

function wholeMoneyCheck(name: string, column: AnyPgColumn) {
  return check(
    name,
    sql`${column} is null or (${column} >= 0 and ${column} <= ${MONEY_MAX} and ${column} = trunc(${column}))`
  );
}

/** One staged price-change command. `request_key` is the idempotency key scoped
 * to an immutable actor identity, so a lost response replays the SAME batch
 * (never a second batch or a second audit). Counts always sum to `row_count`. */
export const priceChangeBatches = pgTable(
  "price_change_batch",
  {
    id: text("id").primaryKey(),
    actorIdentity: text("actor_identity").notNull(),
    requestKey: text("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    source: text("source").notNull(),
    templateVersion: text("template_version"),
    parentBatchId: text("parent_batch_id"),
    reason: text("reason"),
    state: text("state").notNull().default("staged"),
    rowCount: integer("row_count").notNull(),
    appliedCount: integer("applied_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    haltReason: text("halt_reason"),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("price_change_batch_actor_key_unique").on(
      t.actorIdentity,
      t.requestKey
    ),
    foreignKey({
      name: "price_change_batch_parent_fk",
      columns: [t.parentBatchId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    check(
      "price_change_batch_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
    check(
      "price_change_batch_request_key_uuid",
      sql`${t.requestKey} ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
    ),
    check(
      "price_change_batch_fingerprint_sha256",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "price_change_batch_source_supported",
      sql`${t.source} in ('manual', 'bulk', 'xlsx')`
    ),
    check(
      "price_change_batch_template_version_shape",
      sql`${t.templateVersion} is null or (${t.templateVersion} = 'OKCIR_MARKDOWN_V1')`
    ),
    check(
      "price_change_batch_reason_shape",
      sql`${t.reason} is null or char_length(btrim(${t.reason})) between 1 and 500`
    ),
    check(
      "price_change_batch_state_supported",
      sql`${t.state} in ('staged', 'in_progress', 'applied', 'partially_applied', 'failed')`
    ),
    check(
      "price_change_batch_row_count_bounded",
      sql`${t.rowCount} >= 1 and ${t.rowCount} <= 2147483647`
    ),
    check(
      "price_change_batch_counts_bounded",
      sql`${t.appliedCount} >= 0 and ${t.appliedCount} <= 2147483647 and ${t.unchangedCount} >= 0 and ${t.unchangedCount} <= 2147483647 and ${t.failedCount} >= 0 and ${t.failedCount} <= 2147483647 and ${t.pendingCount} >= 0 and ${t.pendingCount} <= 2147483647`
    ),
    // Counts always describe the WHOLE batch (spec §6.4).
    check(
      "price_change_batch_counts_sum",
      sql`${t.appliedCount} + ${t.unchangedCount} + ${t.failedCount} + ${t.pendingCount} = ${t.rowCount}`
    ),
    check(
      "price_change_batch_halt_reason_shape",
      sql`${t.haltReason} is null or char_length(${t.haltReason}) between 1 and 500`
    ),
    index("idx_price_change_batch_parent").on(t.parentBatchId),
    index("idx_price_change_batch_state_created").on(t.state, t.createdAt),
  ]
);

/** Immutable applied revision: the actual source/current-target/effective
 * before and after ONE apply. `markdown_active` and `effective_unit_price` are
 * enforced against `target`/`source` by CHECK, so a stored revision can never
 * claim a coretan that the numbers do not support. */
export const variantPriceRevisions = pgTable(
  "variant_price_revision",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    revisionNo: integer("revision_no").notNull(),
    action: text("action").notNull(),
    /** Stored target AFTER the action; null only for `restore_base`. */
    targetUnitPrice: numeric("target_unit_price", { precision: 15, scale: 2 }),
    /** Source (Jubelio base) at apply time. */
    sourceUnitPrice: numeric("source_unit_price", {
      precision: 15,
      scale: 2,
    }).notNull(),
    effectiveUnitPrice: numeric("effective_unit_price", {
      precision: 15,
      scale: 2,
    }).notNull(),
    previousTargetUnitPrice: numeric("previous_target_unit_price", {
      precision: 15,
      scale: 2,
    }),
    previousEffectiveUnitPrice: numeric("previous_effective_unit_price", {
      precision: 15,
      scale: 2,
    }).notNull(),
    markdownActive: boolean("markdown_active").notNull(),
    previousMarkdownActive: boolean("previous_markdown_active").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => priceChangeBatches.id, { onDelete: "restrict" }),
    /** Attribution to the exact batch row; UNIQUE below plus the module
     * transaction prove ownership without a FK cycle (see file header). */
    batchRowId: text("batch_row_id").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorIdentity: text("actor_identity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("variant_price_revision_variant_no_unique").on(
      t.variantId,
      t.revisionNo
    ),
    // Composite ownership target for `variant_price_current`.
    unique("variant_price_revision_variant_id_unique").on(t.variantId, t.id),
    // One revision per batch row: replay can never write a second revision.
    uniqueIndex("variant_price_revision_batch_row_unique").on(t.batchRowId),
    check("variant_price_revision_no_positive", sql`${t.revisionNo} >= 1`),
    check(
      "variant_price_revision_action_supported",
      sql`${t.action} in ('set_price', 'restore_base')`
    ),
    // set_price is validated against the latest source at apply, so an applied
    // set always has 0 < target < source (an inactive target only appears later,
    // when the SOURCE moves; the revision is never rewritten).
    check(
      "variant_price_revision_target_shape",
      sql`(${t.action} = 'set_price' and ${t.targetUnitPrice} > 0 and ${t.targetUnitPrice} < ${t.sourceUnitPrice}) or (${t.action} = 'restore_base' and ${t.targetUnitPrice} is null)`
    ),
    check(
      "variant_price_revision_markdown_consistency",
      sql`${t.markdownActive} = (${t.targetUnitPrice} is not null)`
    ),
    check(
      "variant_price_revision_effective_consistency",
      sql`${t.effectiveUnitPrice} = case when ${t.targetUnitPrice} is not null then ${t.targetUnitPrice} else ${t.sourceUnitPrice} end`
    ),
    check(
      "variant_price_revision_previous_markdown_consistency",
      sql`${t.previousMarkdownActive} = (${t.previousTargetUnitPrice} is not null and ${t.previousTargetUnitPrice} < ${t.sourceUnitPrice})`
    ),
    check(
      "variant_price_revision_previous_effective_consistency",
      sql`${t.previousEffectiveUnitPrice} = case when ${t.previousMarkdownActive} then ${t.previousTargetUnitPrice} else ${t.sourceUnitPrice} end`
    ),
    check(
      "variant_price_revision_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
    wholeMoneyCheck("variant_price_revision_target_bounded", t.targetUnitPrice),
    check(
      "variant_price_revision_source_bounded",
      sql`${t.sourceUnitPrice} >= 0 and ${t.sourceUnitPrice} <= ${MONEY_MAX} and ${t.sourceUnitPrice} = trunc(${t.sourceUnitPrice})`
    ),
    check(
      "variant_price_revision_effective_bounded",
      sql`${t.effectiveUnitPrice} >= 0 and ${t.effectiveUnitPrice} <= ${MONEY_MAX} and ${t.effectiveUnitPrice} = trunc(${t.effectiveUnitPrice})`
    ),
    wholeMoneyCheck(
      "variant_price_revision_previous_target_bounded",
      t.previousTargetUnitPrice
    ),
    check(
      "variant_price_revision_previous_effective_bounded",
      sql`${t.previousEffectiveUnitPrice} >= 0 and ${t.previousEffectiveUnitPrice} <= ${MONEY_MAX} and ${t.previousEffectiveUnitPrice} = trunc(${t.previousEffectiveUnitPrice})`
    ),
    index("idx_variant_price_revision_batch").on(t.batchId),
  ]
);

/** One input row of a batch. The preview is a bounded, non-authoritative record
 * of what the reviewer saw; apply re-reads the latest source/current Markdown
 * and stores the ACTUAL before/after in the money columns. */
export const priceChangeBatchRows = pgTable(
  "price_change_batch_row",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => priceChangeBatches.id, { onDelete: "restrict" }),
    rowNumber: integer("row_number").notNull(),
    inputSku: text("input_sku").notNull(),
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    targetUnitPrice: numeric("target_unit_price", { precision: 15, scale: 2 }),
    previewJson: jsonb("preview_json").notNull(),
    state: text("state").notNull().default("pending"),
    resultCode: text("result_code"),
    previousTargetUnitPrice: numeric("previous_target_unit_price", {
      precision: 15,
      scale: 2,
    }),
    previousEffectiveUnitPrice: numeric("previous_effective_unit_price", {
      precision: 15,
      scale: 2,
    }),
    previousMarkdownActive: boolean("previous_markdown_active"),
    sourceUnitPrice: numeric("source_unit_price", { precision: 15, scale: 2 }),
    targetUnitPriceAfter: numeric("target_unit_price_after", {
      precision: 15,
      scale: 2,
    }),
    effectiveUnitPrice: numeric("effective_unit_price", {
      precision: 15,
      scale: 2,
    }),
    markdownActive: boolean("markdown_active"),
    appliedRevisionId: text("applied_revision_id"),
    originRetryRowId: text("origin_retry_row_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("price_change_batch_row_number_unique").on(
      t.batchId,
      t.rowNumber
    ),
    foreignKey({
      name: "price_change_batch_row_applied_revision_fk",
      columns: [t.appliedRevisionId],
      foreignColumns: [variantPriceRevisions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "price_change_batch_row_origin_retry_fk",
      columns: [t.originRetryRowId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    check(
      "price_change_batch_row_number_positive",
      sql`${t.rowNumber} >= 1`
    ),
    check(
      "price_change_batch_row_input_sku_shape",
      // A workbook row that failed parsing can have no SKU at all; it is stored
      // as a FINAL failed row so the report/subset can name the exact row.
      sql`(${t.state} = 'failed' and char_length(${t.inputSku}) between 0 and 128) or char_length(${t.inputSku}) between 1 and 128`
    ),
    check(
      "price_change_batch_row_action_supported",
      // `invalid` only ever describes an unparseable workbook row (fatal-row
      // data, never a pending row the apply pipeline could execute).
      sql`${t.action} in ('set_price', 'restore_base', 'invalid')`
    ),
    check(
      "price_change_batch_row_invalid_action_is_failed",
      sql`${t.action} <> 'invalid' or ${t.state} = 'failed'`
    ),
    check(
      "price_change_batch_row_target_shape",
      sql`(${t.action} = 'set_price' and ${t.targetUnitPrice} is not null and ${t.targetUnitPrice} > 0) or (${t.action} = 'restore_base' and ${t.targetUnitPrice} is null) or (${t.action} = 'invalid' and ${t.targetUnitPrice} is null) or (${t.state} = 'failed' and ${t.targetUnitPrice} is null)`
    ),
    check(
      "price_change_batch_row_preview_bounded",
      sql`octet_length(${t.previewJson}::text) <= 16384`
    ),
    check(
      "price_change_batch_row_state_supported",
      sql`${t.state} in ('pending', 'applied', 'unchanged', 'failed')`
    ),
    check(
      "price_change_batch_row_result_code_shape",
      sql`${t.resultCode} is null or ${t.resultCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`
    ),
    check(
      "price_change_batch_row_applied_revision_matches_state",
      sql`(${t.state} = 'applied') = (${t.appliedRevisionId} is not null)`
    ),
    check(
      "price_change_batch_row_retry_not_self",
      sql`${t.originRetryRowId} is null or ${t.originRetryRowId} <> ${t.id}`
    ),
    wholeMoneyCheck(
      "price_change_batch_row_target_bounded",
      t.targetUnitPrice
    ),
    wholeMoneyCheck(
      "price_change_batch_row_previous_target_bounded",
      t.previousTargetUnitPrice
    ),
    wholeMoneyCheck(
      "price_change_batch_row_previous_effective_bounded",
      t.previousEffectiveUnitPrice
    ),
    wholeMoneyCheck(
      "price_change_batch_row_source_bounded",
      t.sourceUnitPrice
    ),
    wholeMoneyCheck(
      "price_change_batch_row_target_after_bounded",
      t.targetUnitPriceAfter
    ),
    wholeMoneyCheck(
      "price_change_batch_row_effective_bounded",
      t.effectiveUnitPrice
    ),
    index("idx_price_change_batch_row_status").on(
      t.batchId,
      t.state,
      t.rowNumber
    ),
    index("idx_price_change_batch_row_variant").on(t.variantId),
    index("idx_price_change_batch_row_origin_retry").on(t.originRetryRowId),
  ]
);

/** One ACCEPTED apply/resume command. `(actor_identity, request_key)` is the
 * idempotency ledger for apply: the same key on the same batch with the same
 * review digest resumes/replays the SAME chunk (no second row result), while the
 * same key with a different batch/digest is a 409 REQUEST_KEY_CONFLICT. The
 * ledger is never deleted, so a retry after a lost response cannot silently
 * become a different command. */
export const priceChangeApplyRequests = pgTable(
  "price_change_apply_request",
  {
    id: text("id").primaryKey(),
    actorIdentity: text("actor_identity").notNull(),
    requestKey: text("request_key").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => priceChangeBatches.id, { onDelete: "restrict" }),
    previewDigest: text("preview_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One key per actor across EVERY batch: a reused key with a different
    // payload is a conflict, never a second accepted command.
    uniqueIndex("price_change_apply_request_actor_key_unique").on(
      t.actorIdentity,
      t.requestKey
    ),
    check(
      "price_change_apply_request_actor_identity_shape",
      sql`char_length(${t.actorIdentity}) between 1 and 128`
    ),
    check(
      "price_change_apply_request_request_key_uuid",
      sql`${t.requestKey} ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
    ),
    check(
      "price_change_apply_request_digest_shape",
      sql`${t.previewDigest} is null or char_length(${t.previewDigest}) between 1 and 128`
    ),
    index("idx_price_change_apply_request_batch").on(t.batchId),
  ]
);

/** The ONE current pointer per variant. Restore moves the pointer to a new
 * revision instead of deleting history, so `version` (the pointed revision
 * number) is monotonic and never reset. */
export const variantPriceCurrent = pgTable(
  "variant_price_current",
  {
    variantId: text("variant_id")
      .primaryKey()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    revisionId: text("revision_id").notNull(),
    version: integer("version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "variant_price_current_revision_ownership_fk",
      columns: [t.variantId, t.revisionId],
      foreignColumns: [variantPriceRevisions.variantId, variantPriceRevisions.id],
    }).onDelete("restrict"),
    check("variant_price_current_version_positive", sql`${t.version} >= 1`),
  ]
);

// =========================================================
// Relations
// =========================================================

export const priceChangeBatchesRelations = relations(
  priceChangeBatches,
  ({ many }) => ({
    rows: many(priceChangeBatchRows),
    revisions: many(variantPriceRevisions),
    applyRequests: many(priceChangeApplyRequests),
  })
);

export const priceChangeApplyRequestsRelations = relations(
  priceChangeApplyRequests,
  ({ one }) => ({
    batch: one(priceChangeBatches, {
      fields: [priceChangeApplyRequests.batchId],
      references: [priceChangeBatches.id],
    }),
  })
);

export const priceChangeBatchRowsRelations = relations(
  priceChangeBatchRows,
  ({ one }) => ({
    batch: one(priceChangeBatches, {
      fields: [priceChangeBatchRows.batchId],
      references: [priceChangeBatches.id],
    }),
    variant: one(productVariants, {
      fields: [priceChangeBatchRows.variantId],
      references: [productVariants.id],
    }),
  })
);

export const variantPriceRevisionsRelations = relations(
  variantPriceRevisions,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [variantPriceRevisions.variantId],
      references: [productVariants.id],
    }),
    batch: one(priceChangeBatches, {
      fields: [variantPriceRevisions.batchId],
      references: [priceChangeBatches.id],
    }),
  })
);

export const variantPriceCurrentRelations = relations(
  variantPriceCurrent,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [variantPriceCurrent.variantId],
      references: [productVariants.id],
    }),
    revision: one(variantPriceRevisions, {
      fields: [variantPriceCurrent.revisionId],
      references: [variantPriceRevisions.id],
    }),
  })
);
