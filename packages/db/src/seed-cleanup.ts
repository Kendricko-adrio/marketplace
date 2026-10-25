import type { AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export const seedCleanupEntries: ReadonlyArray<
  readonly [name: string, table: AnyPgTable]
> = [
  // Redemption lifecycle (ticket 07). Append-only events first, then the
  // allocations (which reference both the order item and the Redemption), the
  // Redemption itself, and the per-client projection. All of them reference the
  // order/client/Offer with RESTRICT, so they must be cleared before
  // orderItems/orders and before discountOffers/clients.
  ["discountRedemptionEvents", schema.discountRedemptionEvents],
  ["orderDiscountAllocations", schema.orderDiscountAllocations],
  ["discountRedemptions", schema.discountRedemptions],
  ["discountClientUsage", schema.discountClientUsage],
  // Discount administration (ticket 06). Receipts first (no FK), then the
  // usage projection and draft revisions (both RESTRICT to the Offer), and the
  // Offer identity last. Cleared before users/roles so actor attribution never
  // has to be nulled by an earlier DELETE. The Offer↔current-revision pointer
  // is RESTRICT in both directions and a non-draft Offer may not lose its
  // pointer, so the seeder resets `state = 'draft'` together with the pointer
  // before this FK-ordered DELETE loop (see seed.ts).
  ["discountAdminRequests", schema.discountAdminRequests],
  // Reserved manual codes (ticket 09) reference the Offer with RESTRICT; they
  // are cleared before Offer usage/revisions/identity.
  ["discountCodes", schema.discountCodes],
  ["discountOfferUsage", schema.discountOfferUsage],
  ["discountBenefits", schema.discountBenefits],
  ["discountOfferRevisions", schema.discountOfferRevisions],
  ["discountOffers", schema.discountOffers],
  // Manual Markdown price changes (ticket 03). Rows first (they hold the
  // applied-revision FK), then the current pointer, the immutable revisions and
  // finally the batch that attributes them. The row's `applied_revision_id`
  // must be cleared together with `state = 'pending'` before the DELETE loop
  // (see seed.ts), otherwise the state/applied CHECK refuses the update.
  // Accepted apply/resume receipts (ticket 04) reference the batch with RESTRICT,
  // so the ledger is cleared before the rows and before the batch itself.
  ["priceChangeApplyRequests", schema.priceChangeApplyRequests],
  ["priceChangeBatchRows", schema.priceChangeBatchRows],
  ["variantPriceCurrent", schema.variantPriceCurrent],
  ["variantPriceRevisions", schema.variantPriceRevisions],
  ["priceChangeBatches", schema.priceChangeBatches],
  ["notifications", schema.notifications],
  // New RBAC tables: grants before roles; roles after users because
  // users.role_id references admin_role with ON DELETE RESTRICT.
  // (The legacy permission table was dropped by migration 0018.)
  ["adminRoleGrants", schema.adminRoleGrants],
  ["staticPages", schema.staticPages],
  ["footerConfig", schema.footerConfig],
  ["homepageSectionProducts", schema.homepageSectionProducts],
  ["homepageSections", schema.homepageSections],
  ["cartItems", schema.cartItems],
  ["carts", schema.carts],
  ["jubelioStockOperations", schema.jubelioStockOperations],
  ["jubelioChannelStatusIntents", schema.jubelioChannelStatusIntents],
  ["jubelioSalesOperations", schema.jubelioSalesOperations],
  ['deliveryBookingReviews', schema.deliveryBookingReviews],
  ['deliveryTrackingEvents', schema.deliveryTrackingEvents],
  ["deliveryShipments", schema.deliveryShipments],
  ["discountRequestWindows", schema.discountRequestWindows],
  ["checkoutRequests", schema.checkoutRequests],
  ["checkoutAttempts", schema.checkoutAttempts],
  ["orderItems", schema.orderItems],
  ["orders", schema.orders],
  ["auditLogs", schema.auditLogs],
  ["systemConfig", schema.systemConfig],
  ["branchStocks", schema.branchStocks],
  ["productImages", schema.productImages],
  ["productVariants", schema.productVariants],
  ["productToCategory", schema.productToCategory],
  ["products", schema.products],
  ["brands", schema.brands],
  ["genders", schema.genders],
  ["categories", schema.categories],
  ["adminSessions", schema.adminSessions],
  ["adminAccounts", schema.adminAccounts],
  ["adminVerifications", schema.adminVerifications],
  ["users", schema.users],
  ["adminRoles", schema.adminRoles],
  ["branches", schema.branches],
  ["vouchers", schema.vouchers],
  ["addresses", schema.addresses],
  ["clientSessions", schema.clientSessions],
  ["clientAccounts", schema.clientAccounts],
  ["clientVerifications", schema.clientVerifications],
  ["clients", schema.clients],
];
