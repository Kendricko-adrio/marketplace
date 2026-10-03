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
  it("deletes admin users before branches because the FK is restrictive", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("branches"));
  });
});
