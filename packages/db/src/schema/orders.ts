import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  jsonb,
  index,
  check,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { clients, users } from "./auth";
import { productVariants } from "./products";
import { branches } from "./branches";

// =========================================================
// Ticket 04 — the immutable delivery snapshot payload (JSONB).
// Exactly the five quote blocks: the canonical destination address (Shipment
// region ids stay STRINGS incl. leading zeros), the origin sender block, the
// parcel envelope (grams/cm), the chosen service and the approved order-
// pricing strings. No quote id/ttl/readiness flag — an immutable plain
// payload that re-payment and the settlement gate read exclusively.
// =========================================================
export interface DeliveryAddressBlock {
  recipientName: string;
  phone: string;
  fullAddress: string;
  provinceId: string;
  province: string;
  cityId: string;
  city: string;
  districtId: string;
  district: string;
  areaId: string;
  area: string;
  postalCode: string;
}

export interface DeliveryOriginBlock {
  branchId: string;
  name: string;
  phone: string;
  address: string;
  zipcode: string;
  areaId: string | null;
}

export interface DeliveryParcelBlock {
  weight: number;
  items: Array<{
    item_name: string;
    quantity: number;
    value?: number;
    weight: number;
    length: number;
    width: number;
    height: number;
  }>;
}

export interface DeliveryServiceBlock {
  courierId: number;
  serviceId: number;
  name: string;
  shippingCost: string | number;
  validEta?: { from: string; to: string };
}

export interface DeliveryPricingBlock {
  subtotal: string;
  discount: string;
  taxableBase: string;
  shippingCost: string;
  serviceFee: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
}

export interface DeliverySnapshotPayload {
  address: DeliveryAddressBlock;
  origin: DeliveryOriginBlock;
  parcel: DeliveryParcelBlock;
  service: DeliveryServiceBlock;
  pricing: DeliveryPricingBlock;
}

// =========================================================
// Ticket 01 diskon — snapshot uang checkout berversi (spec §8.3).
//
// Tipe payload ini SELF-CONTAINED di paket schema: apps hanya membaca tipe dari
// sini (tidak ada import app → schema), sehingga schema/type/calculator tidak
// bisa drift. `jsonb().$type<T>()` hanya bantuan compile-time — payload runtime
// tetap `unknown` dan WAJIB lewat decoder strict di aplikasi.
//
// Semua nominal adalah Rupiah utuh exact (decimal string), versi kontrak baru
// pricing1/engine1/provider2. Baris legacy tidak punya payload ini.
// =========================================================
export interface PricingSnapshotLinePayload {
  variantId: string;
  quantity: number;
  /** Harga source (Base Price) per unit. */
  sourceUnitPrice: string;
  /** Harga efektif per unit setelah Markdown (baseline = source). */
  effectiveUnitPrice: string;
  sourceLineAmount: string;
  markdownAmount: string;
  goodsDiscountAmount: string;
  netLineAmount: string;
  markdownRevisionId: string | null;
}

export interface PricingSnapshotPayloadV1 {
  pricingContractVersion: 1;
  pricingEngineVersion: 1;
  providerContractVersion: 2;
  currency: "IDR";
  fulfillmentMethod: "pickup" | "delivery";
  sourceGoodsSubtotal: string;
  markdownTotal: string;
  /** Subtotal setelah Markdown, sebelum kupon barang. */
  subtotal: string;
  goodsDiscount: string;
  netGoods: string;
  shippingBeforeSubsidy: string;
  shippingSubsidy: string;
  /** Net ongkir customer (bukan biaya quote/booking provider). */
  shippingCost: string;
  merchantFunding: string;
  serviceFee: string;
  taxableBase: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
  expectedProviderPayable: string;
  providerQuotedShippingCost: string | null;
  providerBilledShippingCost: string | null;
  lines: PricingSnapshotLinePayload[];
}

// Addresses table (belongs to store clients).
// Ticket 02 (Jubelio Shipment): the origin/destination region chain is stored
// as STRING IDs incl. leading zeros (never numbers, e.g. "01", "3174021004")
// plus province/area labels; city/district labels reuse the existing
// city/district columns. All new columns are nullable so legacy rows and the
// seeded address stay valid; rows written by the new address-book seam always
// carry the region chain that the gateway verified server-side.
export const addresses = pgTable("address", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  provinceId: text("province_id"),
  cityId: text("city_id"),
  districtId: text("district_id"),
  areaId: text("area_id"),
  province: text("province"),
  area: text("area"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  fullAddress: text("full_address").notNull(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  postalCode: text("postal_code").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Ticket 02: at most ONE default address per client. Partial unique index —
  // legacy rows (is_default = false) are unaffected by this rule.
  uniqueIndex("address_default_per_client_unique")
    .on(t.userId)
    .where(sql`${t.isDefault} = true`),
]);

// Orders table (belongs to store clients).
// Retained transaction history: deleting a client must not erase its orders.
// Phase 1 (pickup-in-store) uses English statuses and pickup fields.
// addressId/shippingCarrier/trackingNumber/shippingCost are retained but
// nullable for future Phase 2 shipping support.
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "restrict" }),
  branchId: text("branch_id").references(() => branches.id),
  // Ticket 02: removing a book address must not block on this FK. The order
  // carries its own immutable address snapshot (ticket 04) — the reference
  // nulls out on book deletion instead of cascading or rejecting.
  addressId: text("address_id").references(() => addresses.id, {
    onDelete: "set null",
  }),
  voucherId: text("voucher_id"),
  // pending_payment | processing | ready_for_pickup | completed | cancelled | failed_payment
  // - cancelled: manual cancellation (by user or admin)
  // - failed_payment: Midtrans gateway reported failure (terminal `expire`
  //   callback or the TTL sweep). deny/cancel are non-terminal attempts and do
  //   not fail the order — the customer may retry with another method on Snap.
  status: text("status").notNull().default("pending_payment"),
  // Authoritative Midtrans payment_type (e.g. qris | gopay | credit_card |
  // bank_transfer | echannel | bca_va), persisted at finalization from the
  // GET /v2/{order_id}/status response. NULL until the customer picks a method
  // on the hosted Snap page.
  paymentMethod: text("payment_method"),
  paymentStatus: text("payment_status")
    .notNull()
    .default("pending"), // pending | paid | failed
  // Human-readable reason set when a Midtrans callback marks the order as failed_payment.
  // e.g. "Payment expired â€” user did not complete payment in time"
  paymentFailureReason: text("payment_failure_reason"),
  // Raw Midtrans transaction_status stored alongside paymentFailureReason for debugging.
  midtransFailureStatus: text("midtrans_failure_status"),
  // Pickup-in-store fields (Phase 1)
  pickupCode: text("pickup_code"), // 6-char uppercase alphanumeric, set on payment success
  pickupVerificationAttempts: integer("pickup_verification_attempts")
    .notNull()
    .default(0),
  pickupLockedUntil: timestamp("pickup_locked_until", { withTimezone: true }),
  pickupDate: timestamp("pickup_date", { withTimezone: true }),
  pickupTime: text("pickup_time"), // "HH:mm"
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email").notNull(),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull(),
  shippingCost: numeric("shipping_cost", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  discount: numeric("discount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  serviceFee: numeric("service_fee", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  // Immutable PPN pricing snapshot. Re-payment must use these values rather
  // than the current system configuration.
  ppnRate: numeric("ppn_rate", { precision: 9, scale: 6 })
    .notNull()
    .default("0"),
  ppnAmount: numeric("ppn_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  total: numeric("total", { precision: 15, scale: 2 }).notNull(),
  // ===== Ticket 01 diskon — kontrak uang berversi (spec §8.3) =====
  // Versi default 0 = baris legacy: kolom money kontrak baru tetap NULL dan
  // dibaca decoder legacy eksplisit, tanpa backfill fiktif.
  pricingContractVersion: integer("pricing_contract_version").notNull().default(0),
  pricingEngineVersion: integer("pricing_engine_version").notNull().default(0),
  providerContractVersion: integer("provider_contract_version").notNull().default(0),
  pricingCurrency: text("pricing_currency"),
  sourceGoodsSubtotal: numeric("source_goods_subtotal", { precision: 15, scale: 2 }),
  markdownTotal: numeric("markdown_total", { precision: 15, scale: 2 }),
  // Net barang setelah Markdown + kupon barang.
  netGoods: numeric("net_goods", { precision: 15, scale: 2 }),
  // Ongkir quote asli sebelum subsidi (pickup = 0).
  shippingBeforeSubsidy: numeric("shipping_before_subsidy", { precision: 15, scale: 2 }),
  shippingSubsidy: numeric("shipping_subsidy", { precision: 15, scale: 2 }),
  merchantFunding: numeric("merchant_funding", { precision: 15, scale: 2 }),
  taxableBase: numeric("taxable_base", { precision: 15, scale: 2 }),
  // Net barang + net ongkir: nominal SO/invoice/payment provider kontrak2.
  expectedProviderPayable: numeric("expected_provider_payable", { precision: 15, scale: 2 }),
  // Biaya kurir/provider: quote diketahui sekarang, billed menyusul lewat
  // shipment ledger existing; keduanya terpisah dari harga customer.
  providerQuotedShippingCost: numeric("provider_quoted_shipping_cost", { precision: 15, scale: 2 }),
  providerBilledShippingCost: numeric("provider_billed_shipping_cost", { precision: 15, scale: 2 }),
  // Snapshot typed+bounded; pembacaan WAJIB lewat decoder aplikasi.
  pricingSnapshot: jsonb("pricing_snapshot").$type<PricingSnapshotPayloadV1>(),
  // Midtrans transaction_id from the authoritative GET status response
  // (repurposed legacy column from the Core API era; never written from the
  // raw webhook body), nullable until finalization.
  midtransTransactionId: text("midtrans_transaction_id"),
  // Midtrans Snap redirect URL, saved so user can resume payment if they navigate away
  snapRedirectUrl: text("snap_redirect_url"),
  // Confirmed remote Jubelio Sales Order id (persisted only after the
  // independent GET /sales/orders/{id} verification). NULL for legacy
  // adjustment-era orders.
  jubelioSalesOrderId: integer("jubelio_sales_order_id"),
  // Confirmed remote Jubelio invoice id (the Sales Invoice Number returned by
  // /sales/packlists/create-invoice, persisted before payment and verified via
  // GET /sales/invoices/{id}).
  jubelioInvoiceId: integer("jubelio_invoice_id"),
  // Confirmed remote Jubelio invoice payment id (from POST /sales/payments/,
  // persisted only after a verified GET /sales/payments/{id}).
  jubelioPaymentId: integer("jubelio_payment_id"),
  // Why a PAID order is blocked from ready_for_pickup/pickup codes (Sales-Order
  // settlement is unverified or ambiguous). NULL means fulfillment is not
  // blocked. A non-null value keeps the order paid but never exposes a pickup
  // code; the case is visible in the admin review queue.
  fulfillmentBlockedReason: text("fulfillment_blocked_reason"),
  // Ticket 04 — fulfillment method: `pickup` (Phase 1) or `delivery`
  // (Jubelio Shipment, quote → SO goods-only → Midtrans incl. ongkir/PPN).
  // Delivery orders are settled into `processing` forever without a pickup
  // code (no ready_for_pickup transition); ticket 05 owns the booking stage.
  fulfillmentMethod: text("fulfillment_method").notNull().default("pickup"),
  // Ticket 04 — immutable delivery snapshot (JSONB): canonical destination
  // address, origin sender block, parcel envelope, chosen service and the
  // approved order-pricing strings. Deep-independent: later edits to the
  // address book, branch origin, master parcel, config or pricing can never
  // rewrite it; re-payment and settlement read ONLY this persisted payload.
  deliverySnapshot: jsonb("delivery_snapshot").$type<DeliverySnapshotPayload>(),
  deliveryFailureCode: text("delivery_failure_code"),
  deliveryFailureAt: timestamp("delivery_failure_at", { withTimezone: true }),
  deliveryFailureBy: text("delivery_failure_by").references(() => users.id),
  deliveryManualReason: text("delivery_manual_reason"),
  deliveryManualAt: timestamp("delivery_manual_at", { withTimezone: true }),
  deliveryManualBy: text("delivery_manual_by").references(() => users.id),
  // Phase 2 shipping fields (nullable, unused in Phase 1)
  shippingCarrier: text("shipping_carrier"),
  trackingNumber: text("tracking_number"),
  // When a pending_payment order is considered expired and its stock reservation
  // should be released. Set at place-order = createdAt + reservation.ttlMinutes
  // (see system_config). The sweep cron and the Midtrans `expire` webhook key off
  // this. Nullable for legacy rows (backfilled by migration).
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Supports the sweep cron's batch lookup of stale pending_payment orders
  // (WHERE status = 'pending_payment' AND expires_at < now()).
  statusExpiresIdx: index("idx_orders_status_expires").on(t.status, t.expiresAt),
  // Analytics: rolling-window KPI aggregates and the 30-day WIB trend filter
  // on created_at (optionally combined with the branch predicate).
  createdAtIdx: index("idx_orders_created_at").on(t.createdAt),
  branchCreatedAtIdx: index("idx_orders_branch_created_at").on(
    t.branchId,
    t.createdAt
  ),
  pickupCodeUniqueIdx: uniqueIndex("orders_pickup_code_unique").on(t.pickupCode),
  statusCheck: check(
    "orders_status_valid",
    sql`${t.status} in ('pending_payment', 'processing', 'ready_for_pickup', 'completed', 'cancelled', 'failed_payment')`
  ),
  paymentStatusCheck: check(
    "orders_payment_status_valid",
    sql`${t.paymentStatus} in ('pending', 'paid', 'failed')`
  ),
  amountCheck: check(
    "orders_amounts_nonnegative",
    sql`${t.subtotal} >= 0 and ${t.shippingCost} >= 0 and ${t.discount} >= 0 and ${t.serviceFee} >= 0 and ${t.ppnAmount} >= 0 and ${t.total} >= 0`
  ),
  ppnRateCheck: check(
    "orders_ppn_rate_valid",
    sql`${t.ppnRate} >= 0 and ${t.ppnRate} <= 100`
  ),
  // Ticket 04: the fulfillment method gates the delivery pipeline; pickup
  // rows keep the legacy default.
  fulfillmentMethodCheck: check(
    "orders_fulfillment_method_valid",
    sql`${t.fulfillmentMethod} in ('pickup', 'delivery')`
  ),
  // Ticket 07 — the failure marker is code-whitelisted; the manual finish
  // evidence is complete when present; the two never coexist (a packing-fail
  // is itself a resolution, not a finishable state).
  failureCodeCheck: check(
    "orders_delivery_failure_code_valid",
    sql`${t.deliveryFailureCode} is null or ${t.deliveryFailureCode} in
        ('physical_stock_unavailable', 'damaged_goods', 'paid_service_limits_exceeded')`
  ),
  manualFinishCheck: check(
    "orders_delivery_manual_fields_complete",
    sql`(${t.deliveryManualReason} is null or (${t.deliveryManualReason} <> ''
         and ${t.deliveryManualAt} is not null and ${t.deliveryManualBy} is not null))`
  ),
  failureManualExclusiveCheck: check(
    "orders_delivery_failure_manual_exclusive",
    sql`not (${t.deliveryFailureCode} is not null and ${t.deliveryManualReason} is not null)`
  ),
  pickupAttemptsCheck: check(
    "orders_pickup_attempts_nonnegative",
    sql`${t.pickupVerificationAttempts} >= 0`
  ),
  // Ticket 01 — hanya kombinasi versi yang sah yang boleh tersimpan: baris
  // legacy 0/0/0 dan baris kontrak baru pricing1/engine1/provider2. Kombinasi
  // silang (mis. pricing0 dengan engine1) ditolak agar reader yang fail-closed
  // tidak pernah menemukan baris yang mustahil.
  pricingVersionsCheck: check(
    "orders_pricing_versions_valid",
    sql`(${t.pricingContractVersion} = 0
          and ${t.pricingEngineVersion} = 0
          and ${t.providerContractVersion} = 0)
        or (${t.pricingContractVersion} = 1
          and ${t.pricingEngineVersion} = 1
          and ${t.providerContractVersion} = 2)`
  ),
  pricingCurrencyCheck: check(
    "orders_pricing_currency_valid",
    sql`${t.pricingCurrency} is null or ${t.pricingCurrency} = 'IDR'`
  ),
  pricingAmountsCheck: check(
    "orders_pricing_amounts_nonnegative",
    sql`(${t.sourceGoodsSubtotal} is null or ${t.sourceGoodsSubtotal} >= 0)
        and (${t.markdownTotal} is null or ${t.markdownTotal} >= 0)
        and (${t.netGoods} is null or ${t.netGoods} >= 0)
        and (${t.shippingBeforeSubsidy} is null or ${t.shippingBeforeSubsidy} >= 0)
        and (${t.shippingSubsidy} is null or ${t.shippingSubsidy} >= 0)
        and (${t.merchantFunding} is null or ${t.merchantFunding} >= 0)
        and (${t.taxableBase} is null or ${t.taxableBase} >= 0)
        and (${t.expectedProviderPayable} is null or ${t.expectedProviderPayable} >= 0)
        and (${t.providerQuotedShippingCost} is null or ${t.providerQuotedShippingCost} >= 0)
        and (${t.providerBilledShippingCost} is null or ${t.providerBilledShippingCost} >= 0)`
  ),
  // Kontrak baru wajib LENGKAP dan konsisten: currency eksplisit, snapshot ada,
  // semua money (new + kolom lama yang dipakai ulang) Rupiah utuh nonnegatif
  // dalam bound 9999999999999, fee 0, dan biaya quote/billed bila diketahui juga
  // exact. `<= bound` sekaligus menolak numeric NaN pada Postgres (NaN >= 0 TRUE
  // dan NaN = trunc(NaN) TRUE, tetapi NaN <= x FALSE). Baris legacy (version 0)
  // tidak dipaksa sehingga semantik numeric legacy (cents) tetap utuh.
  pricingSnapshotCompleteCheck: check(
    "orders_pricing_snapshot_complete",
    sql`${t.pricingContractVersion} <> 1 or (
        ${t.pricingCurrency} is not null
        and ${t.pricingCurrency} = 'IDR'
        and ${t.pricingSnapshot} is not null
        and ${t.sourceGoodsSubtotal} is not null
        and ${t.sourceGoodsSubtotal} >= 0
        and ${t.sourceGoodsSubtotal} = trunc(${t.sourceGoodsSubtotal})
        and ${t.sourceGoodsSubtotal} <= 9999999999999
        and ${t.markdownTotal} is not null
        and ${t.markdownTotal} >= 0
        and ${t.markdownTotal} = trunc(${t.markdownTotal})
        and ${t.markdownTotal} <= 9999999999999
        and ${t.netGoods} is not null
        and ${t.netGoods} >= 0
        and ${t.netGoods} = trunc(${t.netGoods})
        and ${t.netGoods} <= 9999999999999
        and ${t.shippingBeforeSubsidy} is not null
        and ${t.shippingBeforeSubsidy} >= 0
        and ${t.shippingBeforeSubsidy} = trunc(${t.shippingBeforeSubsidy})
        and ${t.shippingBeforeSubsidy} <= 9999999999999
        and ${t.shippingSubsidy} is not null
        and ${t.shippingSubsidy} >= 0
        and ${t.shippingSubsidy} = trunc(${t.shippingSubsidy})
        and ${t.shippingSubsidy} <= 9999999999999
        and ${t.merchantFunding} is not null
        and ${t.merchantFunding} >= 0
        and ${t.merchantFunding} = trunc(${t.merchantFunding})
        and ${t.merchantFunding} <= 9999999999999
        and ${t.taxableBase} is not null
        and ${t.taxableBase} >= 0
        and ${t.taxableBase} = trunc(${t.taxableBase})
        and ${t.taxableBase} <= 9999999999999
        and ${t.expectedProviderPayable} is not null
        and ${t.expectedProviderPayable} >= 0
        and ${t.expectedProviderPayable} = trunc(${t.expectedProviderPayable})
        and ${t.expectedProviderPayable} <= 9999999999999
        and ${t.subtotal} >= 0
        and ${t.subtotal} = trunc(${t.subtotal})
        and ${t.subtotal} <= 9999999999999
        and ${t.discount} >= 0
        and ${t.discount} = trunc(${t.discount})
        and ${t.discount} <= 9999999999999
        and ${t.shippingCost} >= 0
        and ${t.shippingCost} = trunc(${t.shippingCost})
        and ${t.shippingCost} <= 9999999999999
        and ${t.serviceFee} = 0
        and ${t.ppnAmount} >= 0
        and ${t.ppnAmount} = trunc(${t.ppnAmount})
        and ${t.ppnAmount} <= 9999999999999
        and ${t.total} >= 0
        and ${t.total} = trunc(${t.total})
        and ${t.total} <= 9999999999999
        and (${t.providerQuotedShippingCost} is null
          or (${t.providerQuotedShippingCost} >= 0
              and ${t.providerQuotedShippingCost} = trunc(${t.providerQuotedShippingCost})
              and ${t.providerQuotedShippingCost} <= 9999999999999))
        and (${t.providerBilledShippingCost} is null
          or (${t.providerBilledShippingCost} >= 0
              and ${t.providerBilledShippingCost} = trunc(${t.providerBilledShippingCost})
              and ${t.providerBilledShippingCost} <= 9999999999999))
      )`
  ),
  // Snapshot typed dibatasi 256KiB per order (spec §4.3).
  pricingSnapshotSizeCheck: check(
    "orders_pricing_snapshot_size",
    sql`${t.pricingSnapshot} is null or octet_length(${t.pricingSnapshot}::text) <= 262144`
  ),
  // Redemption ownership (ticket 07, spec §8.2): a Redemption may not name a
  // client other than the order owner. The pair is the target of the
  // Redemption's composite FK.
  idUserUnique: unique("orders_id_user_id_unique").on(t.id, t.userId),
}));

// Order Items table
export const orderItems = pgTable("order_item", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "restrict" }),
  variantId: text("variant_id")
    .notNull()
    .references(() => productVariants.id, { onDelete: "restrict" }),
  productName: text("product_name").notNull(),
  variantInfo: text("variant_info"), // e.g., "Hitam / XL"
  price: numeric("price", { precision: 15, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  // ===== Ticket 01 diskon — snapshot money per line (spec §8.3) =====
  // Versi default 0 = baris legacy; kolom line hanya wajib saat version 1.
  pricingContractVersion: integer("pricing_contract_version").notNull().default(0),
  sourceUnitPrice: numeric("source_unit_price", { precision: 15, scale: 2 }),
  markdownAmount: numeric("markdown_amount", { precision: 15, scale: 2 }),
  goodsDiscountAmount: numeric("goods_discount_amount", { precision: 15, scale: 2 }),
  netLineAmount: numeric("net_line_amount", { precision: 15, scale: 2 }),
  markdownRevisionId: text("markdown_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("order_item_quantity_positive", sql`${t.quantity} > 0`),
  check("order_item_price_nonnegative", sql`${t.price} >= 0`),
  // Redemption allocation ownership (ticket 07, spec §8.2): an allocation must
  // point at an order item OF THE SAME ORDER. The pair is the FK target.
  unique("order_item_order_id_unique").on(t.orderId, t.id),
  // Satu variant hanya boleh menjadi satu canonical cart line per order.
  uniqueIndex("order_item_order_variant_unique").on(t.orderId, t.variantId),
  check(
    "order_item_pricing_versions_valid",
    sql`${t.pricingContractVersion} >= 0 and (${t.pricingContractVersion} = 0 or ${t.pricingContractVersion} = 1)`
  ),
  // Kontrak baru: money line lengkap, nonnegatif, Rupiah utuh, dalam bound;
  // qty 1..99. `<= bound` menolak numeric NaN. Baris legacy tidak dipaksa.
  check(
    "order_item_pricing_snapshot_complete",
    sql`${t.pricingContractVersion} <> 1 or (
        ${t.sourceUnitPrice} is not null
        and ${t.sourceUnitPrice} >= 0
        and ${t.sourceUnitPrice} = trunc(${t.sourceUnitPrice})
        and ${t.sourceUnitPrice} <= 9999999999999
        and ${t.markdownAmount} is not null
        and ${t.markdownAmount} >= 0
        and ${t.markdownAmount} = trunc(${t.markdownAmount})
        and ${t.markdownAmount} <= 9999999999999
        and ${t.goodsDiscountAmount} is not null
        and ${t.goodsDiscountAmount} >= 0
        and ${t.goodsDiscountAmount} = trunc(${t.goodsDiscountAmount})
        and ${t.goodsDiscountAmount} <= 9999999999999
        and ${t.netLineAmount} is not null
        and ${t.netLineAmount} >= 0
        and ${t.netLineAmount} = trunc(${t.netLineAmount})
        and ${t.netLineAmount} <= 9999999999999
        and ${t.price} >= 0
        and ${t.price} = trunc(${t.price})
        and ${t.price} <= 9999999999999
        and (${t.markdownRevisionId} is null or length(${t.markdownRevisionId}) <= 128)
      )`
  ),
  check(
    "order_item_pricing_quantity_bounds",
    sql`${t.pricingContractVersion} <> 1 or (${t.quantity} >= 1 and ${t.quantity} <= 99)`
  ),
]);

// Relations
export const addressesRelations = relations(addresses, ({ one, many }) => ({
  user: one(clients, {
    fields: [addresses.userId],
    references: [clients.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(clients, {
    fields: [orders.userId],
    references: [clients.id],
  }),
  branch: one(branches, {
    fields: [orders.branchId],
    references: [branches.id],
  }),
  address: one(addresses, {
    fields: [orders.addressId],
    references: [addresses.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

// =========================================================
// Ticket 05 — the durable delivery-shipment ledger (packing → booking).
// Per-order-unique; the state machine is packed → booking_dispatched (one
// committed conditional dispatch claim) → booked, or booking_unknown from
// booking_dispatched after a failed/timeout POST — the ambiguity is durable
// and a repeated book must never POST again without certainty.
//
// `stored_request` is the ORIGINAL create request, built ONLY from the
// order's `delivery_snapshot` at packing time and NEVER re-read from the
// address book, the branch fields, the master parcel or the IT config:
//   - ref_no = the order id, purely as a correlation (no idempotency claim);
//   - is_cod stays false; insurance stays off (never invented);
//   - NO package_detail/carton is invented before a real carton exists;
//   - region ids and zipcodes are STRINGS (leading zeros preserved).
//
// Money columns are STORE-BOURNE cost records (no customer charge ever
// derives from them): `quote_rates` = the approved ongkir from the snapshot,
// `booked_price` = the provider `price`, `billed_price` = the provider
// `price_bill` when it exists — NULL stays unknown (never 0); the true
// billed value arrives via the ticket-06 AWB-detail verification.
// =========================================================
export interface ShipmentCreateRequestItemBlock {
  item_name: string;
  quantity: number;
  value: number;
  weight: number;
  length: number;
  width: number;
  height: number;
}

export interface ShipmentCreateRequestPartyBlock {
  name: string;
  phone: string;
  address: string;
  zipcode: string;
  area_id?: string;
}

export interface ShipmentCreateRequestPayload {
  ref_no: string;
  courier_id: number;
  courier_service_id: number;
  is_cod: boolean;
  shipping_insurance?: number;
  origin: ShipmentCreateRequestPartyBlock;
  destination: ShipmentCreateRequestPartyBlock;
  items: ShipmentCreateRequestItemBlock[];
}

export const deliveryShipments = pgTable("delivery_shipment", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: "restrict" }),
  // packed | booking_dispatched | booked | booking_unknown
  state: text("state").notNull().default("packed"),
  storedRequest: jsonb("stored_request")
    .$type<ShipmentCreateRequestPayload>()
    .notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  packedBy: text("packed_by").notNull().references(() => users.id),
  dispatchedBy: text("dispatched_by").references(() => users.id),
  bookedBy: text("booked_by").references(() => users.id),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  bookedAt: timestamp("booked_at", { withTimezone: true }),
  shipmentId: integer("shipment_id"),
  awb: text("awb"),
  trackingUrl: text("tracking_url"),
  quoteRates: numeric("quote_rates", { precision: 15, scale: 2 }).notNull(),
  bookedPrice: numeric("booked_price", { precision: 15, scale: 2 }),
  billedPrice: numeric("billed_price", { precision: 15, scale: 2 }),
  // Ticket 06 — the physical serah-terima stamp + the verified tracking.
  handedOverBy: text("handed_over_by").references(() => users.id),
  handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
  // The NORMALIZED latest_status vocabulary (never the carrier's raw codes).
  latestStatus: text("latest_status"),
  latestEventAt: timestamp("latest_event_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  // The POD link, stored only when the provider sent a safe http(s) URL.
  podUrl: text("pod_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "delivery_shipment_state_valid",
    sql`${t.state} in ('packed', 'booking_dispatched', 'booked', 'booking_unknown')`
  ),
  // Before ticket 07's release flow this ledger allowed at most one POST;
  // ticket 07's proof-release keeps the count MONOTONIC across attempts and
  // re-closes exactly once per claim — the lifetime cap is now >= 0.
  check(
    "delivery_shipment_attempt_at_most_one",
    sql`${t.attemptCount} >= 0`
  ),
  check(
    "delivery_shipment_shipment_id_positive",
    sql`${t.shipmentId} is null or ${t.shipmentId} > 0`
  ),
  check(
    "delivery_shipment_costs_finite_nonnegative",
    sql`(${t.quoteRates} >= 0 and ${t.quoteRates}::text not in ('NaN','Infinity','-Infinity')) and
        (${t.bookedPrice} is null or (${t.bookedPrice} >= 0 and ${t.bookedPrice}::text not in ('NaN','Infinity','-Infinity'))) and
        (${t.billedPrice} is null or (${t.billedPrice} >= 0 and ${t.billedPrice}::text not in ('NaN','Infinity','-Infinity')))`
  ),
  check(
    "delivery_shipment_booked_fields_present",
    sql`(${t.state} <> 'booked' or (${t.awb} is not null and ${t.shipmentId} is not null
         and ${t.bookedPrice} is not null and ${t.bookedBy} is not null and ${t.dispatchedAt} is not null))`
  ),
  check(
    "delivery_shipment_ambiguity_fields_absent",
    sql`(${t.state} not in ('packed', 'booking_dispatched', 'booking_unknown') or
         (${t.awb} is null and ${t.shipmentId} is null and
          ${t.bookedPrice} is null and ${t.billedPrice} is null and ${t.bookedAt} is null))`
  ),
  // Ticket 06 — one external identity binds EXACTLY ONE order (never two).
  uniqueIndex("delivery_shipment_awb_global_unique").on(t.awb),
  uniqueIndex("delivery_shipment_shipment_id_global_unique").on(t.shipmentId),
  // The physical handoff needs a booked shipment and an acting admin.
  check(
    "delivery_shipment_handoff_fields_present",
    sql`(${t.handedOverAt} is null or (${t.bookedAt} is not null and ${t.handedOverBy} is not null))`
  ),
]);

export const deliveryShipmentsRelations = relations(deliveryShipments, ({ one, many }) => ({
  order: one(orders, {
    fields: [deliveryShipments.orderId],
    references: [orders.id],
  }),
  events: many(deliveryTrackingEvents),
}));

// =========================================================
// Ticket 06 — tracking receipts per shipment. ONE row per distinct webhook
// body (the sha256 `fingerprint` is GLOBALLY unique — an exact replay is a
// duplicate and never re-applies). Only the NORMALIZED `latest_status`
// vocabulary is ever applied; out-of-order/unknown/late-after-completed
// bodies are RECEIVED (stored, `applied = false`, with an `ignored_reason`)
// but NEVER regress the order or its shipment ledger.
// =========================================================
export const deliveryTrackingEvents = pgTable("delivery_tracking_event", {
  id: text("id").primaryKey(),
  // The INTERNAL ledger id — NOT the provider's integer (kept separately).
  shipmentId: text("shipment_id")
    .notNull()
    .references(() => deliveryShipments.id, { onDelete: "restrict" }),
  externalShipmentId: integer("external_shipment_id"),
  refNo: text("ref_no"),
  awb: text("awb").notNull(),
  latestStatus: text("latest_status"),
  statusDetail: text("status_detail"),
  fingerprint: text("fingerprint").notNull(),
  source: text("source").notNull().default("webhook"), // webhook | reconcile
  applied: boolean("applied").notNull().default(false),
  ignoredReason: text("ignored_reason"),
  providerEventAt: timestamp("provider_event_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("delivery_tracking_event_fingerprint_unique").on(t.fingerprint),
  index("idx_delivery_tracking_event_shipment").on(t.shipmentId),
]);

export const deliveryTrackingEventsRelations = relations(deliveryTrackingEvents, ({ one }) => ({
  shipment: one(deliveryShipments, {
    fields: [deliveryTrackingEvents.shipmentId],
    references: [deliveryShipments.id],
  }),
}));

// =========================================================
// Ticket 07 — the archived booking-release history. Every booking release of
// an ambiguous ledger attempt archives the ORIGINAL dispatch (actor/time/
// stored request) together with the AUTHORIZED HUMAN's attestation that
// Jubelio confirmed the first operation is CLOSED and NO booking exists
// (source 'jubelio_confirmation' + both literal booleans). This is an
// audited trusted-staff attestation, never automatic system evidence (a
// timeout/404/elapsed time/"dash not found" proves nothing). Per ledger +
// attempt unique: one release per attempt; a new attempt needs NEW proof.
// =========================================================
export const deliveryBookingReviews = pgTable("delivery_booking_reviews", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "restrict" }),
  shipmentId: text("shipment_id")
    .notNull()
    .references(() => deliveryShipments.id, { onDelete: "restrict" }),
  attemptNumber: integer("attempt_number").notNull(),
  originalDispatchedBy: text("original_dispatched_by"),
  originalDispatchedAt: timestamp("original_dispatched_at", { withTimezone: true }),
  archivedRequest: jsonb("archived_request").$type<ShipmentCreateRequestPayload>().notNull(),
  proofSource: text("proof_source").notNull(),
  proofReference: text("proof_reference").notNull(),
  proofReason: text("proof_reason").notNull(),
  absenceConfirmed: boolean("absence_confirmed").notNull(),
  operationClosed: boolean("operation_closed").notNull(),
  releasedBy: text("released_by").notNull().references(() => users.id),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("delivery_booking_review_shipment_attempt_unique").on(
    t.shipmentId,
    t.attemptNumber
  ),
  check(
    "delivery_booking_review_attempt_positive",
    sql`${t.attemptNumber} >= 1`
  ),
  check(
    "delivery_booking_review_proof_valid",
    sql`${t.proofSource} = 'jubelio_confirmation' and
        ${t.absenceConfirmed} is true and ${t.operationClosed} is true`
  ),
]);

export const deliveryBookingReviewsRelations = relations(deliveryBookingReviews, ({ one }) => ({
  order: one(orders, {
    fields: [deliveryBookingReviews.orderId],
    references: [orders.id],
  }),
  shipment: one(deliveryShipments, {
    fields: [deliveryBookingReviews.shipmentId],
    references: [deliveryShipments.id],
  }),
}));
