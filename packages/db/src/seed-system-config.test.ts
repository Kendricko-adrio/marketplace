import { describe, expect, it } from "vitest";
import { shipmentSystemConfigSeedRows } from "./seed-system-config";

describe("shipment system config seed", () => {
  it("seeds the approved per-unit fallback parcel dimensions for delivery quotes", () => {
    const fallback = shipmentSystemConfigSeedRows.find((row) => row.key === "shipment.parcelFallback");
    expect(fallback?.type).toBe("json");
    expect(JSON.parse(fallback!.value)).toEqual({ weight: 250, length: 30, width: 20, height: 10 });
  });

  it("seeds 15 grams as the packaging weight for delivery quotes", () => {
    expect(
      shipmentSystemConfigSeedRows.find((row) => row.key === "shipment.packagingWeightGrams")?.value
    ).toBe("15");
  });
});
