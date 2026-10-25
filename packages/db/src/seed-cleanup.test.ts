import { describe, expect, it } from "vitest";
import { seedCleanupEntries } from "./seed-cleanup";

describe("seed cleanup order", () => {
  it("clears the Shipment ledger before parent orders and admin attribution", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names).toContain('deliveryBookingReviews');
    expect(names.indexOf('deliveryBookingReviews')).toBeLessThan(names.indexOf('deliveryShipments'));
    expect(names.indexOf('deliveryBookingReviews')).toBeLessThan(names.indexOf('users'));
    expect(names).toContain("deliveryShipments");
    expect(names).toContain('deliveryTrackingEvents');
    expect(names.indexOf('deliveryTrackingEvents')).toBeLessThan(names.indexOf('deliveryShipments'));
    expect(names.indexOf("deliveryShipments")).toBeLessThan(names.indexOf("orders"));
    expect(names.indexOf("deliveryShipments")).toBeLessThan(names.indexOf("users"));
  });
  it("clears retained provider evidence and items before orders and their owners", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    for (const child of ["jubelioChannelStatusIntents", "jubelioSalesOperations", "orderItems"]) {
      expect(names).toContain(child);
      expect(names.indexOf(child)).toBeLessThan(names.indexOf("orders"));
    }
    expect(names.indexOf("orders")).toBeLessThan(names.indexOf("clients"));
    expect(names.indexOf("orderItems")).toBeLessThan(names.indexOf("productVariants"));
    expect(names.indexOf("productVariants")).toBeLessThan(names.indexOf("products"));
    for (const child of ["addresses", "clientSessions", "clientAccounts", "clientVerifications"]) {
      expect(names).toContain(child);
      expect(names.indexOf(child)).toBeLessThan(names.indexOf("clients"));
    }
  });
  it("deletes admin users before branches because the FK is restrictive", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("branches"));
  });
  it("clears discount administration records before their Offer identity, roles and users", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    for (const child of [
      "discountAdminRequests",
      "discountOfferUsage",
      "discountOfferRevisions",
    ]) {
      expect(names).toContain(child);
      // The Offer owns the current-revision pointer and the usage projection,
      // so every child row must go before the Offer identity itself.
      expect(names.indexOf(child)).toBeLessThan(names.indexOf("discountOffers"));
    }
    // Actor attribution and the seeded HQ identity must survive this cleanup
    // (both FKs are SET NULL, but the rows are still deleted first by order).
    expect(names.indexOf("discountOffers")).toBeLessThan(names.indexOf("users"));
    expect(names.indexOf("discountOffers")).toBeLessThan(
      names.indexOf("adminRoles")
    );
  });
  it("clears reserved manual codes before the Offer identity and users (ticket 09)", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names).toContain("discountCodes");
    expect(names.indexOf("discountCodes")).toBeLessThan(names.indexOf("discountOffers"));
    expect(names.indexOf("discountCodes")).toBeLessThan(names.indexOf("users"));
    // Redemption rows reference a code (RESTRICT), so they must be deleted first.
    expect(names.indexOf("discountRedemptions")).toBeLessThan(names.indexOf("discountCodes"));
  });

  it("clears Markdown price records before variants, batches, and users", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    for (const child of [
      "priceChangeBatchRows",
      "variantPriceCurrent",
      "variantPriceRevisions",
    ]) {
      expect(names).toContain(child);
      expect(names.indexOf(child)).toBeLessThan(names.indexOf("productVariants"));
    }
    expect(names.indexOf("variantPriceCurrent")).toBeLessThan(
      names.indexOf("variantPriceRevisions")
    );
    expect(names.indexOf("variantPriceRevisions")).toBeLessThan(
      names.indexOf("priceChangeBatches")
    );
    expect(names.indexOf("priceChangeBatchRows")).toBeLessThan(
      names.indexOf("priceChangeBatches")
    );
    expect(names.indexOf("priceChangeBatches")).toBeLessThan(names.indexOf("users"));
  });
  it("clears accepted apply-request receipts before batch rows and batches", () => {
    // `price_change_apply_request.batch_id` is RESTRICT, so the ledger has to go
    // before the rows and before the batch it attributes.
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names).toContain("priceChangeApplyRequests");
    expect(names.indexOf("priceChangeApplyRequests")).toBeLessThan(
      names.indexOf("priceChangeBatchRows")
    );
    expect(names.indexOf("priceChangeApplyRequests")).toBeLessThan(
      names.indexOf("priceChangeBatches")
    );
  });
});
