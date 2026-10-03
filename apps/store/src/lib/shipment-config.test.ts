import { describe, expect, it } from "vitest";
import { loadShipmentParcelConfig } from "./shipment-config";
describe("IT parcel configuration", () => {
  it("reads explicitly configured nonnegative integer grams", async () => { expect((await loadShipmentParcelConfig(async () => [{ key: "shipment.packagingWeightGrams", value: "40" }])).packagingWeight).toBe(40); });
  it.each(["", "null", "1.5", "-1", "Infinity"])("fails closed on malformed packaging %j", async (value) => { expect((await loadShipmentParcelConfig(async () => [{ key: "shipment.packagingWeightGrams", value }])).packagingWeight).toBeNaN(); });
  it("reads current IT parameters for each request, not a prior cached quote", async () => {
    let value = "40";
    const reader = async () => [{ key: "shipment.packagingWeightGrams", value }];
    expect((await loadShipmentParcelConfig(reader)).packagingWeight).toBe(40);
    value = "50";
    expect((await loadShipmentParcelConfig(reader)).packagingWeight).toBe(50);
  });
});
